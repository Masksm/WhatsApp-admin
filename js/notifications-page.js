const $ = (selector) => document.querySelector(selector);
const supabase = window.amoraSupabase;
let allNotifications = [];
let activeFilter = "all";
let searchQuery = "";

function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  if (seconds < 604800) return Math.floor(seconds / 86400) + "d ago";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function setStatus(message, isError = false) {
  const status = $("#notifications-status");
  if (!status) return;
  status.textContent = message;
  status.style.color = isError ? "#c62828" : "";
}

function actorLabel(item) {
  if (item.notification_type === "new_message") return item.sender_anonymous_name || "Someone";
  return item.actor_name || (item.actor_username ? "@" + item.actor_username : "Someone");
}

function notificationText(item) {
  const name = actorLabel(item);
  switch (item.notification_type) {
    case "new_message": return name + " sent you a message";
    case "post_like": return name + " liked your post";
    case "post_comment": return name + " commented on your post";
    case "comment_reply": return name + " replied to your comment";
    case "new_follower": return name + " started following you";
    case "comment_like": return name + " liked your comment";
    case "mention": return name + " mentioned you";
    default: return "You have new activity";
  }
}

function notificationSymbol(type) {
  if (type === "new_message") return "✉";
  if (type === "new_follower") return "+";
  if (type === "post_comment" || type === "comment_reply") return "▤";
  if (type === "mention") return "@";
  if (type === "comment_like") return "♥";
  return "♡";
}
function matchesFilter(item) {
  if (activeFilter === "unread") return !item.read_at;
  if (activeFilter === "likes") return ["post_like", "comment_like"].includes(item.notification_type);
  if (activeFilter === "comments") return ["post_comment", "comment_reply"].includes(item.notification_type);
  if (activeFilter === "follows") return item.notification_type === "new_follower";
  return true;
}
function groupLabel(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.floor((today.getTime() - day.getTime()) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : "Earlier";
}

function updateUnreadCount() {
  const count = allNotifications.filter(item => !item.read_at).length;
  for (const selector of ["#notifications-nav-count", "#notifications-mobile-count"]) {
    const badge = $(selector);
    if (!badge) continue;
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.setAttribute("aria-label", count + " unread notifications");
  }
}

function render() {
  const list = $("#notifications-list");
  if (!list) return;
  const query = searchQuery.trim().toLowerCase();
  const items = allNotifications.filter(item => {
    if (!matchesFilter(item)) return false;
    if (!query) return true;
    return [notificationText(item), item.message_preview, item.actor_name, item.actor_username, item.notification_type].filter(Boolean).join(" ").toLowerCase().includes(query);
  }).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  list.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "notifications-empty";
    empty.textContent = searchQuery.trim() ? "No notifications match your search." : activeFilter === "unread" ? "You're all caught up. No unread notifications." : activeFilter === "likes" ? "No like notifications here yet." : activeFilter === "comments" ? "No comment notifications here yet." : activeFilter === "follows" ? "No new follower notifications here yet." : "No notifications yet. New activity will appear here.";
    list.appendChild(empty);
    return;
  }

  let previousGroup = "";
  for (const item of items) {
    const group = groupLabel(item.created_at);
    if (group !== previousGroup) {
      const heading = document.createElement("h2");
      heading.className = "notification-date-heading";
      heading.textContent = group;
      list.appendChild(heading);
      previousGroup = group;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "amora-notification" + (item.read_at ? "" : " unread");

    const symbol = document.createElement("span");
    symbol.className = "notification-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = notificationSymbol(item.notification_type);

    const actor = actorLabel(item);
    const avatar = document.createElement("span");
    avatar.className = "notification-actor-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = (actor.trim().replace(/^@/, "").charAt(0) || "A").toUpperCase();
    const copy = document.createElement("span");
    copy.className = "notification-copy";
    const title = document.createElement("strong");
    title.textContent = notificationText(item);
    const message = document.createElement("span");
    message.textContent = item.message_preview || "";
    message.hidden = !item.message_preview;
    const timestamp = document.createElement("small");
    timestamp.textContent = dateLabel(item.created_at);
    copy.append(title, message, timestamp);
    button.append(avatar, symbol, copy);

    if (!item.read_at) {
      const dot = document.createElement("span");
      dot.className = "notification-unread-dot";
      dot.setAttribute("aria-label", "Unread");
      button.appendChild(dot);
    }

    button.addEventListener("click", async () => {
      if (!supabase) return;
      if (!item.read_at) {
        const { error } = await supabase.rpc("mark_my_notification_read", { p_notification_id: item.notification_id });
        if (error) {
          setStatus("Could not mark this notification as read. Please try again.", true);
          return;
        }
        item.read_at = new Date().toISOString();
        updateUnreadCount();
        render();
      }
      if (item.conversation_id) {
        window.location.href = "/pages/messages.html?conversation=" + encodeURIComponent(item.conversation_id);
      } else if (item.actor_username && item.notification_type === "new_follower") {
        window.location.href = "/pages/profile.html?username=" + encodeURIComponent(item.actor_username);
      } else if (item.post_id || item.comment_id) {
        window.location.href = "/pages/social-home.html?post=" + encodeURIComponent(item.post_id) + (item.comment_id ? "&comment=" + encodeURIComponent(item.comment_id) : "");
      }
    });

    list.appendChild(button);
  }
}

async function loadNotifications() {
  const list = $("#notifications-list");
  if (!supabase) {
    list.replaceChildren();
    const message = document.createElement("div");
    message.className = "notifications-empty";
    message.textContent = "Notifications could not connect. Please refresh the page.";
    list.appendChild(message);
    return;
  }

  list.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "notification-loading";
  loading.textContent = "Loading your notifications…";
  list.appendChild(loading);

  const { data, error } = await supabase.rpc("get_my_notifications_feed");
  if (error) {
    list.replaceChildren();
    const failure = document.createElement("div");
    failure.className = "notifications-empty";
    failure.textContent = "Could not load notifications. Please refresh and try again.";
    list.appendChild(failure);
    setStatus("Notification loading failed.", true);
    console.error("[Amora notifications]", error.message);
    return;
  }

  // Chat messages belong in Messages, not the Notifications page.
  // Keep underlying records intact for chat and unread logic.
  allNotifications = (data || [])
    .filter(row => row.notification_type !== "new_message")
    .map(row => ({ ...row }));
  updateUnreadCount();
  render();
  setStatus("");
}

document.querySelectorAll("[data-filter]").forEach(button => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(tab => {
      const selected = tab === button;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    render();
  });
});

