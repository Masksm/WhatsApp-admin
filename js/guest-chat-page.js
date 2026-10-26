import { supabase } from "./core.js";

const $ = (s) => document.querySelector(s);
const TOKEN_KEY = "amora_guest_recovery_token";

function initGuestTheme(){
 const button=$("#guest-chat-theme-toggle");if(!button)return;
 const apply=theme=>{document.documentElement.setAttribute("data-theme",theme);try{localStorage.setItem("amora_appearance",theme);}catch{}button.textContent=theme==="dark"?"☀️ Light mode":"🌙 Dark mode";button.setAttribute("aria-pressed",String(theme==="dark"));};
 let current=document.documentElement.getAttribute("data-theme");if(current!=="light"&&current!=="dark"){try{current=localStorage.getItem("amora_appearance");}catch{}}
 apply(current==="light"?"light":"dark");
 button.addEventListener("click",()=>apply(document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark"));
}
initGuestTheme();

function openTokenPopup(){
 const panel=$("#guest-identity-section");if(!panel)return;
 panel.hidden=false;panel.classList.add("guest-token-modal");document.body.classList.add("guest-token-modal-open");
 $("#guest-identity-popup-close")?.focus();
}
function closeTokenPopup(){
 const panel=$("#guest-identity-section");if(!panel)return;
 panel.classList.remove("guest-token-modal");panel.hidden=true;document.body.classList.remove("guest-token-modal-open");
}
function openConversationPopup(){
 const panel=$("#guest-conversation-popup");if(!panel)return;
 panel.hidden=false;panel.classList.add("guest-token-modal");document.body.classList.add("guest-conversation-popup-open");
 $("#guest-reply-text")?.focus();
}
function closeConversationPopup(){
 const panel=$("#guest-conversation-popup");if(!panel)return;
 panel.classList.remove("guest-token-modal");panel.hidden=true;document.body.classList.remove("guest-conversation-popup-open");
}
$("#guest-recovery-token-action")?.addEventListener("click",openTokenPopup);
$("#guest-identity-popup-close")?.addEventListener("click",closeTokenPopup);
$("#guest-token-modal-close")?.addEventListener("click",()=>{$("#guest-token-panel").hidden=true;});
$("#guest-conversation-popup-close")?.addEventListener("click",closeConversationPopup);
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(document.body.classList.contains("guest-token-modal-open"))closeTokenPopup();if(document.body.classList.contains("guest-conversation-popup-open"))closeConversationPopup();}});
document.addEventListener("click",e=>{if(e.target===document.body){if(document.body.classList.contains("guest-token-modal-open"))closeTokenPopup();if(document.body.classList.contains("guest-conversation-popup-open"))closeConversationPopup();}});

const params = new URLSearchParams(location.search);
const slug = params.get("slug");
let token = "";
let activeConversationId = null;

