import { GoogleGenAI } from "@google/genai";
import { AnalysisResult, ChatMessage, JDData, ResumeData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeJobMatch(resume: ResumeData, jd: JDData): Promise<AnalysisResult> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    你是一个资深的职业顾问和面试官。请根据以下简历和职位描述（JD）进行深度分析。
    
    简历内容:
    ${resume.text}
    
    职位描述 (JD):
    ${jd.text}
    目标公司: ${jd.companyName}

    请提供以下三个部分的详细分析（使用Markdown格式）：
    1. **简历优化建议**：对比简历和JD，指出简历中缺失的关键技能或经验，并给出具体的修改建议。
    2. **定制面试题**：基于JD要求和简历背景，生成5-8道针对性的面试题（包含技术题和行为面试题），并附带简要的回答要点。
    3. **公司背景调研**：简要介绍 ${jd.companyName} 的业务、文化和近期动态。
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const text = response.text || "";
  
  // Split the response into sections based on headers if possible, or just return as one
  // For simplicity in this MVP, we'll return the whole text and let the UI handle it
  // But we also want to extract grounding URLs
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  const groundingUrls = chunks?.map(c => ({
    title: c.web?.title || "参考链接",
    uri: c.web?.uri || ""
  })).filter(u => u.uri) || [];

  return {
    optimization: text, // We'll display the whole thing or split it
    interviewQuestions: "", 
    companyInfo: "",
    groundingUrls
  };
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
