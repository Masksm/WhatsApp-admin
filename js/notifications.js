
import {
  $,
  supabase,
  getErrorMessage
} from "./core.js";

// ============================================================
// AMORA NOTIFICATIONS AND ANONYMOUS INBOX
// ============================================================

function clearElement(element) {
  if (element) element.replaceChildren();
}

function createTextElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = String(text ?? "");

  if (className) {
    element.className = className;
  }

  return element;
}

function formatNotificationDate(value) {
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

function renderNotifications(notifications, anonymousMessages = []) {
  const list = $("#notification-list");
  if (!list) return;

  clearElement(list);

  const entries = [
    ...(notifications || []).map((item) => ({
      type: "notification",
      item
    })),
    ...(anonymousMessages || []).map((item) => ({
      type: "anonymous",
      item
    }))
  ];

  if (!entries.length) {
    list.append(
      createTextElement(
        "p",
        "You're all caught up.",
        "empty-state"
      )
    );
    return;
  }

  entries.forEach(({ type, item }) => {
    const card = document.createElement("article");
    card.className = "notification-item";

    const heading = createTextElement(
      "strong",
      type === "anonymous"
        ? "New anonymous message"
        : item.title || item.type || "Amora notification"
    );

    const message = createTextElement(
      "p",
      item.message ||
        item.body ||
        item.content ||
        item.message_preview ||
        "You have a new update."
    );

    const timestamp = createTextElement(
      "small",
      formatNotificationDate(
        item.created_at || item.createdAt
      )
    );

    card.append(heading, message, timestamp);
    list.append(card);
  });
}

async function loadChatNotifications() {
  if (!supabase) return;

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    console.error("Unable to check notification session:", sessionError.message);
    return;
  }

  if (!sessionData.session?.user) {
    clearElement($("#notification-list"));
    return;
  }

  const [
    { data: notifications, error: notificationError },
    { data: anonymousMessages, error: anonymousError }
  ] = await Promise.all([
    supabase.rpc("get_my_notifications"),
    supabase.rpc("get_my_anonymous_inbox")
  ]);

  if (notificationError) {
    console.error(
      "Unable to load notifications:",
      notificationError.message
    );
  }

  if (anonymousError) {
    console.error(
      "Unable to load anonymous inbox:",
      anonymousError.message
    );
  }

  if (notificationError && anonymousError) {
    const status = $("#chat-status");

    if (status) {
      status.textContent = getErrorMessage(
        notificationError,
        "Unable to load notifications."
      );
    }

    return;
  }

  renderNotifications(
    notifications || [],
    anonymousMessages || []
  );
}

function initNotifications() {
  supabase?.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      loadChatNotifications();
    } else if (event === "SIGNED_OUT") {
      clearElement($("#notification-list"));
    }
  });

  loadChatNotifications();
}

export {
  initNotifications,
  loadChatNotifications,
  renderNotifications
};
