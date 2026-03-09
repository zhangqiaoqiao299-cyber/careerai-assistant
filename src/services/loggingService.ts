import { createClient } from '@supabase/supabase-js';

// 这些变量需要在 Netlify 的 Environment Variables 中设置
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 延迟初始化，防止在没有环境变量时崩溃
export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

export interface UsageLog {
  action: 'analysis' | 'interview_start' | 'interview_message';
  company_name?: string;
  resume_filename?: string;
  details?: any;
}

export async function logUsage(log: UsageLog) {
  if (!supabase) return;

  try {
    const { error } = await supabase.from('usage_logs').insert([
      {
        ...log,
        timestamp: new Date().toISOString(),
      }
    ]);

    if (error) throw error;
  } catch (err) {
    console.error('Failed to log usage:', err);
  }
}

export async function saveResume(resume: { fileName: string; text: string }, companyName: string) {
  if (!supabase) return;

  try {
    const { error } = await supabase.from('resumes').insert([
      {
        file_name: resume.fileName,
        resume_text: resume.text,
        company_name: companyName,
        created_at: new Date().toISOString(),
      }
    ]);

    if (error) throw error;
  } catch (err) {
    console.error('Failed to save resume:', err);
  }
}
