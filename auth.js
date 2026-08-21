import { supabase } from "./lib/supabase.js";

document.addEventListener("DOMContentLoaded", async function () {
  // Check if user is already logged in
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    window.location.href = "/dashboard.html";
    return;
  }

  // DOM elements
  const loginTab = document.querySelector('[data-tab="login"]');
  const signupTab = document.querySelector('[data-tab="signup"]');
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const messageBox = document.getElementById("messageBox");
  const loginBtn = document.getElementById("loginBtn");
  const signupBtn = document.getElementById("signupBtn");

  // Tab switching
  loginTab.addEventListener("click", () => switchTab("login"));
  signupTab.addEventListener("click", () => switchTab("signup"));

  function switchTab(tab) {
    if (tab === "login") {
      loginTab.classList.add("active");
      signupTab.classList.remove("active");
      loginForm.style.display = "block";
      signupForm.style.display = "none";
    } else {
      signupTab.classList.add("active");
      loginTab.classList.remove("active");
      signupForm.style.display = "block";
      loginForm.style.display = "none";
    }
    hideAllPasswords();
    hideMessage();
  }

  // Password show/hide toggles
  const passwordToggles = document.querySelectorAll("[data-toggle-password]");

  passwordToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const input = document.getElementById(toggle.dataset.togglePassword);
      if (!input) return;

      const reveal = input.type === "password";
      const start = input.selectionStart;
      const end = input.selectionEnd;

      setToggleState(toggle, input, reveal);

      // Changing type resets the caret, so put it back where they were typing
      input.focus({ preventScroll: true });
      try {
        input.setSelectionRange(start, end);
      } catch {
        // Some browsers refuse setSelectionRange on password inputs
      }
    });
  });

  function setToggleState(toggle, input, reveal) {
    input.type = reveal ? "text" : "password";
    toggle.textContent = reveal ? "Hide" : "Show";
    toggle.setAttribute("aria-pressed", String(reveal));
    toggle.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
  }

  // Never leave a password revealed on a form the user has navigated away from
  function hideAllPasswords() {
    passwordToggles.forEach((toggle) => {
      const input = document.getElementById(toggle.dataset.togglePassword);
      if (input) setToggleState(toggle, input, false);
    });
  }

  // Login form handler
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!email || !password) {
      showMessage("Please fill in all fields", "error");
      return;
    }

    setLoading(loginBtn, true);
    hideMessage();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(loginBtn, false);

    if (error) {
      showMessage(error.message, "error");
    } else {
      showMessage("Login successful! Redirecting...", "success");

      // Create subscription record if it doesn't exist
      await createSubscriptionIfNeeded(data.user.id);

      setTimeout(() => {
        window.location.href = "/dashboard.html";
      }, 500);
    }
  });

  // Signup form handler
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const displayName = document
      .getElementById("signupDisplayName")
      .value.trim();
    const companyName = document
      .getElementById("signupCompanyName")
      .value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const confirmPassword = document.getElementById(
      "signupPasswordConfirm",
    ).value;

    if (!displayName || !companyName || !email || !password || !confirmPassword) {
      showMessage("Please fill in all fields", "error");
      return;
    }

    if (password !== confirmPassword) {
      showMessage("Passwords do not match", "error");
      return;
    }

    if (password.length < 6) {
      showMessage("Password must be at least 6 characters", "error");
      return;
    }

    setLoading(signupBtn, true);
    hideMessage();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard.html`,
        data: {
          // handle_new_user() reads full_name and company_name. display_name is
          // kept for back-compat with accounts created before this change.
          full_name: displayName,
          display_name: displayName,
          company_name: companyName,
          // Tells the trigger not to build a companies/memberships row - the
          // spec analyzer is single-user per account.
          app: "spec-analyzer",
        },
      },
    });

    setLoading(signupBtn, false);

    if (error) {
      showMessage(error.message, "error");
    } else if (data.user?.identities?.length === 0) {
      // User already exists - identities array is empty for existing users
      showMessage(
        "An account with this email already exists. Please sign in instead.",
        "error",
      );
    } else {
      // Create subscription record for new user
      if (data.user) {
        await createSubscriptionIfNeeded(data.user.id);
      }

      showMessage(
        "Account created! Check your email to verify your account.",
        "success",
      );

      // Switch to login tab after a delay
      setTimeout(() => {
        switchTab("login");
        document.getElementById("loginEmail").value = email;
      }, 3000);
    }
  });

  // Forgot password link
  document
    .querySelector(".forgot-link")
    .addEventListener("click", async (e) => {
      e.preventDefault();

      const email = document.getElementById("loginEmail").value.trim();

      if (!email) {
        showMessage("Please enter your email address first", "error");
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password.html`,
      });

      if (error) {
        showMessage(error.message, "error");
      } else {
        showMessage("Password reset email sent! Check your inbox.", "success");
      }
    });

  // Helper functions
  function showMessage(message, type) {
    messageBox.textContent = message;
    messageBox.className = `message-box ${type}`;
    messageBox.style.display = "block";
  }

  function hideMessage() {
    messageBox.style.display = "none";
  }

  function setLoading(button, isLoading) {
    if (isLoading) {
      button.disabled = true;
      button.classList.add("loading");
    } else {
      button.disabled = false;
      button.classList.remove("loading");
    }
  }

  // Create subscription record for new users
  async function createSubscriptionIfNeeded(userId) {
    try {
      // Check if subscription already exists (use maybeSingle to avoid 406 error)
      const { data: existing } = await supabase
        .from("user_subscriptions")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (!existing) {
        // Create new subscription record
        const { error } = await supabase.from("user_subscriptions").insert({
          user_id: userId,
          plan: "free",
          status: "active",
        });

        if (error) {
          // 409 = already exists (race condition), which is fine
          // 403/401 = RLS policy blocking insert (expected for unverified users)
          if (error.code !== "23505" && error.code !== "PGRST301") {
            console.error("Error creating subscription:", error);
          }
        }
      }
    } catch (error) {
      console.error("Error in createSubscriptionIfNeeded:", error);
    }
  }
});
