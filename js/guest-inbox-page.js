import { supabase } from "./core.js";
const $=s=>document.querySelector(s);let active=null;
function say(t,err=false){$("#owner-guest-status").textContent=t;$("#owner-guest-status").style.color=err?"#b42318":"";}
async function listConversations(){
 const {data,error}=await supabase.rpc("owner_get_guest_conversations");if(error)throw error;
 const list=$("#owner-guest-list");list.replaceChildren();
 if(!data?.length){const p=document.createElement("p");p.textContent="No guest conversations yet.";list.append(p);return;}
 data.forEach(c=>{const b=document.createElement("button");b.type="button";b.className="guest-row"+(active===c.conversation_id?" active":"");const title=document.createElement("strong");title.textContent=c.guest_anonymous_name||"Guest";const preview=document.createElement("div");preview.textContent=c.last_message_preview||"No messages yet";b.append(title,preview);b.addEventListener("click",()=>openChat(c.conversation_id));list.append(b);});
}
async function listAnonymousLinkMessages(){
 const target=$("#owner-anonymous-link-list");
 const {data,error}=await supabase.rpc("get_my_anonymous_inbox");
 if(error)throw error;
 target.replaceChildren();
 if(!data?.length){const p=document.createElement("p");p.textContent="No anonymous link messages yet.";target.append(p);return;}
 data.forEach(m=>{
  const card=document.createElement("article");card.className="anonymous-link-message";
  const meta=document.createElement("small");
  meta.textContent=new Date(m.created_at).toLocaleString()+" · "+(m.is_read?"Read":"Unread");
  const body=document.createElement("p");body.textContent=m.message_text||"";
  const link=document.createElement("a");link.href="/pages/messages.html";link.textContent="Open Anonymous Messages";
  card.append(meta,body,link);target.append(card);
 });
}
async function openChat(id){
 active=id;const {data,error}=await supabase.rpc("owner_get_guest_messages",{p_conversation_id:id});if(error)throw error;
 const list=$("#owner-guest-messages");list.replaceChildren();
 (data||[]).forEach(m=>{const div=document.createElement("div");div.className="guest-msg"+(m.sent_by_me?" mine":"");const meta=document.createElement("small");meta.textContent=(m.sender_anonymous_name||"Anonymous")+" · "+new Date(m.sent_at).toLocaleString();const body=document.createElement("p");body.textContent=m.message_text;div.append(meta,body);if(m.sent_by_me){const del=document.createElement("button");del.type="button";del.textContent="Delete";del.addEventListener("click",async()=>{const {error}=await supabase.rpc("owner_delete_guest_message",{p_conversation_id:id,p_message_id:m.message_id});if(error)say(error.message,true);else{say("Message deleted.");await openChat(id);}});div.append(del);}list.append(div);});
 $("#owner-guest-reply").disabled=false;$("#owner-guest-send").disabled=false;await listConversations();
}
$("#owner-guest-reply-form").addEventListener("submit",async e=>{e.preventDefault();if(!active)return;const text=$("#owner-guest-reply").value.trim();if(!text)return;$("#owner-guest-send").disabled=true;try{const {data,error}=await supabase.rpc("owner_send_guest_message",{p_conversation_id:active,p_message:text});if(error)throw error;if(data?.status==="blocked")throw new Error(data.message||"Message blocked by moderation.");$("#owner-guest-reply").value="";say("Reply sent.");await openChat(active);}catch(err){say(err.message||"Could not send reply.",true);}finally{$("#owner-guest-send").disabled=false;}});
(async()=>{if(!supabase){say("Connection unavailable.",true);return;}const {data,error}=await supabase.auth.getSession();if(error||!data?.session){say("Please sign in to view guest conversations.",true);setTimeout(()=>location.href="/pages/home.html?auth=login",900);return;}try{await listConversations();}catch(e){say(e.message||"Could not load guest conversations.",true);}try{await listAnonymousLinkMessages();}catch(e){const target=$("#owner-anonymous-link-list");target.textContent="Could not load anonymous link messages. "+(e.message||"Please try again.");}})();
