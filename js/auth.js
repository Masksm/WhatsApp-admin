
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
    nameInput.maxLength = 30;
    nameInput.autocomplete = "nickname";
    nameInput.pattern = "[A-Za-z0-9_]{3,30}";
    nameInput.title = "Use 3–30 letters, numbers, or underscores.";

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
    // Only hide the auth form when this page actually has a dashboard panel.
    // The login/signup page must keep its form visible until a session is verified.
    if (dashboardPanel) {
      dashboardPanel.hidden = false;
      if (authPanel) authPanel.hidden = true;
    }
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
  if (!supabase) {
    showDashboard(null);
    setStatus(byId("auth-status"), "Authentication is currently unavailable.", true);
    return;
  }

  // getSession() only reads the browser's saved session. It does not prove
  // that the account still exists, so verify the access token with Supabase Auth.
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    showDashboard(null);
    setStatus(byId("auth-status"), "Your saved session could not be verified. Log in again.", true);
    return;
  }

  const session = data.session;
  if (!session?.access_token) {
    showDashboard(null);
    setAuthMode(params.get("auth") === "login" ? "login" : "signup");
    return;
  }

  const { data: verifiedData, error: verifyError } =
    await supabase.auth.getUser(session.access_token);
  const verifiedUser = verifiedData?.user || null;

  // A cached token without a real, currently recognised account is not a login.
  if (verifyError || !verifiedUser || verifiedUser.id !== session.user?.id) {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // The form still remains available even if local cleanup fails.
    }
    showDashboard(null);
    setAuthMode(params.get("auth") === "login" ? "login" : "signup");
    setStatus(
      byId("auth-status"),
      "Your saved session is invalid or its account no longer exists. Please log in again.",
      true
    );
    return;
  }

  showDashboard(verifiedUser);
  await processPendingClaims();
  window.location.replace("/pages/social-home.html");
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

  if (authMode === "signup" && !/^[A-Za-z0-9_]{3,30}$/.test(name)) {
    setStatus(
      status,
      "Username must contain 3–30 letters, numbers, or underscores.",
      true
    );
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
      const { data: signupData, error: signupError } = await supabase.functions.invoke(
        "auth-email-request",
        { body: { action: "signup", email, password, name } }
      );
      if (signupError) {
        let message = signupError.message || "Could not create your account.";
        try {
          const responseBody = await signupError.context?.json();
          if (responseBody?.error) message = responseBody.error;
        } catch {}
        throw new Error(message);
      }
      if (signupData?.error) throw new Error(signupData.error);
      result = { data: { session: null, user: null }, error: null };
    } else {
      result = await supabase.auth.signInWithPassword({
        email,
        password
      });
    }

    if (result.error) throw result.error;

    if (result.data.session?.user) {
      await processPendingClaims();
      window.location.replace("/pages/social-home.html");
      return;
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

function isPasswordRecoveryCallback() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.get("type") === "recovery" || hash.get("type") === "recovery";
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
    // Do not treat a browser-cached session as verified here. refreshAuthenticatedUser()
    // checks the token against Supabase Auth before any redirect is allowed.
    if (!session?.user) showDashboard(null);

    if (session?.user) {
      // Defer this call to avoid blocking the auth callback.
      setTimeout(() => {
        processPendingClaims();
      }, 0);
    }
  });

  if (isPasswordRecoveryCallback()) {
    // A recovery session is not a normal login. Leave the recovery screen visible
    // so the user can choose a new password instead of being sent to the feed.
    showDashboard(null);
    return;
  }

  refreshAuthenticatedUser();
}

export {
  initAuth,
  getPendingClaimTokens,
  savePendingClaimTokens,
  processPendingClaims,
  showDashboard
};
