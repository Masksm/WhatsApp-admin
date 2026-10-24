
(function () {
  "use strict";

  const supabase = window.amoraSupabase;

  const authForm = document.getElementById("auth-form");
const authPanel = document.getElementById("auth-panel");
  const forgotLink = document.getElementById("forgot-password-link");

  const resetSection = document.getElementById("password-reset-section");
  const resetForm = document.getElementById("password-reset-form");
  const resetEmail = document.getElementById("reset-email");
  const resetStatus = document.getElementById("password-reset-status");
  const backToLogin = document.getElementById("back-to-login");

  const newPasswordSection = document.getElementById("new-password-section");
  const newPasswordForm = document.getElementById("new-password-form");
  const newPassword = document.getElementById("new-password");
  const confirmPassword = document.getElementById("confirm-new-password");
  const newPasswordStatus = document.getElementById("new-password-status");
  const recoveryAccount = document.getElementById("recovery-account");
  const recoveryAccountEmail = document.getElementById("recovery-account-email");

  function isRecoveryLink() {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return params.get("type") === "recovery" || hash.get("type") === "recovery";
  }

  async function showRecoveryForAccount(sessionUser) {
    showSection("new-password");
    if (newPasswordStatus) newPasswordStatus.textContent = "";
    if (recoveryAccount && recoveryAccountEmail) {
      let email = sessionUser?.email || "";
      if (!email) {
        try {
          const { data } = await supabase.auth.getUser();
          email = data?.user?.email || "";
        } catch {}
      }
      recoveryAccount.hidden = false;
      recoveryAccountEmail.textContent = email || "Verified account";
    }
  }

  if (!supabase) {
    console.error("Amora Supabase client was not found.");
    return;
  }

  
function showSection(sectionToShow) {
  if (authPanel) {
    authPanel.hidden = sectionToShow !== "login";
  } else if (authForm) {
    authForm.hidden = sectionToShow !== "login";
  }

  if (resetSection) {
    resetSection.hidden = sectionToShow !== "reset";
  }

  if (newPasswordSection) {
    newPasswordSection.hidden = sectionToShow !== "new-password";
  }
}


  if (forgotLink) {
    forgotLink.addEventListener("click", function (event) {
      event.preventDefault();

      if (resetStatus) resetStatus.textContent = "";
      showSection("reset");
    });
  }

  if (backToLogin) {
    backToLogin.addEventListener("click", function () {
      if (resetStatus) resetStatus.textContent = "";
      showSection("login");
    });
  }

  if (resetForm) {
    resetForm.addEventListener("submit", async function (event) {
      event.preventDefault();

      resetStatus.textContent = "Sending recovery email...";

      const email = resetEmail.value.trim();

      try {
        const redirectTo = window.location.origin + "/pages/reset-password.html";

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: redirectTo
        });

        if (error) throw error;

        resetStatus.textContent =
          "If an account exists for that email, a recovery link will be sent. Check your inbox and spam folder.";
      } catch (error) {
        console.error("Password recovery error:", error);
        resetStatus.textContent =
          error.message || "Could not send the recovery email. Please try again.";
      }
    });
  }

  if (newPasswordForm) {
    newPasswordForm.addEventListener("submit", async function (event) {
      event.preventDefault();

      const password = newPassword.value;
      const confirmation = confirmPassword.value;

      if (password.length < 8) {
        newPasswordStatus.textContent =
          "Your password must contain at least 8 characters.";
        return;
      }

      if (password !== confirmation) {
        newPasswordStatus.textContent =
          "The passwords do not match.";
        return;
      }

      newPasswordStatus.textContent = "Updating your password...";

      try {
        const { error } = await supabase.auth.updateUser({
          password: password
        });

        if (error) throw error;

        newPasswordStatus.textContent =
          "Your password has been updated successfully. You can now log in with your new password.";

        newPasswordForm.reset();
      } catch (error) {
        console.error("Password update error:", error);
        newPasswordStatus.textContent =
          error.message ||
          "Could not update your password. Please open a fresh recovery link and try again.";
      }
    });
  }

  supabase.auth.onAuthStateChange(function (event, session) {
    if (event === "PASSWORD_RECOVERY") {
      // Defer auth calls until Supabase releases its auth callback lock.
      window.setTimeout(() => showRecoveryForAccount(session?.user), 0);
    }
  });

  // Handle recovery links even if the recovery event fired before this script subscribed.
  if (isRecoveryLink()) {
    window.setTimeout(async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          await showRecoveryForAccount(data.session.user);
        } else {
          showSection("new-password");
          if (recoveryAccount) recoveryAccount.hidden = true;
          if (newPasswordStatus) {
            newPasswordStatus.textContent = "This recovery link is invalid or expired. Request a new password reset email.";
          }
        }
      } catch {
        showSection("new-password");
        if (newPasswordStatus) newPasswordStatus.textContent = "Could not verify this recovery link. Request a new password reset email.";
      }
    }, 0);
  }
})();

