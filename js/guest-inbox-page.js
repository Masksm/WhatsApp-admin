import { supabase } from "./core.js";
const $=s=>document.querySelector(s);let active=null;
function say(t,err=false){$("#owner-guest-status").textContent=t;$("#owner-guest-status").style.color=err?"#b42318":"";}
function setActiveTab(which){
 const chat=which==="chat";const chatTab=$("#guest-chat-tab"),anonTab=$("#anonymous-message-tab");
 $("#guest-chat-panel").hidden=!chat;$("#anonymous-message-panel").hidden=chat;
 chatTab.classList.toggle("active",chat);anonTab.classList.toggle("active",!chat);
 chatTab.setAttribute("aria-selected",String(chat));anonTab.setAttribute("aria-selected",String(!chat));
 $("#guest-inbox-list-subtitle").textContent=chat?"Private chats you can reply to":"Anonymous link messages";
}
async function listConversations(){
 const {data,error}=await supabase.rpc("owner_get_guest_conversations");if(error)throw error;
 const list=$("#owner-guest-list");list.replaceChildren();
 if(!data?.length){const p=document.createElement("p");p.textContent="No guest conversations yet.";list.append(p);return;}
 data.forEach(c=>{const b=document.createElement("button");b.type="button";b.className="guest-row"+(active===c.conversation_id?" active":"");b.className="conversation-item"+(active===c.conversation_id?" active":"");
 const avatar=document.createElement("span");avatar.className="conversation-avatar";avatar.textContent=(c.guest_anonymous_name||"G").slice(0,1).toUpperCase();
 const copy=document.createElement("span");copy.className="conversation-copy";
 const title=document.createElement("strong");title.textContent=c.guest_anonymous_name||"Guest";
 const preview=document.createElement("span");preview.className="conversation-preview";preview.textContent=c.last_message_preview||"No messages yet";
 copy.append(title,preview);b.replaceChildren(avatar,copy);b.addEventListener("click",()=>openChat(c.conversation_id));list.append(b);});
}
async function listAnonymousLinkMessages(){
 const target=$("#owner-anonymous-link-list");
 const {data,error}=await supabase.rpc("get_my_anonymous_inbox");
 if(error)throw error;
 target.replaceChildren();
 if(!data?.length){const p=document.createElement("p");p.textContent="No anonymous link messages yet.";target.append(p);return;}
 data.forEach(m=>{
  const card=document.createElement("article");card.className="conversation-item anonymous-inbox-item";const avatar=document.createElement("span");avatar.className="conversation-avatar";avatar.textContent="♡";const copy=document.createElement("span");copy.className="conversation-copy";
  const meta=document.createElement("small");
  meta.textContent=new Date(m.created_at).toLocaleString()+" · "+(m.is_read?"Read":"Unread");
  const body=document.createElement("span");body.className="conversation-preview";body.textContent=m.message_text||"";copy.append(meta,body);card.append(avatar,copy);target.append(card);
 });
}
function closeChatPopup(){document.body.classList.remove("guest-chat-popup-open");}
$("#guest-chat-popup-close")?.addEventListener("click",closeChatPopup);
$("#guest-inbox-mobile-back")?.addEventListener("click",closeChatPopup);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeChatPopup();});
async function openChat(id){
 active=id;document.body.classList.add("guest-chat-popup-open");const {data,error}=await supabase.rpc("owner_get_guest_messages",{p_conversation_id:id});if(error)throw error;
 const list=$("#owner-guest-messages");list.replaceChildren();
 (data||[]).forEach(m=>{const div=document.createElement("div");div.className="guest-msg"+(m.sent_by_me?" mine":"");const meta=document.createElement("small");meta.textContent=(m.sender_anonymous_name||"Anonymous")+" · "+new Date(m.sent_at).toLocaleString();const body=document.createElement("p");body.textContent=m.message_text;div.append(meta,body);if(m.sent_by_me){const del=document.createElement("button");del.type="button";del.textContent="Delete";del.addEventListener("click",async()=>{const {error}=await supabase.rpc("owner_delete_guest_message",{p_conversation_id:id,p_message_id:m.message_id});if(error)say(error.message,true);else{say("Message deleted.");await openChat(id);}});div.append(del);}list.append(div);});
 $("#owner-guest-reply").disabled=false;$("#owner-guest-send").disabled=false;await listConversations();
}
$("#owner-guest-reply-form").addEventListener("submit",async e=>{e.preventDefault();if(!active)return;const text=$("#owner-guest-reply").value.trim();if(!text)return;$("#owner-guest-send").disabled=true;try{const {data,error}=await supabase.rpc("owner_send_guest_message",{p_conversation_id:active,p_message:text});if(error)throw error;if(data?.status==="blocked")throw new Error(data.message||"Message blocked by moderation.");$("#owner-guest-reply").value="";say("Reply sent.");await openChat(active);}catch(err){say(err.message||"Could not send reply.",true);}finally{$("#owner-guest-send").disabled=false;}});

setActiveTab("chat");$("#guest-chat-tab")?.addEventListener("click",()=>setActiveTab("chat"));$("#anonymous-message-tab")?.addEventListener("click",()=>setActiveTab("anonymous"));$("#refresh-guest-inbox")?.addEventListener("click",async()=>{try{say("Refreshing guest inbox…");await listConversations();await listAnonymousLinkMessages();say("Inbox refreshed.");}catch(e){say(e.message||"Could not refresh inbox.",true);}});
(async()=>{if(!supabase){say("Connection unavailable.",true);return;}const {data,error}=await supabase.auth.getSession();if(error||!data?.session){say("Please sign in to view guest conversations.",true);setTimeout(()=>location.href="/pages/home.html?auth=login",900);return;}try{await listConversations();}catch(e){say(e.message||"Could not load guest conversations.",true);}try{await listAnonymousLinkMessages();}catch(e){const target=$("#owner-anonymous-link-list");target.textContent="Could not load anonymous link messages. "+(e.message||"Please try again.");}})();
