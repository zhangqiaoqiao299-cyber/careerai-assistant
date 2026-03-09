import { useState, useEffect, useRef } from "react";
import { Building2, FileText, Send, Loader2, Sparkles, MessageSquare, ChevronRight, ArrowLeft, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import { Button } from "./components/Button";
import { ResumeUpload } from "./components/ResumeUpload";
import { analyzeJobMatch, streamMockInterview } from "./services/geminiService";
import { AnalysisResult, ChatMessage, JDData, ResumeData } from "./types";
import { cn } from "./lib/utils";
import { logUsage, saveResume } from "./services/loggingService";

export default function App() {
  const [step, setStep] = useState<"input" | "analysis" | "interview">("input");
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [jd, setJd] = useState<JDData>({ text: "", companyName: "" });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  
  // 自动从缓存加载简历
  useEffect(() => {
    const cachedResume = localStorage.getItem('cached_resume');
    if (cachedResume) {
      try {
        setResume(JSON.parse(cachedResume));
      } catch (e) {
        console.error("Failed to parse cached resume", e);
      }
    }
  }, []);

  // 当简历更新时，存入缓存
  const handleResumeUpload = (data: ResumeData | null) => {
    setResume(data);
    if (data) {
      localStorage.setItem('cached_resume', JSON.stringify(data));
    } else {
      localStorage.removeItem('cached_resume');
    }
  };
  
  // Interview state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [userInput, setUserInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Check for API Key on mount
  useEffect(() => {
    const checkKey = async () => {
      // 区分本人与朋友：如果域名包含 '-dev-'，说明是您本人在开发环境，直接跳过
      const isOwner = window.location.hostname.includes('-dev-');
      
      if (isOwner) {
        setHasKey(true);
        return;
      }

      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      } else {
        setHasKey(true);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  if (hasKey === false) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 shadow-xl text-center space-y-6"
        >
          <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 mx-auto">
            <Sparkles size={32} />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900">欢迎体验 CareerAI</h1>
            <p className="text-slate-500 text-sm">
              为了保护开发者的 API 额度，请使用您自己的 Gemini API 密钥来运行 AI 功能。
            </p>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 text-left space-y-3 border border-slate-100">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <div className="w-5 h-5 bg-indigo-600 rounded-full text-[10px] flex items-center justify-center text-white">?</div>
              如何获取免费密钥？
            </h3>
            <ol className="text-xs text-slate-500 space-y-2 list-decimal ml-4">
              <li>访问 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Google AI Studio</a></li>
              <li>点击 <b>"Create API key"</b> 按钮。</li>
              <li>回到这里点击下方按钮进行选择。</li>
            </ol>
          </div>

          <Button onClick={handleSelectKey} className="w-full h-12 text-lg">
            选择 API 密钥
          </Button>
          
          <p className="text-[10px] text-slate-400">
            提示：Gemini 2.0 Flash 模型目前提供免费额度，非常适合个人体验。
          </p>
        </motion.div>
      </div>
    );
  }

  if (hasKey === null) return null; // Loading state

  const handleAnalyze = async () => {
    if (!resume || !jd.text || !jd.companyName) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    setStep("analysis");
    try {
      const result = await analyzeJobMatch(resume, jd);
      if (!result || !result.optimization) {
        throw new Error("AI 未能生成有效的分析结果，请稍后重试。");
      }
      setAnalysisResult(result);
      
      // 记录分析行为
      logUsage({
        action: 'analysis',
        company_name: jd.companyName,
        resume_filename: resume.fileName,
        details: { jd_length: jd.text.length }
      });

      // 存储简历到数据库
      saveResume(resume, jd.companyName);
    } catch (error: any) {
      console.error("Analysis failed:", error);
      setAnalysisError(error.message || "分析失败，请检查网络连接或 API 密钥是否有效。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startInterview = async () => {
    setStep("interview");
    
    // 记录面试开始
    logUsage({
      action: 'interview_start',
      company_name: jd.companyName,
      resume_filename: resume?.fileName
    });

    if (chatHistory.length === 0) {
      await handleSendMessage("你好，我准备好开始面试了。");
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || !resume) return;
    
    const newUserMsg: ChatMessage = { role: "user", text };
    setChatHistory(prev => [...prev, newUserMsg]);
    setUserInput("");
    setIsTyping(true);

    try {
      const stream = streamMockInterview([...chatHistory, newUserMsg], resume, jd);
      let fullResponse = "";
      
      // Add empty model message to start streaming into
      setChatHistory(prev => [...prev, { role: "model", text: "" }]);
      
      for await (const chunk of stream) {
        fullResponse += chunk;
        setChatHistory(prev => {
          const newHistory = [...prev];
          newHistory[newHistory.length - 1].text = fullResponse;
          return newHistory;
        });
      }
    } catch (error) {
      console.error("Interview failed:", error);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
              <Sparkles size={18} />
            </div>
            <h1 className="font-bold text-xl tracking-tight">CareerAI</h1>
          </div>
          
          <div className="hidden md:flex items-center gap-4 text-sm font-medium text-slate-500">
            <span className={cn(step === "input" && "text-indigo-600")}>信息输入</span>
            <ChevronRight size={14} />
            <span className={cn(step === "analysis" && "text-indigo-600")}>匹配分析</span>
            <ChevronRight size={14} />
            <span className={cn(step === "interview" && "text-indigo-600")}>模拟面试</span>
          </div>
        </div>
      </header>

      {/* Config Modal Removed */}

      <main className="flex-1 max-w-5xl mx-auto w-full p-4 md:p-8">
        <AnimatePresence mode="wait">
          {step === "input" && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-8"
            >
              <div className="space-y-6">
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-slate-900 font-semibold">
                    <FileText className="text-indigo-600" size={20} />
                    <h2>第一步：上传简历</h2>
                  </div>
                  <ResumeUpload onUpload={handleResumeUpload} currentResume={resume} />
                </section>
              </div>

              <div className="space-y-6">
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-slate-900 font-semibold">
                    <Building2 className="text-indigo-600" size={20} />
                    <h2>第二步：目标职位</h2>
                  </div>
                  <div className="space-y-4 bg-white p-6 rounded-xl border border-slate-200">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">目标公司</label>
                      <input
                        type="text"
                        placeholder="例如：Google, 阿里巴巴, 腾讯..."
                        className="w-full p-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                        value={jd.companyName}
                        onChange={(e) => setJd(prev => ({ ...prev, companyName: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">职位描述 (JD)</label>
                      <textarea
                        placeholder="粘贴职位要求、职责等详细内容..."
                        className="w-full h-48 p-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-sm"
                        value={jd.text}
                        onChange={(e) => setJd(prev => ({ ...prev, text: e.target.value }))}
                      />
                    </div>
                    <Button
                      className="w-full"
                      disabled={!resume || !jd.text || !jd.companyName}
                      onClick={handleAnalyze}
                    >
                      开始智能分析
                    </Button>
                  </div>
                </section>
              </div>
            </motion.div>
          )}

          {step === "analysis" && (
            <motion.div
              key="analysis"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setStep("input")} className="gap-2">
                  <ArrowLeft size={16} /> 返回修改
                </Button>
                <Button onClick={startInterview} className="gap-2">
                  进入模拟面试 <MessageSquare size={16} />
                </Button>
              </div>

              {isAnalyzing ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center justify-center gap-4 text-center">
                  <Loader2 className="animate-spin text-indigo-600" size={40} />
                  <div className="space-y-1">
                    <h3 className="font-bold text-lg">正在深度分析...</h3>
                    <p className="text-slate-500">正在对比简历与JD，并调研公司背景</p>
                  </div>
                </div>
              ) : analysisError ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center justify-center gap-6 text-center">
                  <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center text-red-500">
                    <AlertCircle size={32} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-bold text-xl text-slate-900">分析失败</h3>
                    <p className="text-slate-500 max-w-md mx-auto">{analysisError}</p>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => setStep("input")}>返回修改</Button>
                    <Button onClick={handleAnalyze}>重新尝试</Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm">
                      <div className="flex items-center gap-2 mb-6 text-indigo-600">
                        <Sparkles size={20} />
                        <h2 className="font-bold text-lg">AI 优化建议与面试题</h2>
                      </div>
                      <div className="markdown-body prose prose-slate max-w-none">
                        <Markdown>{analysisResult?.optimization}</Markdown>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                      <h3 className="font-bold mb-4 flex items-center gap-2">
                        <Building2 size={18} className="text-indigo-600" />
                        参考资料
                      </h3>
                      <div className="space-y-3">
                        {analysisResult?.groundingUrls?.map((url, i) => (
                          <a
                            key={i}
                            href={url.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block p-3 rounded-lg bg-slate-50 border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all text-sm group"
                          >
                            <div className="font-medium text-slate-900 group-hover:text-indigo-600 truncate">
                              {url.title}
                            </div>
                            <div className="text-xs text-slate-500 truncate mt-1">{url.uri}</div>
                          </a>
                        ))}
                        {(!analysisResult?.groundingUrls || analysisResult.groundingUrls.length === 0) && (
                          <p className="text-sm text-slate-500 italic">暂无参考链接</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {step === "interview" && (
            <motion.div
              key="interview"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-3xl mx-auto h-[calc(100vh-12rem)] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
            >
              <div className="bg-indigo-600 p-4 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <div className="font-bold">{jd.companyName} 模拟面试</div>
                    <div className="text-xs text-indigo-100">AI 面试官正在线</div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setStep("analysis")} className="text-white hover:bg-white/10">
                  结束面试
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {chatHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex flex-col max-w-[85%]",
                      msg.role === "user" ? "ml-auto items-end" : "items-start"
                    )}
                  >
                    <div
                      className={cn(
                        "p-4 rounded-2xl text-sm leading-relaxed",
                        msg.role === "user"
                          ? "bg-indigo-600 text-white rounded-tr-none"
                          : "bg-slate-100 text-slate-800 rounded-tl-none"
                      )}
                    >
                      <Markdown>{msg.text}</Markdown>
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex items-center gap-2 text-slate-400 text-xs italic">
                    <Loader2 size={14} className="animate-spin" />
                    面试官正在思考...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage(userInput);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    placeholder="输入你的回答..."
                    className="flex-1 p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    disabled={isTyping}
                  />
                  <Button type="submit" disabled={isTyping || !userInput.trim()}>
                    <Send size={18} />
                  </Button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="py-6 text-center text-slate-400 text-xs">
        © 2026 CareerAI - 你的智能求职伙伴
      </footer>
    </div>
  );
}


