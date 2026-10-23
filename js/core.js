
/**
 * Amora Core
 * Shared configuration and helper functions.
 *
 * This module does not make database changes.
 */

const $ = (selector) => document.querySelector(selector);
const byId = (id) => document.getElementById(id);

const base = window.AMORA || {};
const params = new URLSearchParams(window.location.search);

const config = {
  ...base,
  to: params.get("to") || base.to || "someone special",
  from: params.get("from") || base.from || "someone who cares",
  theirNumber: params.get("num") || base.theirNumber || "",
  message: params.get("msg") || base.message || "You make the world brighter. 💗",
  photo: params.get("img") || base.photo || ""
};

const supabase = window.amoraSupabase;

const stages = [
  "#form-panel",
  "#queue-stage",
  "#verify-stage",
  "#reveal-stage"
];

function safeText(value) {
  return String(value == null ? "" : value);
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2100);
}

function showStage(id) {
  stages.forEach((selector) => {
    const element = $(selector);
    if (element) element.hidden = selector !== id;
  });

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function setStatus(element, message, isError = false) {
  if (!element) return;

  element.textContent = message;
  element.style.color = isError ? "#dc2626" : "#15803d";
}

function getErrorMessage(error, fallback) {
  const message = error?.message || "";

  if (/invalid or expired|already used|claim token/i.test(message)) {
    return "This message's claim link is invalid, expired, or has already been used.";
  }

  if (/cannot claim a message sent to your own account/i.test(message)) {
    return "This message was sent to your own account. Log in with the account that sent it to claim it.";
  }

  if (/contact information|messaging rules/i.test(message)) {
    return "Please remove contact details or off-platform contact requests and try again.";
  }

  return message || fallback;
}

export {
  $,
  byId,
  base,
  params,
  config,
  supabase,
  stages,
  safeText,
  showToast,
  showStage,
  setStatus,
  getErrorMessage
};

