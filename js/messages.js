import { $, supabase, getErrorMessage } from "./core.js";

let activeConversationId = null;
let chatRequestInProgress = false;
let initialized = false;

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

  list.replaceChildren();

  if (!conversations.length) {
    const empty = document.createElement("p");
    empty.textContent = "No conversations yet.";
    list.appendChild(empty);
    return;
  }

  conversations.forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";

    if (
      conversation.conversation_id === activeConversationId
    ) {
      button.classList.add("active");
    }

    const title = document.createElement("strong");
    title.textContent =
      conversation.other_anonymous_name || "Anonymous";

    const preview = document.createElement("span");
    preview.textContent =
      conversation.last_message_preview || "No messages yet.";

    button.append(title, preview);

    if (Number(conversation.unread_count) > 0) {
      const unread = document.createElement("span");
      unread.className = "unread-count";
      unread.textContent = String(conversation.unread_count);
      button.appendChild(unread);
    }

    button.addEventListener("click", () => {
      openConversation(
        conversation.conversation_id,
        conversation.other_anonymous_name || "Anonymous"
      );
    });

    list.appendChild(button);
  });
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

  renderConversationList(data || []);
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

    meta.textContent = date ? `${sender} · ${date}` : sender;

    item.append(content, meta);
    list.appendChild(item);
  });

  list.scrollTop = list.scrollHeight;
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
      "get_conversation_messages",
      { p_conversation_id: conversationId }
    );

    if (error) throw error;

    if (activeConversationId !== conversationId) return;

    renderMessages(data || []);
    setChatStatus("");

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

  if (heading) heading.textContent = title;

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

  $("#chat-message-form")?.addEventListener(
    "submit",
    handleSendMessage
  );

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
}

export {
  initMessages,
  loadChatConversations,
  loadChatMessages,
  openConversation,
  refreshInbox
};
