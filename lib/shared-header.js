// Spec Analyzer Shared Header Component
// Creates a consistent header across all pages

import { supabase } from './supabase.js';

const SpecAnalyzerHeader = {
    userProfile: null,

    async init() {
        await this.renderHeader();
        await this.loadUserInfo();
        this.attachEventListeners();
    },

    async renderHeader() {
        const currentPath = window.location.pathname;

        const headerHTML = `
            <header class="bg-gradient-to-r from-brand-primary to-brand-primary-soft text-white shadow-md">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
                    <!-- Left: Logo & Nav -->
                    <div class="flex items-center gap-6">
                        <a href="/dashboard.html" class="flex items-center gap-2 text-white no-underline hover:opacity-90 transition-opacity">
                            <span class="text-xl font-bold font-display">PM4Subs</span>
                            <span class="text-[10px] font-bold px-2 py-0.5 bg-white/20 rounded-full uppercase tracking-wide">Spec Analyzer</span>
                        </a>

                        <!-- Desktop Nav -->
                        <nav class="hidden md:flex items-center gap-1">
                            <a href="/dashboard.html" class="px-3 py-1.5 text-sm font-medium text-white/80 rounded-md transition-colors hover:text-white hover:bg-white/10 ${currentPath.includes('dashboard') ? 'bg-white/15 text-white' : ''}">
                                Jobs
                            </a>
                            <a href="/upload.html" class="px-3 py-1.5 text-sm font-medium text-white/80 rounded-md transition-colors hover:text-white hover:bg-white/10 ${currentPath.includes('upload') ? 'bg-white/15 text-white' : ''}">
                                New Analysis
                            </a>
                        </nav>
                    </div>

                    <!-- Right: User -->
                    <div class="flex items-center gap-3">
                        <span class="hidden sm:block text-sm text-white/70" id="headerUserEmail"></span>
                        <div class="w-9 h-9 bg-white text-brand-primary rounded-full flex items-center justify-center text-sm font-semibold cursor-pointer hover:bg-white/90 transition-colors" id="headerUserAvatar" title="User">
                            --
                        </div>
                        <button class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white/80 bg-white/10 border border-white/20 rounded-md hover:bg-white/20 hover:text-white transition-colors" id="headerLogoutBtn">
                            Sign Out
                        </button>
                    </div>
                </div>
            </header>

            <!-- Mobile Nav Bar -->
            <nav class="md:hidden bg-brand-surface border-b border-brand-border px-4 py-2 flex items-center justify-around">
                <a href="/dashboard.html" class="flex flex-col items-center gap-1 px-3 py-1 text-xs font-medium ${currentPath.includes('dashboard') ? 'text-brand-primary' : 'text-brand-text-muted'} hover:text-brand-primary transition-colors">
                    <span class="text-lg">📁</span>
                    <span>Jobs</span>
                </a>
                <a href="/upload.html" class="flex flex-col items-center gap-1 px-3 py-1 text-xs font-medium ${currentPath.includes('upload') ? 'text-brand-primary' : 'text-brand-text-muted'} hover:text-brand-primary transition-colors">
                    <span class="text-lg">📄</span>
                    <span>Analyze</span>
                </a>
                <button class="flex flex-col items-center gap-1 px-3 py-1 text-xs font-medium text-brand-text-muted hover:text-brand-primary transition-colors" id="mobileLogoutBtn">
                    <span class="text-lg">🚪</span>
                    <span>Logout</span>
                </button>
            </nav>
        `;

        // Insert header at the beginning of body
        const headerContainer = document.createElement('div');
        headerContainer.id = 'spec-analyzer-header';
        headerContainer.innerHTML = headerHTML;
        document.body.insertBefore(headerContainer, document.body.firstChild);
    },

    async loadUserInfo() {
        try {
            const { data: { user }, error } = await supabase.auth.getUser();

            if (error || !user) {
                console.log('No user logged in');
                return;
            }

            const email = user.email || '';
            const fullName = user.user_metadata?.full_name || email.split('@')[0];
            const initials = this.getInitials(fullName);

            // Update UI
            const avatarEl = document.getElementById('headerUserAvatar');
            const emailEl = document.getElementById('headerUserEmail');

            if (avatarEl) {
                avatarEl.textContent = initials;
                avatarEl.title = fullName;
            }

            if (emailEl) {
                emailEl.textContent = email;
            }

            this.userProfile = { email, fullName, initials };
        } catch (error) {
            console.error('Error loading user info:', error);
        }
    },

    getInitials(name) {
        if (!name) return '--';
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    },

    attachEventListeners() {
        const logoutBtn = document.getElementById('headerLogoutBtn');
        const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');

        const handleLogout = async () => {
            if (confirm('Are you sure you want to sign out?')) {
                try {
                    await supabase.auth.signOut();
                    window.location.href = '/login.html';
                } catch (error) {
                    console.error('Logout error:', error);
                    window.location.href = '/login.html';
                }
            }
        };

        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
        }

        if (mobileLogoutBtn) {
            mobileLogoutBtn.addEventListener('click', handleLogout);
        }
    }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SpecAnalyzerHeader.init());
} else {
    SpecAnalyzerHeader.init();
}

// Make globally available
window.SpecAnalyzerHeader = SpecAnalyzerHeader;

export default SpecAnalyzerHeader;