$("#notifications-search")?.addEventListener("input", event => {
  searchQuery = event.target.value || "";
  render();
});
$("#refresh-notifications")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.classList.add("is-refreshing");
  try { await loadNotifications(); }
  finally { button.disabled = false; button.classList.remove("is-refreshing"); }
});

$("#mark-all-read")?.addEventListener("click", async () => {
  if (!supabase) return;
  const unread = allNotifications.filter(item => !item.read_at);
  if (!unread.length) {
    setStatus("You're all caught up.");
    return;
  }
  const button = $("#mark-all-read");
  button.disabled = true;
  try {
    for (const item of unread) {
      const { error } = await supabase.rpc("mark_my_notification_read", { p_notification_id: item.notification_id });
      if (error) throw error;
      item.read_at = new Date().toISOString();
    }
    updateUnreadCount();
    render();
    setStatus("All notifications marked as read.");
  } catch (error) {
    setStatus("Some notifications could not be marked as read.", true);
    await loadNotifications();
  } finally {
    button.disabled = false;
  }
});

if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) loadNotifications();
    else {
      allNotifications = [];
      updateUnreadCount();
      const list = $("#notifications-list");
      if (list) {
        list.replaceChildren();
        const empty = document.createElement("div");
        empty.className = "notifications-empty";
        empty.textContent = "Sign in to view your notifications.";
        list.appendChild(empty);
      }
    }
  });
}
loadNotifications();
setInterval(() => { if (!document.hidden) loadNotifications(); }, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadNotifications(); });
