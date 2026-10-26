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
function closeChatPopup(){
 document.body.classList.remove("guest-chat-popup-open");
 const panel=$(".guest-inbox-workspace .chat-panel");
 if(panel){panel.style.position="";panel.style.display="";panel.style.zIndex="";panel.style.left="";panel.style.top="";panel.style.transform="";panel.style.width="";panel.style.height="";panel.style.maxHeight="";panel.style.overflow="";}
}

let ownerGuestActionMenu=null, ownerGuestActionOutsideHandler=null;
function closeOwnerGuestActions(){if(ownerGuestActionOutsideHandler)document.removeEventListener("pointerdown",ownerGuestActionOutsideHandler,true);ownerGuestActionOutsideHandler=null;ownerGuestActionMenu?.remove();ownerGuestActionMenu=null;}
function showOwnerGuestActions(m,conversationId){
 closeOwnerGuestActions();const menu=document.createElement("div");menu.className="amora-message-actions";menu.setAttribute("role","menu");
 Object.assign(menu.style,{position:"fixed",zIndex:"10050",left:"50%",top:"50%",transform:"translate(-50%,-50%)",width:"min(290px,calc(100vw - 32px))",maxHeight:"min(75vh,520px)",overflow:"hidden",padding:"0",borderRadius:"16px",background:"var(--card-bg,#fff)",color:"var(--text-color,#222)",boxShadow:"0 12px 40px #0004",border:"1px solid var(--border-color,#ddd)"});
 const track=document.createElement("div");Object.assign(track.style,{display:"flex",width:"200%",transform:"translateX(0)",transition:"transform .22s ease"});const page=()=>{const p=document.createElement("div");Object.assign(p.style,{boxSizing:"border-box",flex:"0 0 50%",width:"50%",maxHeight:"min(75vh,520px)",overflowY:"auto",padding:"8px"});return p;};const first=page(),second=page();track.append(first,second);menu.append(track);
 const add=(target,label,fn)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.style.cssText="display:block;width:100%;text-align:left;padding:11px 10px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;";b.addEventListener("click",async()=>{if(label==="More ›"||label==="‹ Back")return;closeOwnerGuestActions();try{await fn();}catch(e){say(e.message||"Message action failed.",true);}});target.append(b);return b;};
 const heading=document.createElement("strong");heading.textContent=m.sent_by_me?"Your message":"Message";heading.style.cssText="display:block;padding:8px 10px;";first.append(heading);
 add(first,"Reply",()=>{const input=$("#owner-guest-reply");input.dataset.replyTo=m.message_id;let preview=$("#owner-guest-reply-preview");if(!preview){preview=document.createElement("div");preview.id="owner-guest-reply-preview";preview.className="guest-reply-preview";$("#owner-guest-reply-form")?.prepend(preview);}preview.replaceChildren();const label=document.createElement("span");label.textContent="Replying to: "+(m.message_text||"").slice(0,140);const cancel=document.createElement("button");cancel.type="button";cancel.textContent="×";cancel.setAttribute("aria-label","Cancel reply");cancel.addEventListener("click",()=>{delete input.dataset.replyTo;preview.remove();});preview.append(label,cancel);input.focus();});
 add(first,"Copy",async()=>{await navigator.clipboard.writeText(m.message_text||"");say("Message copied.");});
 if(m.sent_by_me)add(first,"Delete",async()=>{if(!confirm("Delete this message for everyone?"))return;const {error}=await supabase.rpc("owner_delete_guest_message",{p_conversation_id:conversationId,p_message_id:m.message_id});if(error)throw error;say("Message deleted.");await openChat(conversationId);});
 const more=add(first,"More ›",()=>{});more.addEventListener("click",()=>{track.style.transform="translateX(-50%)";});
 const back=add(second,"‹ Back",()=>{});back.addEventListener("click",()=>{track.style.transform="translateX(0)";});
 add(second,"Info",()=>alert("Sent: "+new Date(m.sent_at).toLocaleString()));
 document.body.append(menu);ownerGuestActionMenu=menu;ownerGuestActionOutsideHandler=e=>{if(ownerGuestActionMenu&&!ownerGuestActionMenu.contains(e.target))closeOwnerGuestActions();};setTimeout(()=>{if(ownerGuestActionMenu===menu)document.addEventListener("pointerdown",ownerGuestActionOutsideHandler,true);},0);
}

