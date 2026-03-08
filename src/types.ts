export interface ResumeData {
  text: string;
  fileName?: string;
}

export interface JDData {
  text: string;
  companyName: string;
}

export interface AnalysisResult {
  optimization: string;
  interviewQuestions: string;
  companyInfo: string;
  groundingUrls?: { title: string; uri: string }[];
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
