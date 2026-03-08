import { GoogleGenAI } from "@google/genai";
import { AnalysisResult, ChatMessage, JDData, ResumeData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function callDeepSeek(prompt: string) {
  // 兼容性读取：尝试多种可能的路径获取 API Key
  const apiKey = 
    import.meta.env.VITE_DEEPSEEK_API_KEY || 
    (process.env as any).VITE_DEEPSEEK_API_KEY || 
    (process.env as any).DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error("未检测到 DeepSeek API Key。请确保在 Netlify 环境变量中设置了 VITE_DEEPSEEK_API_KEY，并重新部署（Clear cache and deploy）。");
  }

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: `你是一个极其严谨、客观且专业的职业顾问。
          当前系统时间：2026-03-08。
          你的原则：
          1. 零幻觉：严禁编造任何简历中不存在的经历。
          2. 零夸大：严禁使用虚假的修饰词。
          3. 零谄媚：保持中立专业的口吻，不进行无意义的赞美。
          4. 事实驱动：所有的建议和面试题必须锚定在原始文本中。`
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.3, // 降低随机性，增加严谨性
      stream: false
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`DeepSeek API 错误: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

export async function analyzeJobMatch(resume: ResumeData, jd: JDData): Promise<AnalysisResult> {
  const geminiModel = "gemini-3-flash-preview";
  
  // 第一步：利用 Gemini 的搜索能力获取公司背景
  let searchResultsText = "";
  let groundingUrls: { title: string; uri: string }[] = [];

  try {
    const searchResponse = await ai.models.generateContent({
      model: geminiModel,
      contents: `请深入搜索并调研公司 ${jd.companyName}。
      重点关注：
      1. 官方网站及业务介绍。
      2. 最近一年的重大新闻、融资动态或财报。
      3. 企业文化与核心价值观。
      4. 社交媒体（如领英、知乎、脉脉）上的员工评价摘要。
      JD内容参考：${jd.text}`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    
    searchResultsText = searchResponse.text || "";
    
    // --- 三重保险提取链接 ---
    
    // 1. 提取官方结构化链接 (Grounding Chunks)
    const metadata = searchResponse.candidates?.[0]?.groundingMetadata;
    const chunks = metadata?.groundingChunks;
    groundingUrls = chunks?.map(c => ({
      title: c.web?.title || "参考资料",
      uri: c.web?.uri || ""
    })).filter(u => u.uri) || [];

    // 2. 如果官方数据为空，从搜索文本中正则匹配网址
    if (groundingUrls.length === 0) {
      const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;
      const matches = searchResultsText.match(urlRegex);
      if (matches) {
        // 去重并限制数量
        const uniqueUrls = Array.from(new Set(matches));
        groundingUrls = uniqueUrls.slice(0, 5).map(url => ({
          title: "相关资讯链接",
          uri: url.replace(/[).,;]$/, '') // 清理末尾标点
        }));
      }
    }

    // 3. 保底方案：如果还是没有，尝试提取 Google 搜索入口
    if (groundingUrls.length === 0 && metadata?.searchEntryPoint?.htmlContent) {
      const hrefMatch = metadata.searchEntryPoint.htmlContent.match(/href="([^"]+)"/);
      if (hrefMatch) {
        groundingUrls.push({
          title: `在 Google 上查看搜索结果`,
          uri: hrefMatch[1]
        });
      }
    }
  } catch (error) {
    console.warn("Gemini 搜索失败，将使用保底链接", error);
  }

  // --- 终极保底：如果以上所有尝试都失败了，手动构造搜索链接 ---
  if (groundingUrls.length === 0) {
    const encodedCompany = encodeURIComponent(jd.companyName);
    groundingUrls = [
      {
        title: `在 Google 搜索 ${jd.companyName} 背景`,
        uri: `https://www.google.com/search?q=${encodedCompany}+公司背景+业务动态`
      },
      {
        title: `在 百度 搜索 ${jd.companyName}`,
        uri: `https://www.baidu.com/s?wd=${encodedCompany}`
      },
      {
        title: `在 企查查/天眼查 调研公司`,
        uri: `https://www.qcc.com/web/search?key=${encodedCompany}`
      },
      {
        title: `在 LinkedIn 查看公司主页`,
        uri: `https://www.linkedin.com/search/results/companies/?keywords=${encodedCompany}`
      }
    ];
  }

  // 第二步：将所有信息汇总，交给 DeepSeek 进行深度逻辑分析
  const deepSeekPrompt = `
    请根据以下信息进行深度职场匹配分析。
    当前日期：2026-03-08。

    ### 候选人简历原文：
    ${resume.text}
    
    ### 目标职位描述 (JD)：
    ${jd.text}
    目标公司：${jd.companyName}

    ### 联网搜索到的公司背景资料：
    ${searchResultsText}

    ### 任务要求：
    请提供以下三个部分的详细分析（使用Markdown格式）：

    1. **简历优化建议**：
       - 对比简历与JD，指出简历中缺失的关键技能或经验。
       - **严禁编造经历**。如果缺失，请建议候选人如何通过现有项目体现相关能力，或指出需要查漏补缺的方向。
       - 给出具体的文字修改建议，保持专业、干练。

    2. **定制面试题**：
       - 基于JD要求和简历事实，生成5-8道针对性面试题。
       - 包含技术深度挖掘题和行为面试题。
       - 附带简要的回答要点，要点必须符合候选人的真实背景。

    3. **公司背景与面试策略**：
       - 结合搜索到的动态，分析该公司的面试偏好。
       - 给出针对 ${jd.companyName} 的面试避坑指南。

    注意：请保持冷峻、专业的分析风格，禁止任何形式的自我渲染或谄媚。
  `;

  try {
    const deepSeekResult = await callDeepSeek(deepSeekPrompt);
    return {
      optimization: deepSeekResult,
      interviewQuestions: "",
      companyInfo: "",
      groundingUrls
    };
  } catch (error: any) {
    console.error("DeepSeek 分析失败，尝试降级到 Gemini", error);
    // 降级逻辑：如果 DeepSeek 失败，回退到 Gemini
    const fallbackResponse = await ai.models.generateContent({
      model: geminiModel,
      contents: deepSeekPrompt,
    });
    return {
      optimization: fallbackResponse.text || "分析失败，请检查 API 配置。",
      interviewQuestions: "",
      companyInfo: "",
      groundingUrls
    };
  }
}

