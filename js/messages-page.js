import { initMessages, refreshInbox } from "./messages.js";
const $ = (selector) => document.querySelector(selector);
let filter = "inbox";
let conversations = [];

if (new URLSearchParams(window.location.search).get("popup") === "1") {
  document.documentElement.classList.add("amora-chat-popup-mode");
}

function applyConversationFilters() {
  const query = ($("#conversation-search")?.value || "").trim().toLowerCase();
  const list = $("#conversation-list");
  if (!list) return;
  const visible = conversations.filter((item) => {
    const name = item.other_anonymous_name || "Anonymous";
    const preview = item.last_message_preview || "";
    const matchesQuery = (name + " " + preview).toLowerCase().includes(query);
    const unread = Number(item.unread_count) > 0;
    return matchesQuery && (filter !== "unread" || unread);
  });
  list.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "conversation-empty";
    empty.textContent = filter === "unread" ? "You're all caught up. No unread chats." : query ? "No conversations match your search." : "No conversations yet.";
    list.appendChild(empty);
    return;
  }
  // The existing messaging module owns secure conversation loading and sending.
  // Keep the canonical rendered list from that module and use this view only for filtering.
  const event = new CustomEvent("amora:filter-conversations", { detail: { filter, query } });
  window.dispatchEvent(event);
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
