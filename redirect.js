import { supabase } from './lib/supabase.js'

async function redirect() {
    const { data: { user } } = await supabase.auth.getUser()
    window.location.href = user ? '/dashboard.html' : '/login.html'
}

redirect()