export async function* streamMockInterview(
  history: ChatMessage[],
  resume: ResumeData,
  jd: JDData
) {
  const systemInstruction = `
    你是一个极其严谨、专业的资深面试官。你正在为 ${jd.companyName} 的职位面试候选人。
    当前系统时间：2026-03-08。
    
    ### 核心约束（最高优先级）：
    1. **主动驱动**：每一轮对话你必须以一个明确的问题结束。如果用户回答了，你先简要评价（严禁谄媚，要客观），然后立刻抛出下一个问题。
    2. **处理“下一题”**：如果用户说“下一题”、“跳过”或回答非常简略，不要纠缠，立刻根据JD和简历事实切换到下一个考察维度（技术、项目、或行为面试）。
    3. **零幻觉原则**：严禁编造、杜撰、推测任何简历中未提及的信息。
    4. **事实锚定**：你的每一个提问、每一个提到的项目名、数据点，必须在下方的“候选人简历”文本中找到原文依据。
    5. **禁止沉默**：无论发生什么，你都必须保持对话。

    ### 候选人简历原文：
    ${resume.text}
    
    ### 职位描述 (JD)：
    ${jd.text}
    
    ### 你的任务与执行规则：
    1. **面试开场（第一个问题）**：
       - 你必须先做一个简短的专业开场白，并明确邀请候选人进行自我介绍。
    2. **对话模式**：
       - 模拟真实的人与人交流模式。必须根据候选人的回答进行深度追问（Follow-up）。
    3. **面试结束标志**：
       - 当你决定结束面试时，直接且仅输出：“面试结束，谢谢您的配合”。
  `;

  try {
    // 尝试使用 Gemini 引擎
    const sdkHistory = history.slice(0, -1).map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));

    const chat = ai.chats.create({
      model: "gemini-3-flash-preview",
      history: sdkHistory,
      config: { systemInstruction },
    });

    const lastMessage = history[history.length - 1]?.text || "你好，我准备好开始面试了。";
    const result = await chat.sendMessageStream({ message: lastMessage });

    for await (const chunk of result) {
      yield chunk.text;
    }
  } catch (error: any) {
    console.warn("Gemini 面试引擎故障，正在切换至 DeepSeek 备用引擎...", error);
    
    // 降级方案：使用 DeepSeek 进行面试
    try {
      const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY || (process.env as any).VITE_DEEPSEEK_API_KEY;
      if (!apiKey) throw new Error("DeepSeek Key 缺失");

      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: systemInstruction },
            ...history.map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }))
          ],
          temperature: 0.7,
          stream: false 
        })
      });

      if (!response.ok) throw new Error("DeepSeek API 响应异常");
      const data = await response.json();
      yield data.choices[0].message.content;
    } catch (deepError) {
      console.error("双引擎均失效:", deepError);
      yield "【系统提示】面试官网络连接出现波动，请稍等片刻并尝试再次发送消息。";
    }
  }
}
