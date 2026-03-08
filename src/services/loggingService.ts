import { createClient } from '@supabase/supabase-js';

// 这些变量需要在 Netlify 的 Environment Variables 中设置
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('supabase_url');
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('supabase_key');

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
  if (!supabase || !supabaseUrl || !supabaseKey) {
    // 如果没有配置 Supabase，静默失败，不影响用户使用
    return;
  }

  try {
    const { error } = await supabase.from('usage_logs').insert([
      {
        ...log,
        timestamp: new Date().toISOString(),
        // 可以在这里添加更多元数据，如浏览器信息等
      }
    ]);

    if (error) throw error;
  } catch (err) {
    console.error('Failed to log usage:', err);
  }
}
