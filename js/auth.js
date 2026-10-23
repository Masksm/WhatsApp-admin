
import {
  $,
  byId,
  params,
  supabase,
  setStatus,
  getErrorMessage,
  showToast
} from "./core.js";

// ============================================================
// AMORA AUTHENTICATION
// Signup, login, logout, session restoration and message claims
// ============================================================

let authMode = params.get("auth") === "signup" ? "signup" : "login";
let claimProcessing = false;

const CLAIM_STORAGE_KEY = "amora_pending_claim_tokens";

function setAuthStatus(message, isError = false) {
  setStatus(byId("auth-status"), message, isError);
}

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "login";

  const nameField = byId("auth-name");
  const passwordField = byId("auth-password");
  const loginButton = byId("login-button");

  if (nameField) {
    nameField.closest(".form-group, .field, label")?.classList.toggle(
      "hidden",
      authMode !== "signup"
    );

    nameField.required = authMode === "signup";
  }

  if (loginButton) {
    loginButton.textContent =
      authMode === "signup" ? "Create account" : "Log in";
  }

  if (passwordField) {
    passwordField.autocomplete =
      authMode === "signup" ? "new-password" : "current-password";
  }

  setAuthStatus("");

  const heading = byId("auth-heading");
  if (heading) {
    heading.textContent =
      authMode === "signup" ? "Create your Amora account" : "Welcome back";
  }

  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    const active = button.dataset.authMode === authMode;
    button.setAttribute("aria-pressed", String(active));
  });
}

function getPendingClaimTokens() {
  try {
    const stored = sessionStorage.getItem(CLAIM_STORAGE_KEY);
    const tokens = stored ? JSON.parse(stored) : [];

    if (!Array.isArray(tokens)) return [];

    return [...new Set(
      tokens.filter((token) =>
        typeof token === "string" &&
        /^[a-f0-9]{64}$/i.test(token)
      )
    )];
  } catch (_) {
    return [];
  }
}

function savePendingClaimTokens(tokens) {
  const validTokens = [...new Set(
    tokens.filter((token) =>
      typeof token === "string" &&
      /^[a-f0-9]{64}$/i.test(token)
    )
  )];

  try {
    if (validTokens.length) {
      sessionStorage.setItem(
        CLAIM_STORAGE_KEY,
        JSON.stringify(validTokens)
      );
    } else {
      sessionStorage.removeItem(CLAIM_STORAGE_KEY);
    }
  } catch (_) {
    // Session storage may be unavailable in some browser contexts.
  }
}

async function processPendingClaims() {
  if (!supabase || claimProcessing) return;

  const tokens = getPendingClaimTokens();
  if (!tokens.length) return;

  claimProcessing = true;

  const remaining = [];

  try {
    for (const token of tokens) {
      const { data, error } = await supabase.rpc(
        "claim_anonymous_message",
        { p_token: token }
      );

      if (error) {
        const message = error.message || "";

        // Keep tokens that may succeed later.
        if (
          /network|timeout|temporar|rate limit|fetch/i.test(message)
        ) {
          remaining.push(token);
        }

        console.warn("Unable to claim an anonymous message:", message);
        continue;
      }

      const conversationId = Array.isArray(data) ? data[0] : data;

      if (
        typeof conversationId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          conversationId
        )
      ) {
        console.warn("The claim RPC returned an unexpected result.");
      }
    }
  } finally {
    savePendingClaimTokens(remaining);
    claimProcessing = false;
  }
}

function showDashboard(user) {
  const authPanel = byId("auth-panel");
  const dashboardPanel = byId("dashboard-panel");
  const dashboardEmail = byId("dashboard-email");
  const dashboardStatus = byId("dashboard-status");

  // Public anonymous-message pages must remain accessible.
  if (!params.has("anon") && authPanel && dashboardPanel) {
    authPanel.hidden = true;
    dashboardPanel.hidden = false;
  }

  if (dashboardEmail) {
    dashboardEmail.textContent = user?.email || "";
  }

  if (dashboardStatus) {
    dashboardStatus.textContent = user
      ? "You're signed in to Amora."
      : "";
  }
}

async function refreshAuthenticatedUser() {
  if (!supabase) return;

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error("Unable to restore the Amora session:", error.message);
    return;
  }

  const user = data.session?.user;

  if (user) {
    showDashboard(user);
    await processPendingClaims();
  } else {
    const authPanel = byId("auth-panel");
    const dashboardPanel = byId("dashboard-panel");

    if (authPanel) authPanel.hidden = false;
    if (dashboardPanel) dashboardPanel.hidden = true;
  }
}

function initAuth() {
  if (!supabase) {
    console.error("Amora Supabase client is unavailable.");
    setAuthStatus("Unable to connect. Please try again later.", true);
    return;
  }

  const authForm = byId("auth-form");
  const emailField = byId("auth-email");
  const passwordField = byId("auth-password");
  const nameField = byId("auth-name");
  const loginButton = byId("login-button");
  const logoutButton = byId("logout-button");

  setAuthMode(authMode);

  // Support explicit mode-switch controls without requiring them.
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setAuthMode(button.dataset.authMode);
    });
  });

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailField?.value.trim() || "";
    const password = passwordField?.value || "";
    const name = nameField?.value.trim() || "";

    if (!email || !password) {
      setAuthStatus("Enter your email and password.", true);
      return;
    }

    if (authMode === "signup" && !name) {
      setAuthStatus("Enter your name to create an account.", true);
      nameField?.focus();
      return;
    }

    if (loginButton) {
      loginButton.disabled = true;
      loginButton.textContent =
        authMode === "signup" ? "Creating account…" : "Logging in…";
    }

    setAuthStatus("");

    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name }
          }
        });

        if (error) throw error;

        if (data.session && data.user) {
          showDashboard(data.user);
          await processPendingClaims();
          setAuthStatus("Your account has been created.");
        } else {
          setAuthStatus(
            "Account created. Check your email to confirm your account."
          );
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;

        if (data.user) {
          showDashboard(data.user);
          await processPendingClaims();
          setAuthStatus("Login successful.");
        }
      }
    } catch (error) {
      setAuthStatus(
        getErrorMessage(error, "Authentication failed. Please try again."),
        true
      );
    } finally {
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent =
          authMode === "signup" ? "Create account" : "Log in";
      }
    }
  });

  logoutButton?.addEventListener("click", async () => {
    logoutButton.disabled = true;

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      showToast("You've logged out.");

      const authPanel = byId("auth-panel");
      const dashboardPanel = byId("dashboard-panel");

      if (authPanel) authPanel.hidden = false;
      if (dashboardPanel) dashboardPanel.hidden = true;

      setAuthStatus("");
    } catch (error) {
      setAuthStatus(
        getErrorMessage(error, "Unable to log out. Please try again."),
        true
      );
    } finally {
      logoutButton.disabled = false;
    }
  });

  // Restore the current session and react to future auth changes.
  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      showDashboard(session.user);

      // Defer the RPC work so it does not run inside the auth callback.
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        setTimeout(() => {
          processPendingClaims();
        }, 0);
      }
    } else if (
      event === "SIGNED_OUT" ||
      event === "INITIAL_SESSION"
    ) {
      const authPanel = byId("auth-panel");
      const dashboardPanel = byId("dashboard-panel");

      if (authPanel) authPanel.hidden = false;
      if (dashboardPanel) dashboardPanel.hidden = true;
    }
  });

  refreshAuthenticatedUser();
}

export {
  initAuth,
  setAuthMode,
  processPendingClaims,
  getPendingClaimTokens,
  savePendingClaimTokens,
  refreshAuthenticatedUser
};
