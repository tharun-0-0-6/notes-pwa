import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export type AppUser = {
  id: string
  email: string
  name: string
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null

export const isSupabaseConfigured = Boolean(supabase)

export function normaliseSupabaseUser(user: {
  id?: string | null
  email?: string | null
  user_metadata?: Record<string, unknown>
} | null): AppUser | null {
  if (!user?.id) {
    return null
  }

  const name =
    typeof user.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : user.email || 'User'

  return {
    id: user.id,
    email: user.email || '',
    name,
  }
}
