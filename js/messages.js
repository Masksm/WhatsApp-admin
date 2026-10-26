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
let conversationPreferences = new Map();

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
  visibleConversations.sort((a,b) => Number(Boolean(conversationPreferences.get(b.conversation_id)?.is_pinned)) - Number(Boolean(conversationPreferences.get(a.conversation_id)?.is_pinned)) || new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
  list.replaceChildren();

  if (!visibleConversations.length) {
    const empty = document.createElement("p");
    empty.textContent = conversationFilter === "unread" ? "No unread chats." : query ? "No conversations match your search." : "No conversations yet.";
    list.appendChild(empty);
    return;
  }

  visibleConversations.forEach((conversation) => {
    const row = document.createElement("div");
    row.className = "conversation-item-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";

    if (
      conversation.conversation_id === activeConversationId
    ) {
      button.classList.add("active");
    }

    const preference = conversationPreferences.get(conversation.conversation_id) || {};
    if (preference.is_ignored) button.classList.add("is-ignored");
    if (preference.is_pinned) button.classList.add("is-pinned");
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

    row.appendChild(button);
    const more = document.createElement("button");
    more.type = "button"; more.className = "conversation-more-button";
    more.textContent = "···"; more.setAttribute("aria-label", "Conversation actions for " + name);
    more.setAttribute("aria-haspopup", "menu");
    more.addEventListener("click", event => { event.stopPropagation(); showConversationActions(conversation, preference); });
    row.appendChild(more); list.appendChild(row);
  });
}


