
import {
  $,
  params,
  supabase,
  setStatus,
  getErrorMessage
} from "./core.js";

const CLAIM_STORAGE_KEY = "amora_pending_claim_tokens";

function setMessageStatus(message, isError = false) {
  setStatus($("#anonymous-message-status"), message, isError);
}

function saveClaimToken(token) {
  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/i.test(token)
  ) {
    throw new Error("The server returned an invalid claim token.");
  }

  let tokens = [];

  try {
    const stored = sessionStorage.getItem(CLAIM_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    tokens = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    tokens = [];
  }

  tokens = tokens.filter(
    (value) =>
      typeof value === "string" &&
      /^[a-f0-9]{64}$/i.test(value)
  );

  if (!tokens.includes(token)) {
    tokens.push(token);
  }

  sessionStorage.setItem(
    CLAIM_STORAGE_KEY,
    JSON.stringify(tokens)
  );
}

function showMessageSuccess() {
  const panel = $("#anonymous-message-panel");
  if (!panel) return;

  panel.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = "Your message has been sent 💗";

  const explanation = document.createElement("p");
  explanation.textContent =
    "Your message was submitted anonymously. Create an account or log in to claim it and continue the conversation.";

  const signup = document.createElement("a");
  signup.href = "?auth=signup";
  signup.textContent = "Create an account";
  signup.className = "button";

  const login = document.createElement("a");
  login.href = "?auth=login";
  login.textContent = "Log in";
  login.className = "button";

  panel.append(heading, explanation, signup, login);
  panel.hidden = false;
}

function initAnonymousMessages() {
  const panel = $("#anonymous-message-panel");
  const form = $("#anonymous-message-form");
  const messageField = $("#anonymous-message-text");
  const sendButton = $("#send-anonymous-message");

  const slug = params.get("anon");

  if (!slug) return;

  // Show the public message form and keep the dashboard hidden.
  if (panel) panel.hidden = false;

  const authPanel = $("#auth-panel");
  const dashboardPanel = $("#dashboard-panel");

  if (authPanel) authPanel.hidden = true;
  if (dashboardPanel) dashboardPanel.hidden = true;

  if (!form) {
    console.error("Anonymous message form was not found.");
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = messageField?.value.trim() || "";

    if (!message) {
      setMessageStatus("Write a message before sending it.", true);
      messageField?.focus();
      return;
    }

    if (!supabase) {
      setMessageStatus(
        "Unable to connect. Please try again later.",
        true
      );
      return;
    }

    if (sendButton) {
      sendButton.disabled = true;
      sendButton.textContent = "Sending…";
    }

    setMessageStatus("");

    try {
      const { data, error } = await supabase.rpc(
        "submit_anonymous_message",
        {
          p_slug: slug,
          p_message: message
        }
      );

      if (error) throw error;

      // Accept only the expected token format.
      const token = Array.isArray(data) ? data[0] : data;

      if (typeof token !== "string") {
        throw new Error("The server returned an unexpected response.");
      }

      saveClaimToken(token);
      showMessageSuccess();
    } catch (error) {
      setMessageStatus(
        getErrorMessage(
          error,
          "Your message could not be sent. Please try again."
        ),
        true
      );
    } finally {
      if (sendButton) {
        sendButton.disabled = false;
        sendButton.textContent = "Send anonymously";
      }
    }
  });
}

export {
  initAnonymousMessages,
  saveClaimToken
};
