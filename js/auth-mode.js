
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
    console.error("Amora: Required authentication elements were not found.");
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
    }

    if (nameLabel) {
      nameLabel.style.display = isSignup ? "" : "none";
    }

    if (usernameRow) {
      usernameRow.style.display = isSignup ? "" : "none";
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

    if (passwordInput) {
      passwordInput.autocomplete = isSignup
        ? "new-password"
        : "current-password";
    }

    if (status) {
      status.textContent = "";
    }
  }

  loginButton.addEventListener("click", (event) => {
    event.preventDefault();
    setMode(mode === "signup" ? "login" : "signup");
  });

  setMode("signup");
});