$("#guest-chat-popup-close")?.addEventListener("click",closeChatPopup);
$("#guest-inbox-mobile-back")?.addEventListener("click",closeChatPopup);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeChatPopup();});
async function openChat(id){
 active=id;document.body.classList.add("guest-chat-popup-open");
 const panel=$(".guest-inbox-workspace .chat-panel");
 if(panel){panel.style.display="flex";panel.style.position="fixed";panel.style.zIndex="10001";panel.style.left="50%";panel.style.top="50%";panel.style.transform="translate(-50%,-50%)";panel.style.width="min(720px, calc(100vw - 28px))";panel.style.height="min(780px, calc(100dvh - 32px))";panel.style.maxHeight="calc(100dvh - 32px)";panel.style.overflow="hidden";}
 const {data,error}=await supabase.rpc("owner_get_guest_messages_v2",{p_conversation_id:id});if(error)throw error;
 const list=$("#owner-guest-messages");list.replaceChildren();
 (data||[]).forEach(m=>{const div=document.createElement("div");div.className="guest-msg"+(m.sent_by_me?" mine":"");
 div.addEventListener("contextmenu",e=>{e.preventDefault();showOwnerGuestActions(m,id);});let hold;div.addEventListener("touchstart",()=>{hold=setTimeout(()=>showOwnerGuestActions(m,id),550);},{passive:true});["touchend","touchmove","touchcancel"].forEach(type=>div.addEventListener(type,()=>clearTimeout(hold),{passive:true}));
 const meta=document.createElement("small");meta.textContent=(m.sender_anonymous_name||"Anonymous")+" · "+new Date(m.sent_at).toLocaleString();if(m.reply_to_message_id){const quote=document.createElement("blockquote");quote.className="guest-reply-quote";const who=document.createElement("strong");who.textContent="↪ "+(m.reply_to_sender_name||"Message");const excerpt=document.createElement("span");excerpt.textContent=m.reply_to_text||"Original message unavailable";quote.append(who,excerpt);div.append(quote);}const body=document.createElement("p");body.textContent=m.message_text;div.append(meta,body);if(m.sent_by_me){const del=document.createElement("button");del.type="button";del.textContent="Delete";del.addEventListener("click",async()=>{const {error}=await supabase.rpc("owner_delete_guest_message",{p_conversation_id:id,p_message_id:m.message_id});if(error)say(error.message,true);else{say("Message deleted.");await openChat(id);}});div.append(del);}list.append(div);});
 $("#owner-guest-reply").disabled=false;$("#owner-guest-send").disabled=false;await listConversations();
}
$("#owner-guest-reply-form").addEventListener("submit",async e=>{e.preventDefault();if(!active)return;const input=$("#owner-guest-reply");const text=input.value.trim();if(!text)return;$("#owner-guest-send").disabled=true;try{const replyTo=input.dataset.replyTo;const {data,error}=replyTo?await supabase.rpc("owner_send_guest_message_reply",{p_conversation_id:active,p_message:text,p_reply_to_message_id:replyTo}):await supabase.rpc("owner_send_guest_message",{p_conversation_id:active,p_message:text});if(error)throw error;if(data?.status==="blocked")throw new Error(data.message||"Message blocked by moderation.");input.value="";delete input.dataset.replyTo;$("#owner-guest-reply-preview")?.remove();say("Reply sent.");await openChat(active);}catch(err){say(err.message||"Could not send reply.",true);}finally{$("#owner-guest-send").disabled=false;}});

setActiveTab("chat");$("#guest-chat-tab")?.addEventListener("click",()=>setActiveTab("chat"));$("#anonymous-message-tab")?.addEventListener("click",()=>setActiveTab("anonymous"));$("#refresh-guest-inbox")?.addEventListener("click",async()=>{try{say("Refreshing guest inbox…");await listConversations();await listAnonymousLinkMessages();say("Inbox refreshed.");}catch(e){say(e.message||"Could not refresh inbox.",true);}});
(async()=>{if(!supabase){say("Connection unavailable.",true);return;}const {data,error}=await supabase.auth.getSession();if(error||!data?.session){say("Please sign in to view guest conversations.",true);setTimeout(()=>location.href="/pages/home.html?auth=login",900);return;}try{await listConversations();}catch(e){say(e.message||"Could not load guest conversations.",true);}try{await listAnonymousLinkMessages();}catch(e){const target=$("#owner-anonymous-link-list");target.textContent="Could not load anonymous link messages. "+(e.message||"Please try again.");}})();
