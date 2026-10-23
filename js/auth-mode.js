"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const authPanel = document.getElementById("auth-panel");
  const authForm = document.getElementById("auth-form");
  const nameInput = document.getElementById("auth-name");
  const usernameRow = document.getElementById("auth-username-row");
  const emailInput = document.getElementById("auth-email");
  const passwordInput = document.getElementById("auth-password");
  const loginButton = document.getElementById("login-button");
  const status = document.getElementById("auth-status");

  if (!authPanel || !authForm || !loginButton) {
    console.error("Amora: Authentication elements are missing.");
    return;
  }

  let mode = "signup";

  function setMode(nextMode) {
    mode = nextMode === "login" ? "login" : "signup";

    const isSignup = mode === "signup";
    const heading = authPanel.querySelector("h2");
    const submitButton = authForm.querySelector('button[type="submit"]');
    const nameLabel = document.querySelector('label[for="auth-name"]');

    if (nameInput) {
      nameInput.style.display = isSignup ? "" : "none";
      nameInput.required = isSignup;
      nameInput.maxLength = 30;
      nameInput.autocomplete = "nickname";
      nameInput.pattern = "[A-Za-z0-9_]{3,30}";
      nameInput.title =
        "Use 3–30 letters, numbers, or underscores.";
    }

    if (nameLabel) {
      nameLabel.style.display = isSignup ? "" : "none";
    }

    if (usernameRow) {
      usernameRow.style.display = isSignup ? "" : "none";
    }

    if (emailInput) {
      emailInput.type = "email";
      emailInput.required = true;
      emailInput.maxLength = 254;
      emailInput.autocomplete = "email";
    }

    if (passwordInput) {
      passwordInput.required = true;
      passwordInput.autocomplete = isSignup
        ? "new-password"
        : "current-password";
    }

    if (heading) {
      heading.textContent = isSignup
        ? "Create your account"
        : "Welcome back";
    }

    if (submitButton) {
      submitButton.textContent = isSignup
        ? "Create account 💗"
        : "Log in 💗";
    }

    loginButton.textContent = isSignup
      ? "I already have an account"
      : "Create a new account";

    if (status) {
      status.textContent = "";
    }
  }

  loginButton.addEventListener("click", (event) => {
    event.preventDefault();
    setMode(mode === "signup" ? "login" : "signup");
  });

  authForm.addEventListener("submit", (event) => {
    if (mode !== "signup" || !nameInput) return;

    const username = nameInput.value.trim();

    if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
      event.preventDefault();

      if (status) {
        status.textContent =
          "Username must contain 3–30 letters, numbers, or underscores.";
      }

      nameInput.focus();
    } else {
      nameInput.value = username;
    }
  });

  setMode("signup");
});
