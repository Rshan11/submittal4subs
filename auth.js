import { supabase } from './lib/supabase.js'

document.addEventListener('DOMContentLoaded', async function() {
    // Check if user is already logged in
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
        window.location.href = '/dashboard.html'
        return
    }

    // DOM elements
    const loginTab = document.querySelector('[data-tab="login"]')
    const signupTab = document.querySelector('[data-tab="signup"]')
    const loginForm = document.getElementById('loginForm')
    const signupForm = document.getElementById('signupForm')
    const messageBox = document.getElementById('messageBox')
    const loginBtn = document.getElementById('loginBtn')
    const signupBtn = document.getElementById('signupBtn')

    // Tab switching
    loginTab.addEventListener('click', () => switchTab('login'))
    signupTab.addEventListener('click', () => switchTab('signup'))

    function switchTab(tab) {
        if (tab === 'login') {
            loginTab.classList.add('active')
            signupTab.classList.remove('active')
            loginForm.style.display = 'block'
            signupForm.style.display = 'none'
        } else {
            signupTab.classList.add('active')
            loginTab.classList.remove('active')
            signupForm.style.display = 'block'
            loginForm.style.display = 'none'
        }
        hideMessage()
    }

    // Login form handler
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault()
        
        const email = document.getElementById('loginEmail').value.trim()
        const password = document.getElementById('loginPassword').value

        if (!email || !password) {
            showMessage('Please fill in all fields', 'error')
            return
        }

        setLoading(loginBtn, true)
        hideMessage()

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        })

        setLoading(loginBtn, false)

        if (error) {
            showMessage(error.message, 'error')
        } else {
            showMessage('Login successful! Redirecting...', 'success')
            
            // Create subscription record if it doesn't exist
            await createSubscriptionIfNeeded(data.user.id, email)
            
            setTimeout(() => {
                window.location.href = '/dashboard.html'
            }, 500)
        }
    })

    // Signup form handler
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault()
        
        const email = document.getElementById('signupEmail').value.trim()
        const password = document.getElementById('signupPassword').value
        const confirmPassword = document.getElementById('signupPasswordConfirm').value

        if (!email || !password || !confirmPassword) {
            showMessage('Please fill in all fields', 'error')
            return
        }

        if (password !== confirmPassword) {
            showMessage('Passwords do not match', 'error')
            return
        }

        if (password.length < 6) {
            showMessage('Password must be at least 6 characters', 'error')
            return
        }

        setLoading(signupBtn, true)
        hideMessage()

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: `${window.location.origin}/dashboard.html`
            }
        })

        setLoading(signupBtn, false)

        if (error) {
            showMessage(error.message, 'error')
        } else {
            // Create subscription record for new user
            if (data.user) {
                await createSubscriptionIfNeeded(data.user.id, email)
            }
            
            showMessage('Account created! Check your email to verify your account.', 'success')
            
            // Switch to login tab after a delay
            setTimeout(() => {
                switchTab('login')
                document.getElementById('loginEmail').value = email
            }, 3000)
        }
    })

    // Forgot password link
    document.querySelector('.forgot-link').addEventListener('click', async (e) => {
        e.preventDefault()
        
        const email = document.getElementById('loginEmail').value.trim()
        
        if (!email) {
            showMessage('Please enter your email address first', 'error')
            return
        }

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password.html`
        })

        if (error) {
            showMessage(error.message, 'error')
        } else {
            showMessage('Password reset email sent! Check your inbox.', 'success')
        }
    })

    // Helper functions
    function showMessage(message, type) {
        messageBox.textContent = message
        messageBox.className = `message-box ${type}`
        messageBox.style.display = 'block'
    }

    function hideMessage() {
        messageBox.style.display = 'none'
    }

    function setLoading(button, isLoading) {
        if (isLoading) {
            button.disabled = true
            button.classList.add('loading')
        } else {
            button.disabled = false
            button.classList.remove('loading')
        }
    }

    // Create subscription record for new users
    async function createSubscriptionIfNeeded(userId, email) {
        try {
            // Check if subscription already exists
            const { data: existing } = await supabase
                .from('user_subscriptions')
                .select('id')
                .eq('user_id', userId)
                .single()

            if (!existing) {
                // Create new subscription record
                await supabase
                    .from('user_subscriptions')
                    .insert({
                        user_id: userId,
                        plan: 'free',
                        status: 'active'
                    })
            }
        } catch (error) {
            console.error('Error creating subscription:', error)
        }
    }
})
