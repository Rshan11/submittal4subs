// Enhanced Empty State for Dashboard
// Replace the basic empty state in dashboard.js

function renderEmptyState() {
    const tbody = document.getElementById('jobsTableBody')
    
    tbody.innerHTML = `
        <tr>
            <td colspan="5" style="padding: 0; border: none;">
                <div class="empty-state-container">
                    <div class="empty-state-content">
                        <div class="empty-state-icon">📋</div>
                        <h3 class="empty-state-title">No jobs yet</h3>
                        <p class="empty-state-description">
                            Create your first job to start organizing and analyzing construction specs
                        </p>
                        <button class="btn-primary btn-large" onclick="document.getElementById('newJobBtn').click()">
                            <span class="btn-icon">+</span>
                            Create Your First Job
                        </button>
                        
                        <div class="empty-state-help">
                            <div class="help-item">
                                <span class="help-icon">💡</span>
                                <span>Organize specs by project or building</span>
                            </div>
                            <div class="help-item">
                                <span class="help-icon">⚡</span>
                                <span>Run multiple analyses per job</span>
                            </div>
                            <div class="help-item">
                                <span class="help-icon">📊</span>
                                <span>Track status and review results</span>
                            </div>
                        </div>
                    </div>
                </div>
            </td>
        </tr>
    `
}

// Add these styles to dashboard-style.css
const emptyStateStyles = `
    .empty-state-container {
        padding: 80px 40px;
        display: flex;
        justify-content: center;
    }

    .empty-state-content {
        max-width: 500px;
        text-align: center;
    }

    .empty-state-icon {
        font-size: 80px;
        margin-bottom: 24px;
        opacity: 0.8;
    }

    .empty-state-title {
        font-size: 24px;
        font-weight: 600;
        color: #1a1a1a;
        margin-bottom: 12px;
    }

    .empty-state-description {
        font-size: 16px;
        color: #666;
        line-height: 1.6;
        margin-bottom: 32px;
    }

    .btn-large {
        padding: 14px 32px;
        font-size: 16px;
    }

    .btn-icon {
        font-size: 20px;
        margin-right: 8px;
        font-weight: 300;
    }

    .empty-state-help {
        margin-top: 40px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding-top: 32px;
        border-top: 1px solid #e5e5e5;
    }

    .help-item {
        display: flex;
        align-items: center;
        gap: 12px;
        color: #666;
        font-size: 14px;
    }

    .help-icon {
        font-size: 20px;
    }

    @media (max-width: 768px) {
        .empty-state-container {
            padding: 60px 20px;
        }

        .empty-state-icon {
            font-size: 60px;
        }

        .empty-state-title {
            font-size: 20px;
        }

        .empty-state-description {
            font-size: 14px;
        }
    }
`