function status(message, error=false) {
 const el=$("#guest-status");if(!el)return;
 el.textContent=message;el.style.color=error?"#b42318":"";
}
function saveToken(value) {
 token=value;
 try { sessionStorage.setItem(TOKEN_KEY,value); } catch {}
 $("#guest-token-panel").hidden=true;
 $("#guest-token-value").textContent=value;
 $("#guest-identity-controls").hidden=false;
 $("#guest-compose-card").hidden=true;
 $("#guest-chat-card").hidden=false;
 $("#guest-recovery-token-action").hidden=false;
}
async function recover(value) {
 if(!/^[a-f0-9]{64}$/.test(value))throw new Error("Enter a valid 64-character recovery token.");
 const {data,error}=await supabase.rpc("guest_get_conversations",{p_token:value});
 if(error)throw error;
 saveToken(value);
 $("#guest-compose-card").hidden=!!slug&&(data||[]).length===0?false:true;
 renderConversations(data||[]);
 closeTokenPopup();
 status("Guest identity recovered.");
}
function renderConversations(items) {
 const list=$("#guest-conversation-list");list.replaceChildren();
 if(!items.length){const p=document.createElement("p");p.textContent="No guest conversations yet. Start one using the link you received.";list.append(p);return;}
 items.forEach(item=>{
  const b=document.createElement("button");b.type="button";b.className="guest-conversation"+(item.conversation_id===activeConversationId?" active":"");
  const title=document.createElement("strong");title.textContent=item.other_anonymous_name||"Anonymous";
  const preview=document.createElement("div");preview.textContent=item.last_message_preview||"No messages yet";
  b.append(title,preview);b.addEventListener("click",()=>openConversation(item.conversation_id));list.append(b);
 });
}
async function refreshConversations(){
 const {data,error}=await supabase.rpc("guest_get_conversations",{p_token:token});
 if(error)throw error;
 renderConversations(data||[]);
 $("#guest-chat-card").hidden=false;
 $("#guest-compose-card").hidden=!slug||(data||[]).length>0;
}
async function openConversation(id){
 activeConversationId=id;
 $("#guest-compose-card").hidden=true;
 openConversationPopup();
 const list=$("#guest-message-list");list.replaceChildren();
 const {data,error}=await supabase.rpc("guest_get_messages_v2",{p_token:token,p_conversation_id:id});
 if(error){status(error.message,true);return;}
 (data||[]).forEach(m=>{
  const div=document.createElement("div");div.className="guest-message"+(m.sent_by_me?" mine":"");
  div.dataset.messageId=m.message_id;
  div.addEventListener("contextmenu",e=>{e.preventDefault();showGuestMessageActions(m);});
  let hold;div.addEventListener("touchstart",()=>{hold=setTimeout(()=>showGuestMessageActions(m),550);},{passive:true});
  ["touchend","touchmove","touchcancel"].forEach(type=>div.addEventListener(type,()=>clearTimeout(hold),{passive:true}));
  const meta=document.createElement("small");meta.textContent=(m.sender_anonymous_name||"Anonymous")+" · "+new Date(m.sent_at).toLocaleString();
  if(m.reply_to_message_id){const quote=document.createElement("blockquote");quote.className="guest-reply-quote";const who=document.createElement("strong");who.textContent="↪ "+(m.reply_to_sender_name||"Message");const excerpt=document.createElement("span");excerpt.textContent=m.reply_to_text||"Original message unavailable";quote.append(who,excerpt);div.append(quote);}
  const body=document.createElement("p");body.textContent=m.message_text;div.append(meta,body);
  if(m.sent_by_me){const del=document.createElement("button");del.type="button";del.textContent="Delete";del.addEventListener("click",async()=>{const {error}=await supabase.rpc("guest_delete_message",{p_token:token,p_message_id:m.message_id});if(error)status(error.message,true);else{status("Message deleted.");await openConversation(id);}});div.append(del);}
  list.append(div);
 });
 $("#guest-reply-text").disabled=false;$("#guest-reply-send").disabled=false;
 const refreshed=await supabase.rpc("guest_get_conversations",{p_token:token});
 if(!refreshed.error)renderConversations(refreshed.data||[]);
}

