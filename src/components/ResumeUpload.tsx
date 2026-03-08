import { useState, useRef } from "react";
import { Upload, FileText, X, AlertCircle } from "lucide-react";
import mammoth from "mammoth";
import { Button } from "./Button";
import { ResumeData } from "../types";

interface ResumeUploadProps {
  onUpload: (data: ResumeData) => void;
}

export function ResumeUpload({ onUpload }: ResumeUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) processFile(droppedFile);
  };

  const processFile = async (file: File) => {
    setError(null);
    setFile(file);
    
    try {
      let text = "";
      if (file.name.endsWith(".docx")) {
        // 使用 mammoth 解析 Word 文件
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else if (file.name.endsWith(".txt")) {
        text = await file.text();
      } else {
        throw new Error("不支持的文件格式，请上传 .docx 或 .txt 文件");
      }

      if (!text.trim()) {
        throw new Error("未能从文件中提取到有效文字，请尝试直接粘贴文本");
      }

      onUpload({ text, fileName: file.name });
    } catch (err: any) {
      console.error("File processing error:", err);
      setError(err.message || "文件解析失败");
      setFile(null);
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl p-8 transition-all duration-200
          flex flex-col items-center justify-center text-center gap-4
          ${isDragging ? "border-indigo-500 bg-indigo-50/50" : "border-slate-200 bg-white"}
          ${error ? "border-red-200 bg-red-50/30" : ""}
        `}
      >
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${error ? "bg-red-100 text-red-600" : "bg-indigo-50 text-indigo-600"}`}>
          {error ? <AlertCircle size={24} /> : <Upload size={24} />}
        </div>
        
        <div className="space-y-1">
          <p className={`font-medium ${error ? "text-red-900" : "text-slate-900"}`}>
            {error ? error : (file ? file.name : "点击或拖拽上传简历")}
          </p>
          <p className="text-sm text-slate-500">
            仅支持 Word (.docx) 或 纯文本 (.txt)
          </p>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
          accept=".docx,.txt"
        />

        <Button
          variant={error ? "danger" : "outline"}
          onClick={() => fileInputRef.current?.click()}
          className="mt-2"
        >
          {error ? "重试上传" : "选择文件"}
        </Button>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-slate-50 px-2 text-slate-500 font-semibold text-indigo-600">推荐方案：直接粘贴简历文本</span>
        </div>
      </div>

      <textarea
        placeholder="为了获得最精准的面试体验，建议直接在此粘贴您的简历全文（包含个人信息、工作经历、项目描述等）..."
        className="w-full h-40 p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-sm shadow-inner bg-white"
        onChange={(e) => onUpload({ text: e.target.value, fileName: "Pasted Text" })}
      />
    </div>
  );
}
