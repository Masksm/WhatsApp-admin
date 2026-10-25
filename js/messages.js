import { $, supabase, getErrorMessage } from "./core.js";

let activeConversationId = null;
let chatRequestInProgress = false;
let initialized = false;
let currentConversations = [];
let conversationFilter = "inbox";
let conversationSearch = "";
let inboxRefreshTimer = null;
let activeMessageRefreshTimer = null;
let lastMessageIds = new Set();
let anonymousInboxRequest = null;

function setChatStatus(message) {
  const status = $("#chat-status");
  if (status) status.textContent = message || "";
}

function formatChatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function notifyRefresh() {
  window.dispatchEvent(
    new CustomEvent("amora:refresh-notifications")
  );
}

function renderConversationList(conversations) {
  const list = $("#conversation-list");
  if (!list) return;
  if (conversationFilter === "anonymous") { loadAnonymousMessages(); return; }
  const query = conversationSearch.trim().toLowerCase();
  const visibleConversations = (conversations || []).filter((conversation) => {
    const name = conversation.other_anonymous_name || "Anonymous";
    const preview = conversation.last_message_preview || "";
    const unread = Number(conversation.unread_count) > 0;
    return (name + " " + preview).toLowerCase().includes(query) && (conversationFilter !== "unread" || unread);
  });
  list.replaceChildren();

  if (!visibleConversations.length) {
    const empty = document.createElement("p");
    empty.textContent = conversationFilter === "unread" ? "No unread chats." : query ? "No conversations match your search." : "No conversations yet.";
    list.appendChild(empty);
    return;
  }

  visibleConversations.forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";

    if (
      conversation.conversation_id === activeConversationId
    ) {
      button.classList.add("active");
    }

    const name = conversation.other_anonymous_name || "Anonymous";
    const unreadTotal = Number(conversation.unread_count) || 0;
    if (unreadTotal > 0) button.classList.add("has-unread");

    const avatar = document.createElement("span");
    avatar.className = "conversation-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = name.trim().charAt(0).toUpperCase() || "A";

    const copy = document.createElement("span");
    copy.className = "conversation-copy";
    const title = document.createElement("strong");
    title.textContent = name;
    const preview = document.createElement("span");
    preview.className = "conversation-preview";
    preview.textContent = conversation.last_message_preview || "No messages yet.";
    copy.append(title, preview);

    const meta = document.createElement("span");
    meta.className = "conversation-meta";
    if (unreadTotal > 0) {
      const unread = document.createElement("span");
      unread.className = "unread-count";
      unread.textContent = unreadTotal > 99 ? "99+" : String(unreadTotal);
      unread.setAttribute("aria-label", unreadTotal + " unread messages");
      meta.appendChild(unread);
    }
    button.append(avatar, copy, meta);

    button.addEventListener("click", () => {
      openConversation(
        conversation.conversation_id,
        conversation.other_anonymous_name || "Anonymous"
      );
    });

    list.appendChild(button);
  });
}

async function loadAnonymousMessages() {
  const list = $("#conversation-list");
  if (!list || !supabase) return;
  if (anonymousInboxRequest) return anonymousInboxRequest;
  anonymousInboxRequest = (async () => {
    list.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "conversation-empty";
    loading.textContent = "Loading anonymous messages…";
    list.appendChild(loading);
    const { data, error } = await supabase.rpc("get_my_anonymous_inbox");
    if (conversationFilter !== "anonymous") return;
    list.replaceChildren();
    if (error) {
      const failed = document.createElement("p");
      failed.className = "conversation-empty";
      failed.textContent = "Anonymous messages could not be loaded. Please refresh and try again.";
      list.appendChild(failed);
      setChatStatus(getErrorMessage(error, "Could not load anonymous messages."));
      console.error("Amora anonymous inbox failed:", error);
      return;
    }
    const messages = data || [];
    const count = document.getElementById("anonymous-message-count");
    if (count) {
      const unread = messages.filter(item => !item.is_read).length;
      count.hidden = unread === 0;
      count.textContent = unread > 99 ? "99+" : String(unread);
      count.setAttribute("aria-label", unread + " unread anonymous messages");
    }
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "conversation-empty";
      empty.textContent = "No anonymous link messages yet. Messages sent through your personal anonymous link will appear here.";
      list.appendChild(empty);
      return;
    }
    messages.forEach(item => {
      const card = document.createElement("article");
      card.className = "anonymous-inbox-item" + (item.is_read ? "" : " is-unread");
      const top = document.createElement("div");
      top.className = "anonymous-inbox-item-top";
      const title = document.createElement("strong");
      title.textContent = "Anonymous message";
      const state = document.createElement("span");
      state.className = "anonymous-inbox-state";
      state.textContent = item.is_read ? "Received" : "New";
      top.append(title, state);
      const body = document.createElement("p");
      body.className = "anonymous-inbox-text";
      body.textContent = item.message_text || "Message content unavailable.";
      const date = document.createElement("small");
      date.textContent = formatChatDate(item.created_at);
      card.append(top, body, date);
      list.appendChild(card);
    });
  })();
  try { await anonymousInboxRequest; } finally { anonymousInboxRequest = null; }
}