let conversationActionMenu = null;
function closeConversationActionsOutside(event){if(conversationActionMenu&&!conversationActionMenu.contains(event.target)){conversationActionMenu.remove();conversationActionMenu=null;document.removeEventListener("pointerdown",closeConversationActionsOutside,true);}}
function closeConversationActions(){conversationActionMenu?.remove();conversationActionMenu=null;document.removeEventListener("pointerdown",closeConversationActionsOutside,true);}
function showConversationActions(conversation, preference={}) {
  closeConversationActions();
  const menu=document.createElement("div");menu.className="conversation-action-menu";menu.setAttribute("role","menu");
  const title=document.createElement("strong");title.textContent=conversation.other_anonymous_name||"Anonymous";menu.append(title);
  const options=[[preference.is_pinned?"Unpin conversation":"Pin conversation","pinned",!preference.is_pinned],[preference.is_ignored?"Stop ignoring chat":"Ignore chat","ignored",!preference.is_ignored],[preference.is_blocked?"Unblock chat":"Block chat","blocked",!preference.is_blocked],["Delete conversation","deleted",true]];
  options.forEach(([label,kind,enabled])=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.setAttribute("role","menuitem");b.addEventListener("click",async()=>{closeConversationActions();try{const {error}=await supabase.rpc("set_conversation_preference",{p_conversation_id:conversation.conversation_id,p_conversation_type:"direct",p_preference:kind,p_enabled:enabled});if(error)throw error;await loadChatConversations(false);setChatStatus(kind==="deleted"?"Conversation deleted from your inbox.":label+" updated.");}catch(e){setChatStatus(getErrorMessage(e,"Could not update conversation."));}});menu.append(b);});
  const report=document.createElement("button");report.type="button";report.textContent="Report conversation";report.setAttribute("role","menuitem");report.addEventListener("click",async()=>{const reason=prompt("Why are you reporting this conversation?");if(reason===null)return;closeConversationActions();try{const {error}=await supabase.rpc("report_conversation",{p_conversation_id:conversation.conversation_id,p_conversation_type:"direct",p_reason:reason.trim()||"Other"});if(error)throw error;setChatStatus("Conversation report submitted.");}catch(e){setChatStatus(getErrorMessage(e,"Could not report conversation."));}});menu.append(report);
  const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Close";cancel.addEventListener("click",closeConversationActions);menu.append(cancel);
  document.body.append(menu);conversationActionMenu=menu;setTimeout(()=>document.addEventListener("pointerdown",closeConversationActionsOutside,true),0);
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
    const query = conversationSearch.trim().toLowerCase();
    const visibleMessages = messages.filter(item =>
      String(item.message_text || "").toLowerCase().includes(query)
    );
    if (!visibleMessages.length) {
      const empty = document.createElement("p");
      empty.className = "conversation-empty";
      empty.textContent = query
        ? "No anonymous messages match your search."
        : "No anonymous link messages yet. Messages sent through your personal anonymous link will appear here.";
      list.appendChild(empty);
      return;
    }
    visibleMessages.forEach(item => {
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
  try {
    const { data: guestRows, error: guestError } = await supabase.rpc("owner_get_guest_conversations");
    if (!guestError) {
      const unreadGuest = (guestRows || []).reduce((total, row) => total + (Number(row.unread_count) || 0), 0);
      const guestEntry = document.querySelector(".guest-inbox-entry");
      if (guestEntry) {
        let badge = guestEntry.querySelector(".guest-inbox-unread-badge");
        if (!badge) { badge = document.createElement("span"); badge.className = "guest-inbox-unread-badge"; guestEntry.append(badge); }
        badge.hidden = unreadGuest < 1;
        badge.textContent = unreadGuest > 99 ? "99+" : String(unreadGuest);
        badge.setAttribute("aria-label", unreadGuest + " unread guest messages");
      }
      document.querySelectorAll("[data-guest-inbox-unread]").forEach(el => {
        el.hidden = unreadGuest < 1; el.textContent = unreadGuest > 99 ? "99+" : String(unreadGuest);
      });
    }
  } catch {}
  const { data: prefs, error: prefsError } = await supabase.from("conversation_user_preferences")
    .select("conversation_id,is_blocked,is_ignored,is_pinned").eq("conversation_type", "direct");
  if (!prefsError) conversationPreferences = new Map((prefs || []).map(p => [p.conversation_id, p]));
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
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showMessageActions(message);
    });
    let holdTimer;
    item.addEventListener("touchstart", () => {
      holdTimer = setTimeout(() => showMessageActions(message), 550);
    }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach(type =>
      item.addEventListener(type, () => clearTimeout(holdTimer), { passive: true })
    );

    if (message.reply_to_message_id) {
      const quoted = document.createElement("blockquote");
      quoted.className = "chat-reply-quote";
      const who = document.createElement("strong");
      who.textContent = "↪ " + (message.reply_to_sender_name || "Message");
      const excerpt = document.createElement("span");
      excerpt.textContent = message.reply_to_text || "Original message unavailable";
      quoted.append(who, excerpt);
      item.appendChild(quoted);
    }
    const content = document.createElement("p");
    content.textContent = message.message_text || "";
    if (message.is_pinned) {
      const pinned = document.createElement("span");
      pinned.className = "amora-message-pinned";
      pinned.textContent = "📌 Pinned";
      item.appendChild(pinned);
    }

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


let messageActionMenu = null;
let messageActionOutsideHandler = null;
function closeMessageActions() {
  if (messageActionOutsideHandler) document.removeEventListener("pointerdown", messageActionOutsideHandler, true);
  messageActionOutsideHandler = null;
  messageActionMenu?.remove();
  messageActionMenu = null;
}
function showMessageActions(message) {
  closeMessageActions();
  const messageId = message.message_id || message.id;
  if (!messageId) return;
  const menu = document.createElement("div");
  menu.className = "amora-message-actions";
  menu.setAttribute("role", "menu");
  Object.assign(menu.style, {
    position:"fixed",zIndex:"10050",left:"50%",top:"50%",transform:"translate(-50%,-50%)",
    width:"min(290px,calc(100vw - 32px))",maxHeight:"min(75vh,520px)",overflow:"hidden",
    padding:"0",borderRadius:"16px",background:"var(--card-bg,#fff)",color:"var(--text-color,#222)",
    boxShadow:"0 12px 40px #0004",border:"1px solid var(--border-color,#ddd)"
  });
  const track=document.createElement("div");
  Object.assign(track.style,{display:"flex",width:"200%",transform:"translateX(0)",transition:"transform .22s ease",alignItems:"stretch"});
  const page=()=>{const p=document.createElement("div");Object.assign(p.style,{boxSizing:"border-box",flex:"0 0 50%",width:"50%",maxHeight:"min(75vh,520px)",overflowY:"auto",padding:"8px"});return p;};
  const first=page(),second=page();track.append(first,second);menu.append(track);
  const add=(target,label,action)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.style.cssText="display:block;width:100%;text-align:left;padding:11px 10px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;";b.addEventListener("click",async()=>{if(label==="More ›"||label==="‹ Back")return;closeMessageActions();try{await action();}catch(error){setChatStatus(getErrorMessage(error,"Message action failed."));}});target.append(b);return b;};
  const heading=document.createElement("strong");heading.textContent=message.sent_by_me?"Your message":"Message";heading.style.cssText="display:block;padding:8px 10px;";first.append(heading);
  add(first,"Reply",()=>{const input=$("#chat-message-text");if(!input)return;input.dataset.replyTo=messageId;let preview=$("#chat-reply-preview");if(!preview){preview=document.createElement("div");preview.id="chat-reply-preview";preview.className="chat-reply-preview";$("#chat-message-form")?.prepend(preview);}preview.replaceChildren();const label=document.createElement("span");label.textContent="Replying to: "+(message.message_text||"").slice(0,160);const cancel=document.createElement("button");cancel.type="button";cancel.textContent="×";cancel.setAttribute("aria-label","Cancel reply");cancel.addEventListener("click",()=>{delete input.dataset.replyTo;preview.remove();});preview.append(label,cancel);input.focus();});
  add(first,"Copy",async()=>{await navigator.clipboard.writeText(message.message_text||"");setChatStatus("Message copied.");});
  if(message.sent_by_me) add(first,"Delete for me",async()=>{if(!confirm("Hide this message from your account on all your devices? Other participants will still see it."))return;const {error}=await supabase.rpc("amora_message_action",{p_message_id:messageId,p_action:"delete_for_me",p_reason:null});if(error)throw error;setChatStatus("Message hidden from your account.");await loadChatMessages(activeConversationId);});
  add(first,"More ›",()=>{});
  const back=add(second,"‹ Back",()=>{});back.addEventListener("click",()=>{track.style.transform="translateX(0)";});
  const extra=(label,action)=>add(second,label,action);
  extra(message.is_pinned?"Unpin for everyone":"Pin for everyone",async()=>{const {error}=await supabase.rpc("amora_message_action",{p_message_id:messageId,p_action:message.is_pinned?"unpin":"pin",p_reason:null});if(error)throw error;setChatStatus(message.is_pinned?"Message unpinned for everyone.":"Message pinned for everyone.");await loadChatMessages(activeConversationId);});
  extra("Info",()=>alert("Sent: "+formatChatDate(message.sent_at)+"\nStatus: "+(message.read_at?"Read":"Sent")));
  if(!message.sent_by_me)extra("Report message",async()=>{const reason=prompt("Reason for report:","Other");if(reason===null)return;const {error}=await supabase.rpc("amora_message_action",{p_message_id:messageId,p_action:"report",p_reason:reason});if(error)throw error;setChatStatus("Report submitted.");});
  first.querySelector('button:last-child').addEventListener("click",()=>{track.style.transform="translateX(-50%)";});
  document.body.append(menu);messageActionMenu=menu;
  messageActionOutsideHandler = event => { if (messageActionMenu && !messageActionMenu.contains(event.target)) closeMessageActions(); };
  setTimeout(() => { if (messageActionMenu === menu) document.addEventListener("pointerdown", messageActionOutsideHandler, true); }, 0);
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
    const result = await supabase.rpc("get_conversation_messages_for_viewer_v2", { p_conversation_id: conversationId });
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
    if (incoming.some(m => !m.sent_by_me && !m.read_at)) {
      await supabase.rpc("mark_conversation_messages_read", { p_conversation_id: conversationId });
      await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
    }
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
      "get_conversation_messages_for_viewer_v2",
      { p_conversation_id: conversationId }
    );

    if (error) throw error;

    if (activeConversationId !== conversationId) return;

    const messages = data || [];
    lastMessageIds = new Set(messages.map(m => m.message_id || m.id).filter(Boolean));
    renderMessages(messages);
    setChatStatus("Messages update automatically.");
    startLiveMessageUpdates(conversationId);

    // Message receipts and notification receipts are separate database updates.
    await supabase.rpc("mark_conversation_messages_read", {
      p_conversation_id: conversationId
    });
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
    const replyInput = $("#chat-message-text");
    const replyTo = replyInput?.dataset.replyTo;
    const replyPreview = $("#chat-reply-preview");
    const { data, error } = replyTo
      ? await supabase.rpc("send_chat_message_reply", {
          p_conversation_id: conversationId,
          p_message: message,
          p_reply_to_message_id: replyTo
        })
      : await supabase.rpc("send_chat_message", {
          p_conversation_id: conversationId,
          p_message: message
        });

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

    if (input) {
      input.value = "";
      delete input.dataset.replyTo;
    }
    replyPreview?.remove();

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

