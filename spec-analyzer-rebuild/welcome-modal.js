// Add this to dashboard.js - Welcome Modal for First-Time Users

// Call this function after loading dashboard
async function checkFirstTimeUser() {
    try {
        // Check if user has any jobs
        const { data: jobs, error } = await supabase
            .from('jobs')
            .select('id')
            .eq('user_id', currentUser.id)
            .limit(1)

        if (error) throw error

        // If no jobs, show welcome modal
        if (!jobs || jobs.length === 0) {
            showWelcomeModal()
        }
    } catch (error) {
        console.error('Error checking first-time user:', error)
    }
}

function showWelcomeModal() {
    const modal = document.createElement('div')
    modal.className = 'modal-overlay'
    modal.style.display = 'flex'
    modal.innerHTML = `
        <div class="modal welcome-modal">
            <div class="welcome-header">
                <div class="welcome-icon">👋</div>
                <h2>Welcome to Spec Analyzer!</h2>
                <p>Let's get you set up in 3 simple steps</p>
            </div>
            
            <div class="welcome-steps">
                <div class="welcome-step">
                    <div class="step-number">1</div>
                    <div class="step-content">
                        <h3>Create Your First Job</h3>
                        <p>Organize your specs by project or building</p>
                    </div>
                </div>
                
                <div class="welcome-step">
                    <div class="step-number">2</div>
                    <div class="step-content">
                        <h3>Choose Analysis Type</h3>
                        <p>Select what you want to find: Submittals, Testing, Products, or Custom</p>
                    </div>
                </div>
                
                <div class="welcome-step">
                    <div class="step-number">3</div>
                    <div class="step-content">
                        <h3>Upload Your Spec</h3>
                        <p>Drop your PDF and let us analyze it in minutes</p>
                    </div>
                </div>
            </div>
            
            <div class="welcome-footer">
                <button class="btn-primary btn-large" id="createFirstJobBtn">
                    Create My First Job
                </button>
                <button class="btn-text" id="skipWelcomeBtn">
                    I'll explore on my own
                </button>
            </div>
        </div>
    `

    // Add styles
    const style = document.createElement('style')
    style.textContent = `
        .welcome-modal {
            max-width: 600px;
        }

        .welcome-header {
            text-align: center;
            padding: 40px 40px 20px;
        }

        .welcome-icon {
            font-size: 64px;
            margin-bottom: 20px;
        }

        .welcome-header h2 {
            font-size: 28px;
            margin-bottom: 8px;
            color: #1a1a1a;
        }

        .welcome-header p {
            font-size: 16px;
            color: #666;
        }

        .welcome-steps {
            padding: 20px 40px;
        }

        .welcome-step {
            display: flex;
            gap: 20px;
            margin-bottom: 24px;
            align-items: flex-start;
        }

        .welcome-step:last-child {
            margin-bottom: 0;
        }

        .step-number {
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 18px;
            flex-shrink: 0;
        }

        .step-content h3 {
            font-size: 18px;
            margin-bottom: 4px;
            color: #1a1a1a;
        }

        .step-content p {
            font-size: 14px;
            color: #666;
            line-height: 1.5;
        }

        .welcome-footer {
            padding: 20px 40px 40px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            align-items: center;
        }

        .btn-large {
            padding: 14px 32px;
            font-size: 16px;
        }

        .btn-text {
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            font-size: 14px;
            padding: 8px;
            transition: color 0.2s;
        }

        .btn-text:hover {
            color: #1a1a1a;
        }
    `
    document.head.appendChild(style)

    document.body.appendChild(modal)

    // Event listeners
    document.getElementById('createFirstJobBtn').addEventListener('click', () => {
        modal.remove()
        document.getElementById('newJobBtn').click()
    })

    document.getElementById('skipWelcomeBtn').addEventListener('click', () => {
        modal.remove()
    })

    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove()
        }
    })
}

// Add this CSS to dashboard-style.css or include inline
const welcomeStyles = `
    .welcome-modal {
        animation: slideUp 0.4s ease-out;
    }

    @keyframes slideUp {
        from {
            opacity: 0;
            transform: translateY(30px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
`
