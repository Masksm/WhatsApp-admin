import { supabase } from "./core.js";

(() => {
  if (document.getElementById("amora-chat-launcher")) return;

  const launcher = document.createElement("button");
  launcher.id = "amora-chat-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open new messages");
  launcher.setAttribute("aria-expanded", "false");
  launcher.hidden = true;
  launcher.innerHTML = '<span class="amora-chat-head-icon" aria-hidden="true">♡</span><span class="amora-chat-head-count" aria-live="polite"></span>';

  const panel = document.createElement("section");
  panel.id = "amora-chat-popup";
  panel.hidden = true;
  panel.setAttribute("aria-label", "New message chat");
  panel.innerHTML = '<header class="amora-chat-popup-head"><div><strong id="amora-chat-popup-title">New message</strong><small>Private conversation</small></div><div class="amora-chat-popup-actions"><a href="/pages/messages.html" aria-label="Open all messages" title="Open all messages">↗</a><button type="button" data-chat-close aria-label="Close chat">×</button></div></header><iframe title="Amora conversation" loading="lazy"></iframe>';
  document.body.append(launcher, panel);

  const frame = panel.querySelector("iframe");
  const title = panel.querySelector("#amora-chat-popup-title");
  let unreadConversationIds = [];
  let previousUnreadCounts = new Map();
  let hasInitialUnreadSnapshot = false;
  let lastTarget = "";
  let isOpen = false;
  let pollTimer = null;

  const closePanel = () => {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    isOpen = false;
  };

  const openPanel = (ids, autoOpen = false) => {
    const target = ids.length === 1
      ? "/pages/messages.html?popup=1&conversation=" + encodeURIComponent(ids[0])
      : "/pages/messages.html?popup=1";
    const nextTitle = ids.length === 1 ? "New message" : "New messages";
    title.textContent = nextTitle;
    if (target !== lastTarget) {
      frame.src = target;
      lastTarget = target;
    }
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    isOpen = true;
  };

  launcher.addEventListener("click", () => {
    if (panel.hidden) openPanel(unreadConversationIds);
    else closePanel();
  });
  panel.querySelector("[data-chat-close]").addEventListener("click", closePanel);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });

  async function checkForNewMessages() {
    if (!supabase || document.visibilityState === "hidden") return;
    try {
      const { data, error } = await supabase.rpc("get_my_conversations");
      if (error) throw error;
      const unread = (data || []).filter(item => Number(item.unread_count) > 0);
      const ids = unread.map(item => item.conversation_id);
      const nextCounts = new Map(unread.map(item => [item.conversation_id, Number(item.unread_count || 0)]));
      const hasNew = hasInitialUnreadSnapshot && unread.some(item => Number(item.unread_count || 0) > (previousUnreadCounts.get(item.conversation_id) || 0));
      previousUnreadCounts = nextCounts;
      hasInitialUnreadSnapshot = true;
      unreadConversationIds = ids;

      launcher.hidden = ids.length === 0;
      const count = launcher.querySelector(".amora-chat-head-count");
      if (count) {
        const total = unread.reduce((sum, item) => sum + Number(item.unread_count || 0), 0);
        count.textContent = total > 9 ? "9+" : String(total);
        count.hidden = total === 0;
      }

      if (!ids.length) {
        // Reading a message removes the unread badge, not the chat the user is currently viewing.
        return;
      }

      if (hasNew) {
        openPanel(ids, true);
      } else if (isOpen && ids.length > 1 && ids.length !== 1) {
        // If a second sender arrives while the chat is open, switch to the inbox overview.
        openPanel(ids);
      }
    } catch (error) {
      console.warn("Amora new-message bubble check failed:", error?.message || error);
    }
  }

  checkForNewMessages();
  pollTimer = window.setInterval(checkForNewMessages, 12000);
  window.addEventListener("pagehide", () => {
    if (pollTimer) window.clearInterval(pollTimer);
  }, { once: true });
})();