async function loadChatConversations(showLoading = true) {
  const list = $("#conversation-list");

  if (!supabase || !list) return;

  if (showLoading) {
    list.textContent = "Loading conversations...";
  }

  const { data, error } = await supabase.rpc(
    "get_my_conversations"
  );

  if (error) {
    list.textContent = "Could not load conversations.";
    setChatStatus(
      getErrorMessage(error, "Could not load conversations.")
    );
    return;
  }

  currentConversations = data || [];
  renderConversationList(currentConversations);
  window.dispatchEvent(new CustomEvent("amora:conversations-loaded", { detail: currentConversations }));
}

function renderMessages(messages) {
  const list = $("#message-list");
  if (!list) return;

  list.replaceChildren();

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.textContent = "No messages in this conversation yet.";
    list.appendChild(empty);
    return;
  }

  messages.forEach((message) => {
    const item = document.createElement("div");

    item.className = message.sent_by_me
      ? "chat-message sent"
      : "chat-message received";

    const content = document.createElement("p");
    content.textContent = message.message_text || "";

    const meta = document.createElement("small");
    const sender =
      message.sent_by_me
        ? "You"
        : message.sender_anonymous_name || "Anonymous";

    const date = formatChatDate(message.sent_at);
    meta.textContent = date ? sender + " · " + date : sender;
    if (message.sent_by_me) {
      const receipt = document.createElement("span");
      receipt.className = "chat-read-receipt" + (message.read_at ? " is-read" : "");
      receipt.textContent = message.read_at ? "✓✓" : "✓";
      receipt.setAttribute("aria-label", message.read_at ? "Read by recipient" : "Sent");
      receipt.title = message.read_at ? "Read" : "Sent";
      meta.append(" ", receipt);
    }

    item.append(content, meta);
    list.appendChild(item);
  });

  list.scrollTop = list.scrollHeight;
}

function stopLiveMessageUpdates() {
  if (activeMessageRefreshTimer) clearInterval(activeMessageRefreshTimer);
  activeMessageRefreshTimer = null;
}
function startLiveMessageUpdates(conversationId) {
  stopLiveMessageUpdates();
  if (!supabase || !conversationId) return;
  // Use the secured RPC because direct SELECT on chat_messages is intentionally restricted.
  activeMessageRefreshTimer = setInterval(async () => {
    if (document.hidden || activeConversationId !== conversationId || chatRequestInProgress) return;
    const result = await supabase.rpc("get_conversation_messages_with_receipts", { p_conversation_id: conversationId });
    if (result.error || activeConversationId !== conversationId) return;
    const incoming = result.data || [];
    const ids = new Set(incoming.map(m => m.message_id || m.id).filter(Boolean));
    const hasNewMessage = [...ids].some(id => !lastMessageIds.has(id));
    const list = $("#message-list");
    const wasNearBottom = list ? list.scrollHeight - list.scrollTop - list.clientHeight < 100 : true;
    renderMessages(incoming);
    if (list && !wasNearBottom && !hasNewMessage) list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight - 40);
    lastMessageIds = ids;
    await loadChatConversations(false);
    if (incoming.some(m => !m.sent_by_me && !m.read_at)) await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
  }, 5000);
}

async function loadChatMessages(conversationId) {
  if (!supabase || !conversationId) return;

  activeConversationId = conversationId;
  chatRequestInProgress = true;

  const messageList = $("#message-list");
  const messageInput = $("#chat-message-text");
  const sendButton = $("#send-chat-message");

  if (messageList) {
    messageList.textContent = "Loading messages...";
  }

  if (messageInput) messageInput.disabled = true;
  if (sendButton) sendButton.disabled = true;

  try {
    const { data, error } = await supabase.rpc(
      "get_conversation_messages_with_receipts",
      { p_conversation_id: conversationId }
    );

    if (error) throw error;

    if (activeConversationId !== conversationId) return;

    const messages = data || [];
    lastMessageIds = new Set(messages.map(m => m.message_id || m.id).filter(Boolean));
    renderMessages(messages);
    setChatStatus("Messages update automatically.");
    startLiveMessageUpdates(conversationId);

    await supabase.rpc("mark_conversation_read", {
      p_conversation_id: conversationId
    });

    notifyRefresh();
    await loadChatConversations(false);
  } catch (error) {
    if (activeConversationId === conversationId) {
      if (messageList) {
        messageList.textContent = "Could not load messages.";
      }

      setChatStatus(
        getErrorMessage(error, "Could not load messages.")
      );
    }
  } finally {
    if (activeConversationId === conversationId) {
      chatRequestInProgress = false;

      if (messageInput) messageInput.disabled = false;
      if (sendButton) sendButton.disabled = false;
    }
  }
}