function initEmojiPicker() {
  const form = $("#chat-message-form");
  const input = $("#chat-message-text");
  if (!form || !input || form.querySelector(".chat-emoji-toggle")) return;
  const toggle = document.createElement("button");
  toggle.type = "button"; toggle.className = "chat-emoji-toggle"; toggle.textContent = "☺";
  toggle.setAttribute("aria-label", "Choose emoji"); toggle.setAttribute("aria-expanded", "false"); toggle.title = "Choose emoji";
  const picker = document.createElement("div");
  picker.className = "chat-emoji-picker"; picker.hidden = true; picker.setAttribute("role", "group"); picker.setAttribute("aria-label", "Emoji picker");
  const emojis = ["😀","😂","🥹","😍","🥰","😘","😊","😉","😎","😭","😢","😡","🤔","🙈","🤗","🤭","😴","🥳","❤️","💕","💗","💖","💔","💋","💯","🔥","✨","🎉","👍","👎","🙏","👏","🤝","🫶","👀","💐","🌹","☀️","🌙","😅","😇","🤍","💜","💙","💚","🧡","🥺","😋","🤩","😌","😏","🤦","💃","🕺"];
  emojis.forEach((emoji) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "chat-emoji-option"; button.textContent = emoji; button.setAttribute("aria-label", emoji);
    button.addEventListener("click", () => { const start = input.selectionStart ?? input.value.length; const end = input.selectionEnd ?? start; input.setRangeText(emoji, start, end, "end"); input.focus(); });
    picker.appendChild(button);
  });
  toggle.addEventListener("click", () => { const open = picker.hidden; picker.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); });
  document.addEventListener("click", (event) => { if (!form.contains(event.target)) { picker.hidden = true; toggle.setAttribute("aria-expanded", "false"); } });
  form.insertBefore(toggle, input); form.insertBefore(picker, input);
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
  const anonymousCount = $("#anonymous-message-count");
  if (anonymousCount) {
    anonymousCount.hidden = true;
    anonymousCount.textContent = "0";
  }

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
  initEmojiPicker();
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
