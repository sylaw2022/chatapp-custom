import { createBrowserClient } from '@supabase/ssr'

export const createClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  if (!supabaseUrl || !supabaseAnonKey) {
    const missing = []
    if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL')
    if (!supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    
    throw new Error(
      `Missing Supabase environment variables: ${missing.join(', ')}\n\n` +
      `Please add these to your .env.local file:\n` +
      `1. Go to https://app.supabase.com\n` +
      `2. Select your project (or create a new one)\n` +
      `3. Go to Project Settings > API\n` +
      `4. Copy the "Project URL" and "anon public" key\n` +
      `5. Add them to .env.local as:\n` +
      `   NEXT_PUBLIC_SUPABASE_URL=your_project_url\n` +
      `   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key`
    )
  }
  
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
