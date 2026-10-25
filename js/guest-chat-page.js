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
 const panel=$("#guest-token-panel");if(panel.hidden)return;
 panel.hidden=false;panel.classList.add("guest-token-modal");document.body.classList.add("guest-token-modal-open");
 $("#guest-token-modal-close")?.focus();
}
function closeTokenPopup(){
 const panel=$("#guest-token-panel");panel.classList.remove("guest-token-modal");panel.hidden=true;document.body.classList.remove("guest-token-modal-open");
}
$("#guest-recovery-token-action")?.addEventListener("click",openTokenPopup);
$("#guest-token-modal-close")?.addEventListener("click",closeTokenPopup);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.body.classList.contains("guest-token-modal-open"))closeTokenPopup();});
document.addEventListener("click",e=>{if(e.target===document.body&&document.body.classList.contains("guest-token-modal-open"))closeTokenPopup();});


const params = new URLSearchParams(location.search);
const slug = params.get("slug");
let token = "";
let activeConversationId = null;

function status(message, error=false) {
  const el=$("#guest-status"); if (!el) return;
  el.textContent=message; el.style.color=error?"#b42318":"";
}
function saveToken(value) {
  token=value;
  try { sessionStorage.setItem(TOKEN_KEY,value); } catch {}
  $("#guest-token-panel").hidden=true;
  $("#guest-token-panel").classList.remove("guest-token-modal");
  $("#guest-recovery-token-action").hidden=false;
  $("#guest-token-value").textContent=value;
  $("#guest-identity-controls").hidden=true;
  $("#guest-compose-card").hidden=!slug;
  $("#guest-chat-card").hidden=false;
}
async function recover(value) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Enter a valid 64-character recovery token.");
  const {data,error}=await supabase.rpc("guest_get_conversations",{p_token:value});
  if(error) throw error;
  saveToken(value);
  renderConversations(data||[]);
  status("Guest identity recovered.");
}
function renderConversations(items) {
  const list=$("#guest-conversation-list"); list.replaceChildren();
  if(!items.length) {
    const p=document.createElement("p"); p.textContent="No guest conversations yet. Start one using the link you received."; list.append(p); return;
  }
  items.forEach(item=>{
    const b=document.createElement("button"); b.type="button"; b.className="guest-conversation"+(item.conversation_id===activeConversationId?" active":"");
    const title=document.createElement("strong"); title.textContent=item.other_anonymous_name||"Anonymous";
    const preview=document.createElement("div"); preview.textContent=item.last_message_preview||"No messages yet";
    b.append(title,preview); b.addEventListener("click",()=>openConversation(item.conversation_id)); list.append(b);
  });
}
async function refreshConversations() {
  const {data,error}=await supabase.rpc("guest_get_conversations",{p_token:token});
  if(error) throw error; renderConversations(data||[]);
}
async function openConversation(id) {
  activeConversationId=id;
  $("#guest-compose-card").hidden=true;
  const {data,error}=await supabase.rpc("guest_get_messages",{p_token:token,p_conversation_id:id});
  if(error){status(error.message,true);return;}
  const list=$("#guest-message-list"); list.replaceChildren();
  (data||[]).forEach(m=>{
    const div=document.createElement("div"); div.className="guest-message"+(m.sent_by_me?" mine":"");
    const meta=document.createElement("small"); meta.textContent=(m.sender_anonymous_name||"Anonymous")+" · "+new Date(m.sent_at).toLocaleString();
    const body=document.createElement("p"); body.textContent=m.message_text;
    div.append(meta,body);
    if(m.sent_by_me){const del=document.createElement("button");del.type="button";del.textContent="Delete";del.addEventListener("click",async()=>{const {error}=await supabase.rpc("guest_delete_message",{p_token:token,p_message_id:m.message_id});if(error)status(error.message,true);else{status("Message deleted.");await openConversation(id);}});div.append(del);}
    list.append(div);
  });
  $("#guest-reply-text").disabled=false; $("#guest-reply-send").disabled=false;
  renderConversations((await supabase.rpc("guest_get_conversations",{p_token:token})).data||[]);
}
$("#guest-create-identity")?.addEventListener("click",async()=>{
  if(!supabase){status("Connection unavailable. Refresh and try again.",true);return;}
  try{
    $("#guest-create-identity").disabled=true; status("Creating your guest identity…");
    const {data,error}=await supabase.rpc("guest_create_identity"); if(error)throw error;
    const row=Array.isArray(data)?data[0]:data;
    if(!row?.recovery_token)throw new Error("The server did not return a recovery token.");
    saveToken(row.recovery_token); status("Guest identity created. Copy your recovery token and keep it safe.");
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
  e.preventDefault(); const text=$("#guest-first-message").value.trim(); if(!text)return;
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
  e.preventDefault();if(!activeConversationId)return;const text=$("#guest-reply-text").value.trim();if(!text)return;
  const button=$("#guest-reply-send");button.disabled=true;
  try{
    const {data,error}=await supabase.rpc("guest_send_reply",{p_token:token,p_conversation_id:activeConversationId,p_message:text});
    if(error)throw error;if(data?.status==="blocked")throw new Error(data.message||"Message blocked by moderation.");
    $("#guest-reply-text").value="";status("Reply sent.");await openConversation(activeConversationId);
  }catch(err){status(err.message||"Could not send reply.",true);}
  finally{button.disabled=false;}
});
(async()=>{
  if(!supabase){status("Connection unavailable. Refresh and try again.",true);return;}
  try{const saved=sessionStorage.getItem(TOKEN_KEY);if(saved)await recover(saved);}
  catch{sessionStorage.removeItem(TOKEN_KEY);}
  if(!slug) { $("#guest-compose-card").hidden=true; }
  else if(!token) status("Create or recover a guest identity to start a private conversation.");
})();