function openConversation(conversationId, title = "Anonymous") {
  const heading = $("#active-conversation-heading");
  const workspace = document.querySelector(".messages-workspace");
  const headerAvatar = document.querySelector(".chat-header-avatar");
  if (heading) heading.textContent = title;
  if (headerAvatar) {
    headerAvatar.textContent = String(title || "A").trim().charAt(0).toUpperCase() || "A";
    headerAvatar.classList.add("has-person");
  }
  workspace?.classList.add("chat-open");
  loadChatMessages(conversationId);
}

async function handleSendMessage(event) {
  event.preventDefault();

  const input = $("#chat-message-text");
  const button = $("#send-chat-message");
  const message = input?.value.trim() || "";

  if (!supabase || !activeConversationId) {
    setChatStatus("Choose a conversation first.");
    return;
  }

  if (!message) {
    setChatStatus("Enter a message before sending.");
    return;
  }

  if (message.length > 2000) {
    setChatStatus("Messages must be 2,000 characters or fewer.");
    return;
  }

  if (chatRequestInProgress) return;

  chatRequestInProgress = true;
  if (button) button.disabled = true;

  setChatStatus("Checking and sending your message...");

  try {
    const conversationId = activeConversationId;

    const { data, error } = await supabase.rpc(
      "send_chat_message",
      {
        p_conversation_id: conversationId,
        p_message: message
      }
    );

    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;

    if (result?.status === "blocked") {
      setChatStatus(
        result.message ||
          "This message cannot be sent because it violates messaging rules."
      );
      return;
    }

    if (result?.status !== "approved") {
      setChatStatus(
        "The message was not approved. Please review it and try again."
      );
      return;
    }

    if (input) input.value = "";

    setChatStatus("Message sent.");

    await loadChatMessages(conversationId);
  } catch (error) {
    setChatStatus(
      getErrorMessage(error, "Could not send your message.")
    );
  } finally {
    chatRequestInProgress = false;

    if (button) {
      button.disabled = !activeConversationId;
    }
  }
}

function clearChat() {
  activeConversationId = null;
  stopLiveMessageUpdates();
  lastMessageIds = new Set();
  document.querySelector(".messages-workspace")?.classList.remove("chat-open");
  chatRequestInProgress = false;

  const conversations = $("#conversation-list");
  const notifications = $("#notification-list");
  const messages = $("#message-list");
  const heading = $("#active-conversation-heading");
  const input = $("#chat-message-text");
  const button = $("#send-chat-message");

  if (conversations) {
    conversations.textContent = "Sign in to view your conversations.";
  }

  if (notifications) {
    notifications.textContent = "Sign in to view notifications.";
  }

  if (messages) {
    messages.textContent = "Select a conversation to read messages.";
  }

  if (heading) heading.textContent = "Choose a conversation";
  if (input) input.disabled = true;
  if (button) button.disabled = true;

  setChatStatus("");
}

async function refreshInbox() {
  if (!supabase) return;

  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session?.user) {
    clearChat();
    return;
  }

  await loadChatConversations();
  notifyRefresh();
}

function initMessages() {
  if (initialized) return;
  initialized = true;

  window.addEventListener("amora:filter-conversations", (event) => {
    conversationFilter = event.detail?.filter || "inbox";
    conversationSearch = event.detail?.query || "";
    renderConversationList(currentConversations);
  });

  $("#chat-message-form")?.addEventListener(
    "submit",
    handleSendMessage
  );
  $("#mobile-inbox-back")?.addEventListener("click", () => {
    document.querySelector(".messages-workspace")?.classList.remove("chat-open");
  });

  $("#refresh-conversations")?.addEventListener(
    "click",
    refreshInbox
  );

  if (!supabase) {
    setChatStatus("Messaging is currently unavailable.");
    return;
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      setTimeout(() => {
        refreshInbox();
      }, 0);
    } else {
      clearChat();
    }
  });

  refreshInbox();
  if (inboxRefreshTimer) clearInterval(inboxRefreshTimer);
  inboxRefreshTimer = setInterval(() => { if (!document.hidden) loadChatConversations(false); }, 15000);

  const requestedConversation = new URLSearchParams(window.location.search).get("conversation");
  if (requestedConversation) {
    window.addEventListener("amora:conversations-loaded", (event) => {
      const match = (event.detail || []).find((item) => item.conversation_id === requestedConversation);
      if (match) openConversation(match.conversation_id, match.other_anonymous_name || "Anonymous");
    }, { once: true });
  }
}

export {
  initMessages,
  loadChatConversations,
  loadChatMessages,
  openConversation,
  refreshInbox
};
