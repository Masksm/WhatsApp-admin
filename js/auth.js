
import {
  $,
  byId,
  params,
  supabase,
  setStatus,
  getErrorMessage
} from "./core.js";

const CLAIM_STORAGE_KEY = "amora_pending_claim_tokens";

let authMode = "signup";
let initialized = false;

function getPendingClaimTokens() {
  try {
    const stored = sessionStorage.getItem(CLAIM_STORAGE_KEY);
    const tokens = stored ? JSON.parse(stored) : [];

    return Array.isArray(tokens)
      ? tokens.filter(
          (token) =>
            typeof token === "string" &&
            /^[a-f0-9]{64}$/.test(token)
        )
      : [];
  } catch {
    return [];
  }
}

function savePendingClaimTokens(tokens) {
  try {
    const validTokens = Array.isArray(tokens)
      ? tokens.filter(
          (token) =>
            typeof token === "string" &&
            /^[a-f0-9]{64}$/.test(token)
        )
      : [];

    sessionStorage.setItem(
      CLAIM_STORAGE_KEY,
      JSON.stringify([...new Set(validTokens)])
    );
  } catch {
    // Storage may be unavailable in private browsing.
  }
}

function setAuthMode(mode) {
  authMode = mode === "login" ? "login" : "signup";

  const nameInput = byId("auth-name");
  const emailInput = byId("auth-email");
  const passwordInput = byId("auth-password");
  const loginButton = byId("login-button");
  const heading = $("#auth-panel > h2");
  const submitButton = byId("auth-form")?.querySelector(
    'button[type="submit"]'
  );

  if (nameInput) {
    nameInput.style.display =
      authMode === "signup" ? "" : "none";
    nameInput.required = authMode === "signup";

    const label = document.querySelector(
      'label[for="auth-name"]'
    );

    if (label) {
      label.style.display =
        authMode === "signup" ? "" : "none";
    }
  }

  if (passwordInput) {
    passwordInput.autocomplete =
      authMode === "signup" ? "new-password" : "current-password";
  }

  if (heading) {
    heading.textContent =
      authMode === "signup"
        ? "Create your account"
        : "Welcome back";
  }

  if (submitButton) {
    submitButton.textContent =
      authMode === "signup"
        ? "Create account 💗"
        : "Log in 💗";
  }

  if (loginButton) {
    loginButton.textContent =
      authMode === "signup"
        ? "I already have an account"
        : "Create a new account";
  }

  const status = byId("auth-status");
  if (status) status.textContent = "";

  if (emailInput) emailInput.autocomplete = "email";
}

function showDashboard(user) {
  const authPanel = byId("auth-panel");
  const dashboardPanel = byId("dashboard-panel");
  const email = byId("dashboard-email");

  if (user) {
    if (authPanel) authPanel.hidden = true;
    if (dashboardPanel) dashboardPanel.hidden = false;
    if (email) email.textContent = user.email || "";
    return;
  }

  if (dashboardPanel) dashboardPanel.hidden = true;

  if (authPanel) {
    authPanel.hidden = params.has("anon");
  }
}

async function processPendingClaims() {
  if (!supabase) return;

  const tokens = getPendingClaimTokens();
  if (!tokens.length) return;

  const status = byId("dashboard-status");
  const remaining = [];
  let claimedCount = 0;
  let failureMessage = "";

  for (const token of tokens) {
    try {
      const { data, error } = await supabase.rpc(
        "claim_anonymous_message",
        { p_token: token }
      );

      if (error) throw error;

      if (
        typeof data !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(data)
      ) {
        throw new Error("The claim response was not valid.");
      }

      claimedCount++;
    } catch (error) {
      remaining.push(token);
      failureMessage =
        getErrorMessage(error, "Could not claim a message.");
    }
  }

  savePendingClaimTokens(remaining);

  if (claimedCount > 0) {
    setStatus(
      status,
      `${claimedCount} anonymous message${claimedCount === 1 ? "" : "s"} claimed successfully.` +
        (remaining.length
          ? ` ${remaining.length} will be retried later.`
          : "")
    );
  } else if (remaining.length) {
    setStatus(
      status,
      failureMessage ||
        "Your messages could not be claimed yet. They have been kept for retry.",
      true
    );
  }
}

async function refreshAuthenticatedUser() {
  if (!supabase) return;

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    setStatus(byId("auth-status"), error.message, true);
    return;
  }

  const user = data.session?.user || null;
  showDashboard(user);

  if (user) {
    await processPendingClaims();
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  if (!supabase) {
    setStatus(
      byId("auth-status"),
      "Authentication is currently unavailable.",
      true
    );
    return;
  }

  const name = byId("auth-name")?.value.trim() || "";
  const email = byId("auth-email")?.value.trim() || "";
  const password = byId("auth-password")?.value || "";
  const status = byId("auth-status");
  const submitButton = byId("auth-form")?.querySelector(
    'button[type="submit"]'
  );

  if (!email || !password) {
    setStatus(status, "Enter your email and password.", true);
    return;
  }

  if (authMode === "signup" && !name) {
    setStatus(status, "Enter a display name.", true);
    return;
  }

  if (submitButton) submitButton.disabled = true;
  setStatus(
    status,
    authMode === "signup"
      ? "Creating your account..."
      : "Signing you in..."
  );

  try {
    let result;

    if (authMode === "signup") {
      result = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name }
        }
      });
    } else {
      result = await supabase.auth.signInWithPassword({
        email,
        password
      });
    }

    if (result.error) throw result.error;

    if (result.data.session?.user) {
      showDashboard(result.data.session.user);
      await processPendingClaims();
    } else if (authMode === "signup") {
      setStatus(
        status,
        "Account created. Check your email if confirmation is required."
      );
    } else {
      setStatus(
        status,
        "Login completed, but no active session was returned.",
        true
      );
    }
  } catch (error) {
    setStatus(
      status,
      getErrorMessage(error, "Authentication failed."),
      true
    );
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function handleLogout() {
  if (!supabase) return;

  const { error } = await supabase.auth.signOut();

  if (error) {
    setStatus(byId("dashboard-status"), error.message, true);
    return;
  }

  showDashboard(null);
  setAuthMode("login");
  setStatus(byId("auth-status"), "You have signed out.");
}

function initAuth() {
  if (initialized) return;
  initialized = true;

  const requestedMode = params.get("auth");

  setAuthMode(
    requestedMode === "login" ? "login" : "signup"
  );

  if (requestedMode && byId("auth-panel")) {
    byId("auth-panel").scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }

  byId("auth-form")?.addEventListener(
    "submit",
    handleAuthSubmit
  );

  byId("login-button")?.addEventListener("click", () => {
    setAuthMode(authMode === "signup" ? "login" : "signup");
  });

  byId("logout-button")?.addEventListener(
    "click",
    handleLogout
  );

  if (!supabase) return;

  supabase.auth.onAuthStateChange((_event, session) => {
    showDashboard(session?.user || null);

    if (session?.user) {
      // Defer Supabase calls to avoid blocking the auth callback.
      setTimeout(() => {
        processPendingClaims();
      }, 0);
    }
  });

  refreshAuthenticatedUser();
}

export {
  initAuth,
  getPendingClaimTokens,
  savePendingClaimTokens,
  processPendingClaims,
  showDashboard
};
