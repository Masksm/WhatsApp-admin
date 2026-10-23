
import { $, supabase, getErrorMessage } from "./core.js";
import { openConversation } from "./messages.js";

let initialized = false;
let loading = false;

function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function createEmptyMessage(message) {
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  return paragraph;
}

function createNotificationButton({
  title,
  message,
  date,
  unread = false,
  onClick
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "notification-item";

  if (unread) button.classList.add("unread");

  const heading = document.createElement("strong");
  heading.textContent = title;

  const body = document.createElement("span");
  body.textContent = message || "";

  button.append(heading, body);

  if (date) {
    const timestamp = document.createElement("small");
    timestamp.textContent = formatDate(date);
    button.appendChild(timestamp);
  }

  if (onClick) {
    button.addEventListener("click", onClick);
  } else {
    button.disabled = true;
  }

  return button;
}

function renderNotifications(notifications, inboxMessages) {
  const list = $("#notification-list");
  if (!list) return;

  list.replaceChildren();

  const items = [];

  for (const notification of notifications || []) {
    items.push({
      kind: "notification",
      date: notification.created_at,
      data: notification
    });
  }

  for (const message of inboxMessages || []) {
    items.push({
      kind: "anonymous",
      date: message.created_at,
      data: message
    });
  }

  items.sort((a, b) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();

    return dateB - dateA;
  });

  if (!items.length) {
    list.appendChild(
      createEmptyMessage("No notifications yet.")
    );
    return;
  }

  for (const item of items) {
    if (item.kind === "notification") {
      const notification = item.data;

      const button = createNotificationButton({
        title:
          notification.sender_anonymous_name ||
          "Amora notification",
        message:
          notification.message_preview ||
          notification.message ||
          "You have a new notification.",
        date: notification.created_at,
        unread: !notification.read_at,
        onClick: notification.conversation_id
          ? () => {
              openConversation(
                notification.conversation_id,
                notification.sender_anonymous_name ||
                  "Anonymous"
              );
            }
          : null
      });

      list.appendChild(button);
      continue;
    }

    const message = item.data;

    const button = createNotificationButton({
      title: "Anonymous message 💌",
      message: message.message_text || "You received a message.",
      date: message.created_at,
      unread: !message.is_read,
      onClick: null
    });

    list.appendChild(button);
  }
}

async function loadChatNotifications() {
  if (!supabase || loading) return;

  const list = $("#notification-list");
  if (!list) return;

  loading = true;

  try {
    const [notificationResult, inboxResult] = await Promise.all([
      supabase.rpc("get_my_notifications"),
      supabase.rpc("get_my_anonymous_inbox")
    ]);

    if (notificationResult.error) {
      throw notificationResult.error;
    }

    if (inboxResult.error) {
      throw inboxResult.error;
    }

    renderNotifications(
      notificationResult.data || [],
      inboxResult.data || []
    );
  } catch (error) {
    list.replaceChildren();

    list.appendChild(
      createEmptyMessage(
        getErrorMessage(
          error,
          "Could not load notifications."
        )
      )
    );
  } finally {
    loading = false;
  }
}

function initNotifications() {
  if (initialized) return;
  initialized = true;

  window.addEventListener(
    "amora:refresh-notifications",
    loadChatNotifications
  );

  if (!supabase) return;

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      setTimeout(loadChatNotifications, 0);
    } else {
      const list = $("#notification-list");

      if (list) {
        list.replaceChildren(
          createEmptyMessage(
            "Sign in to view notifications."
          )
        );
      }
    }
  });

  loadChatNotifications();
}

export {
  initNotifications,
  loadChatNotifications
};
