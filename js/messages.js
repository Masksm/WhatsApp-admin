
import {
  $,
  supabase,
  getErrorMessage
} from "./core.js";

// ============================================================
// AMORA PRIVATE MESSAGING
// ============================================================

let activeChatConversationId = null;
let chatRequestInProgress = false;

function setChatStatus(message, isError = false) {
  const element = $("#chat-status");
  if (!element) return;

  element.textContent = message;
  element.style.color = isError ? "#dc2626" : "";
}

function addChatText(parent, text, className) {
  const element = document.createElement("div");
  element.textContent = String(text ?? "");

  if (className) {
    element.className = className;
  }

  parent.append(element);
  return element;
}

function formatChatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function clearChatElement(element) {
  if (element) element.replaceChildren();
}

function renderChatMessages(messages) {
  const list = $("#message-list");
  if (!list) return;

  clearChatElement(list);

  if (!messages?.length) {
    addChatText(list, "No messages yet.", "empty-state");
    return;
  }

  messages.forEach((message) => {
    const row = document.createElement("article");
    row.className = "chat-message";

    const body = document.createElement("p");
    body.textContent = String(message.message ?? message.content ?? "");

    const timestamp = document.createElement("small");
    timestamp.textContent = formatChatDate(
      message.created_at || message.sent_at
    );

    row.append(body, timestamp);
    list.append(row);
  });

  list.scrollTop = list.scrollHeight;
}

function renderConversations(conversations) {
  const list = $("#conversation-list");
  if (!list) return;

  clearChatElement(list);

  if (!conversations?.length) {
    addChatText(list, "Your conversations will appear here.", "empty-state");
    return;
  }

  conversations.forEach((conversation) => {
    const id =
      conversation.conversation_id ||
      conversation.id;

    if (!id) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";

    if (id === activeChatConversationId) {
      button.classList.add("active");
    }

    const name = document.createElement("strong");
    name.textContent =
      conversation.display_name ||
      conversation.name ||
      conversation.other_user_name ||
      "Amora conversation";

    const preview = document.createElement("span");
    preview.textContent =
      conversation.last_message ||
      conversation.last_message_text ||
      "Open conversation";

    const timestamp = document.createElement("small");
    timestamp.textContent = formatChatDate(
      conversation.last_message_at ||
      conversation.updated_at ||
      conversation.created_at
    );

    button.append(name, preview, timestamp);

    button.addEventListener("click", () => {
      openConversation(id, name.textContent);
    });

    list.append(button);
  });
}

async function loadChatMessages(conversationId) {
  if (!supabase || !conversationId) return;

  const { data, error } = await supabase.rpc(
    "get_conversation_messages",
    {
      p_conversation_id: conversationId
    }
  );

  if (error) {
    setChatStatus(
      getErrorMessage(error, "Unable to load messages."),
      true
    );
    return;
  }

  renderChatMessages(data || []);

  // Mark this conversation as read.
  const { error: readError } = await supabase.rpc(
    "mark_conversation_read",
    {
      p_conversation_id: conversationId
    }
  );

  if (readError) {
    console.warn("Unable to mark conversation as read:", readError.message);
  }
}

async function openConversation(conversationId, title = "") {
  if (!supabase || chatRequestInProgress) return;

  chatRequestInProgress = true;
  activeChatConversationId = conversationId;

  const heading = $("#active-conversation-heading");
  if (heading) {
    heading.textContent = title || "Conversation";
  }

  setChatStatus("Loading conversation…");

  try {
    await loadChatMessages(conversationId);
    setChatStatus("");
    await loadChatConversations();
  } catch (error) {
    setChatStatus(
      getErrorMessage(error, "Unable to open this conversation."),
      true
    );
  } finally {
    chatRequestInProgress = false;
  }
}

async function loadChatConversations() {
  if (!supabase) return;

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    setChatStatus("Unable to check your session.", true);
    return;
  }

  if (!sessionData.session?.user) {
    clearChatElement($("#conversation-list"));
    clearChatElement($("#message-list"));
    return;
  }

  const { data, error } = await supabase.rpc("get_my_conversations");

  if (error) {
    setChatStatus(
      getErrorMessage(error, "Unable to load conversations."),
      true
    );
    return;
  }

  renderConversations(data || []);

  if (
    activeChatConversationId &&
    !(data || []).some(
      (conversation) =>
        (conversation.conversation_id || conversation.id) ===
        activeChatConversationId
    )
  ) {
    activeChatConversationId = null;
    clearChatElement($("#message-list"));
  }
}

async function sendChatMessage(event) {
  event.preventDefault();

  const field = $("#chat-message-text");
  const button = $("#send-chat-message");
  const message = field?.value.trim() || "";

  if (!message) {
    setChatStatus("Write a message before sending it.", true);
    return;
  }

  if (!activeChatConversationId) {
    setChatStatus("Choose a conversation first.", true);
    return;
  }

  if (!supabase) {
    setChatStatus("Unable to connect. Please try again.", true);
    return;
  }

  if (chatRequestInProgress) return;

  chatRequestInProgress = true;
  if (button) button.disabled = true;

  setChatStatus("Sending…");

  try {
    const { data, error } = await supabase.rpc(
      "send_chat_message",
      {
        p_conversation_id: activeChatConversationId,
        p_message: message
      }
    );

    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    const status =
      typeof result === "string"
        ? result
        : result?.status;

    if (status !== "approved") {
      setChatStatus(
        status === "blocked"
          ? "Please remove contact details or off-platform contact requests."
          : "Your message could not be sent.",
        true
      );
      return;
    }

    if (field) field.value = "";

    setChatStatus("Message sent.");
    await loadChatMessages(activeChatConversationId);
    await loadChatConversations();
  } catch (error) {
    setChatStatus(
      getErrorMessage(error, "Unable to send your message."),
      true
    );
  } finally {
    chatRequestInProgress = false;
    if (button) button.disabled = false;
  }
}

async function refreshConversations() {
  await loadChatConversations();

  if (activeChatConversationId) {
    await loadChatMessages(activeChatConversationId);
  }
}

function initMessages() {
  $("#chat-message-form")?.addEventListener(
    "submit",
    sendChatMessage
  );

  $("#refresh-conversations")?.addEventListener(
    "click",
    refreshConversations
  );

  supabase?.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      refreshConversations();
    } else if (event === "SIGNED_OUT") {
      activeChatConversationId = null;
      clearChatElement($("#conversation-list"));
      clearChatElement($("#message-list"));
      setChatStatus("");
    }
  });
}

export {
  initMessages,
  loadChatMessages,
  loadChatConversations,
  openConversation,
  refreshConversations
};
