
import {
  $,
  params,
  supabase,
  setStatus,
  getErrorMessage
} from "./core.js";

import {
  getPendingClaimTokens,
  savePendingClaimTokens
} from "./auth.js";

let initialized = false;

function showPublicAnonymousPage() {
  const slug = params.get("anon");
  const panel = $("#anonymous-message-panel");

  if (!slug || !panel) return false;

  document.body.classList.add("anonymous-message-page");

  for (const child of document.body.children) {
    if (
      child === panel ||
      child.tagName === "SCRIPT"
    ) {
      continue;
    }

    child.hidden = true;
  }

  panel.hidden = false;
  return true;
}

function showSubmissionSuccess() {
  const status = $("#anonymous-message-status");

  if (!status) return;

  status.innerHTML = `
    <div class="anonymous-success">
      <h3>Message sent 💗</h3>
      <p>Your anonymous message has been delivered to Amora.</p>
    </div>
    <div class="anonymous-signup-prompt">
      <p>Create an account or log in to claim your message.</p>
      <p>
        <a class="primary-btn" href="/pages/home.html?auth=signup">
          Create account
        </a>
      </p>
      <p>
        <a class="primary-btn" href="/pages/home.html?auth=login">
          Log in
        </a>
      </p>
    </div>
  `;

  status.style.color = "";
}

async function handleAnonymousMessageSubmit(event) {
  event.preventDefault();

  const slug = params.get("anon");
  const form = $("#anonymous-message-form");
  const messageInput = $("#anonymous-message-text");
  const submitButton = $("#send-anonymous-message");
  const status = $("#anonymous-message-status");

  if (!slug || !form || !messageInput || !supabase) {
    setStatus(
      status,
      "This anonymous message link is unavailable. Please check the link.",
      true
    );
    return;
  }

  const message = messageInput.value.trim();

  if (!message) {
    setStatus(status, "Please enter a message.", true);
    return;
  }

  if (message.length > 2000) {
    setStatus(
      status,
      "Your message must be 2,000 characters or fewer.",
      true
    );
    return;
  }

  if (submitButton) submitButton.disabled = true;

  setStatus(status, "Sending your anonymous message...");

  try {
    const { data, error } = await supabase.rpc(
      "submit_anonymous_message",
      {
        p_slug: slug,
        p_message: message
      }
    );

    if (error) throw error;

    if (
      typeof data !== "string" ||
      !/^[a-f0-9]{64}$/.test(data)
    ) {
      throw new Error(
        "The message was submitted, but its claim token was invalid."
      );
    }

    const tokens = getPendingClaimTokens();
    tokens.push(data);
    savePendingClaimTokens(tokens);

    form.hidden = true;
    showSubmissionSuccess();
  } catch (error) {
    setStatus(
      status,
      getErrorMessage(
        error,
        "Your message could not be sent. Please try again."
      ),
      true
    );
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

function initAnonymousMessages() {
  if (initialized) return;
  initialized = true;

  const isPublicPage = showPublicAnonymousPage();

  if (!isPublicPage) return;

  $("#anonymous-message-form")?.addEventListener(
    "submit",
    handleAnonymousMessageSubmit
  );
}

export {
  initAnonymousMessages
};
