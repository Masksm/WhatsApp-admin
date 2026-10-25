import { initMessages, refreshInbox } from "./messages.js?v=read-receipts-1";
const $ = (selector) => document.querySelector(selector);
let filter = "inbox";
let conversations = [];

if (new URLSearchParams(window.location.search).get("popup") === "1") {
  document.documentElement.classList.add("amora-chat-popup-mode");
}

function applyConversationFilters() {
  const query = ($("#conversation-search")?.value || "").trim().toLowerCase();
  if (!$("#conversation-list")) return;

  // The messaging module owns rendering for both normal chats and the secure
  // anonymous-message RPC. Always delegate, including empty states.
  window.dispatchEvent(
    new CustomEvent("amora:filter-conversations", {
      detail: { filter, query }
    })
  );
}

document.querySelectorAll("[data-chat-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    filter = button.dataset.chatFilter;
    document.querySelectorAll("[data-chat-filter]").forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    applyConversationFilters();
  });
});
$("#conversation-search")?.addEventListener("input", applyConversationFilters);
window.addEventListener("amora:conversations-loaded", (event) => {
  conversations = Array.isArray(event.detail) ? event.detail : [];
  applyConversationFilters();
});
initMessages();
