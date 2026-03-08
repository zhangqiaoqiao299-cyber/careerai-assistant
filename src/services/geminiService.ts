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
      // 尝试从 Google 提供的 HTML 片段中提取搜索链接
      const hrefMatch = metadata.searchEntryPoint.htmlContent.match(/href="([^"]+)"/);
      if (hrefMatch) {
        groundingUrls.push({
          title: `在 Google 上搜索 ${jd.companyName}`,
          uri: hrefMatch[1]
        });
      }
    }
  } catch (error) {
    console.warn("Gemini 搜索失败，将仅依赖已有信息进行分析", error);
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
  // Map our history to the format expected by the SDK
  // We exclude the last message because we'll send it via sendMessageStream
  const sdkHistory = history.slice(0, -1).map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    history: sdkHistory,
    config: {
      systemInstruction: `
        你是一个极其严谨、专业的资深面试官。你正在为 ${jd.companyName} 的职位面试候选人。
        
        ### 核心约束（最高优先级）：
        1. **零幻觉原则**：严禁编造、杜撰、推测任何简历中未提及的信息。
        2. **事实锚定**：你的每一个提问、每一个提到的项目名、数据点，必须在下方的“候选人简历”文本中找到原文依据。
        3. **禁止自由发挥**：禁止根据JD反向推导候选人“应该”有的经历。

        ### 候选人简历原文：
        ${resume.text}
        
        ### 职位描述 (JD)：
        ${jd.text}
        
        ### 你的任务与执行规则：
        1. **面试开场（第一个问题）**：
           - 你必须先做一个简短的专业开场白，并**明确邀请候选人进行自我介绍**。这是面试的固定首个环节。
        2. **对话模式（人机交流还原）**：
           - 模拟真实的人与人交流模式。**严禁**生硬地罗列问题。
           - **必须根据候选人的回答进行深度追问（Follow-up）**。针对候选人提到的细节、挑战或成果进行挖掘，使对话具有连贯性和逻辑性。
        3. **问题数量控制**：
           - 最少 5 轮对话，最多 10 轮对话。
           - 表现好（回答专业且基于事实）5 轮左右结束；表现一般 8-10 轮结束。
        4. **面试结束标志**：
           - 当你决定结束面试时，在候选人最后一次回答后，**直接且仅输出**：“面试结束，谢谢您的配合”。
           - **严禁**在结束语之前再提问，也**严禁**输出任何总结、评价或多余的客套话。
        5. **提问风格**：
           - 保持专业、严谨。
           - 除了第一个问题外，后续对话应直接针对内容进行追问或转入新话题，避免重复性的“很好”、“收到”等无意义垫话，但要保持自然的对话流。
        6. **严禁事项**：
           - 禁止提到任何简历中没写的公司、项目名或具体数值。

        请根据对话历史判断当前阶段。如果是对话开始，请请候选人做自我介绍。
      `,
    },
  });

  const lastMessage = history[history.length - 1]?.text || "你好，我准备好开始面试了。";
  const result = await chat.sendMessageStream({ message: lastMessage });

  for await (const chunk of result) {
    yield chunk.text;
  }
}