let guestActionMenu=null;
function closeGuestMessageActions(){guestActionMenu?.remove();guestActionMenu=null;}
function showGuestMessageActions(m){
 closeGuestMessageActions();const menu=document.createElement("div");menu.className="amora-message-actions";menu.setAttribute("role","menu");
 Object.assign(menu.style,{position:"fixed",zIndex:"10050",left:"50%",top:"50%",transform:"translate(-50%,-50%)",width:"min(290px,calc(100vw - 32px))",maxHeight:"min(75vh,520px)",overflowY:"auto",padding:"8px",borderRadius:"16px",background:"var(--card-bg,#fff)",color:"var(--text-color,#222)",boxShadow:"0 12px 40px #0004",border:"1px solid var(--border-color,#ddd)"});
 const add=(label,fn)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.style.cssText="display:block;width:100%;text-align:left;padding:11px 10px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;";b.addEventListener("click",async()=>{closeGuestMessageActions();try{await fn();}catch(e){status(e.message||"Message action failed.",true);}});menu.append(b);};
 add("Reply",()=>{const input=$("#guest-reply-text");input.dataset.replyTo=m.message_id;let preview=$("#guest-reply-preview");if(!preview){preview=document.createElement("div");preview.id="guest-reply-preview";preview.className="guest-reply-preview";$("#guest-reply-form")?.prepend(preview);}preview.replaceChildren();const label=document.createElement("span");label.textContent="Replying to: "+(m.message_text||"").slice(0,140);const cancel=document.createElement("button");cancel.type="button";cancel.textContent="×";cancel.setAttribute("aria-label","Cancel reply");cancel.addEventListener("click",()=>{delete input.dataset.replyTo;preview.remove();});preview.append(label,cancel);input.focus();});
 add("Copy",async()=>{await navigator.clipboard.writeText(m.message_text||"");status("Message copied.");});
 add("Info",()=>alert("Sent: "+new Date(m.sent_at).toLocaleString()));
 if(m.sent_by_me)add("Delete",async()=>{if(!confirm("Delete this message for everyone?"))return;const {error}=await supabase.rpc("guest_delete_message",{p_token:token,p_message_id:m.message_id});if(error)throw error;status("Message deleted.");await openConversation(activeConversationId);});
 add("Close",closeGuestMessageActions);document.body.append(menu);guestActionMenu=menu;
 setTimeout(()=>document.addEventListener("pointerdown",e=>{if(guestActionMenu&&!guestActionMenu.contains(e.target))closeGuestMessageActions();},{once:true}),0);
}
\n$("#guest-create-identity")?.addEventListener("click",async()=>{
 if(!supabase){status("Connection unavailable. Refresh and try again.",true);return;}
 try{
  $("#guest-create-identity").disabled=true;status("Creating your guest identity…");
  const {data,error}=await supabase.rpc("guest_create_identity");if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;if(!row?.recovery_token)throw new Error("The server did not return a recovery token.");
  saveToken(row.recovery_token);$("#guest-token-panel").hidden=false;status("Guest identity created. Copy your recovery token and keep it safe.");
  await refreshConversations();
 }catch(e){status(e.message||"Could not create guest identity.",true);}
 finally{$("#guest-create-identity").disabled=false;}
});
$("#guest-recover-identity")?.addEventListener("click",async()=>{
 try{status("Recovering guest chats…");await recover($("#guest-recovery-token").value.trim());}
 catch(e){status(e.message||"Could not recover guest chats.",true);}
});
$("#guest-copy-token")?.addEventListener("click",async()=>{
 try{await navigator.clipboard.writeText(token);status("Recovery token copied. Store it somewhere private.");}
 catch{status("Copy is unavailable. Select and copy the token above.",true);}
});
$("#guest-first-message-form")?.addEventListener("submit",async e=>{
 e.preventDefault();const text=$("#guest-first-message").value.trim();if(!text)return;
 const button=e.currentTarget.querySelector("button");button.disabled=true;
 try{
  const {data,error}=await supabase.rpc("guest_send_first_message",{p_token:token,p_slug:slug,p_message:text});
  if(error)throw error;if(data?.status==="blocked")throw new Error(data.message||"Message blocked by moderation.");
  $("#guest-first-message").value="";$("#guest-compose-card").hidden=true;status("Private message sent.");await refreshConversations();
  if(data?.conversation_id)await openConversation(data.conversation_id);
 }catch(err){status(err.message||"Could not send message.",true);}
 finally{button.disabled=false;}
});
$("#guest-reply-form")?.addEventListener("submit",async e=>{
 e.preventDefault();if(!activeConversationId)return;const input=$("#guest-reply-text");const text=input.value.trim();if(!text)return;
 const button=$("#guest-reply-send");button.disabled=true;
 try{
  const replyTo=input.dataset.replyTo;
  const {data,error}=replyTo
   ? await supabase.rpc("guest_send_reply_to_message",{p_token:token,p_conversation_id:activeConversationId,p_message:text,p_reply_to_message_id:replyTo})
   : await supabase.rpc("guest_send_reply",{p_token:token,p_conversation_id:activeConversationId,p_message:text});
  if(error)throw error;if(data?.status==="blocked")throw new Error(data.message||"Message blocked by moderation.");
  input.value="";delete input.dataset.replyTo;$("#guest-reply-preview")?.remove();status("Reply sent.");await openConversation(activeConversationId);
 }catch(err){status(err.message||"Could not send reply.",true);}
 finally{button.disabled=false;}
});
(async()=>{
 if(!supabase){status("Connection unavailable. Refresh and try again.",true);return;}
 $("#guest-identity-section").hidden=true;
 $("#guest-compose-card").hidden=true;
 $("#guest-chat-card").hidden=true;
 try{
  const saved=sessionStorage.getItem(TOKEN_KEY);
  if(saved){await recover(saved);return;}
 }catch(e){try{sessionStorage.removeItem(TOKEN_KEY);}catch{}status(e.message||"Saved guest identity could not be restored. Enter your recovery token.",true);}
 if(slug){$("#guest-compose-card").hidden=true;}
 $("#guest-recovery-token-action").hidden=false;
})();
