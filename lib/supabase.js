import { createClient } from '@supabase/supabase-js'

// Get environment variables from Vite
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Helper function to check if user is authenticated
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  return { user, error }
}

// Helper function to require authentication (redirect if not logged in)
export async function requireAuth() {
  const { user } = await getCurrentUser()
  if (!user) {
    window.location.href = '/login.html'
    return null
  }
  return user
}

// Helper function to sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (!error) {
    window.location.href = '/login.html'
  }
  return { error }
}
