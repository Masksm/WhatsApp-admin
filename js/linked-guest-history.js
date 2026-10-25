import { supabase } from "./core.js";
const $=s=>document.querySelector(s);let active=null;
function say(m,e=false){$("#linked-guest-status").textContent=m;$("#linked-guest-status").style.color=e?"#b42318":"";}
async function list(){
 const {data,error}=await supabase.rpc("account_get_linked_guest_conversations");if(error)throw error;
 const el=$("#linked-guest-list");el.replaceChildren();
 if(!data?.length){const p=document.createElement("p");p.textContent="No linked guest conversations yet. Link a recovery token from the Messages page to see history here.";el.append(p);return;}
 data.forEach(c=>{const b=document.createElement("button");b.type="button";b.className="guest-messaging-row"+(active===c.conversation_id?" active":"");const t=document.createElement("strong");t.textContent=c.other_anonymous_name||"Anonymous";const p=document.createElement("span");p.textContent=c.last_message_preview||"No messages yet";b.append(t,p);b.addEventListener("click",()=>open(c.conversation_id));el.append(b);});
}
async function open(id){
 active=id;const {data,error}=await supabase.rpc("account_get_linked_guest_messages",{p_conversation_id:id});if(error)throw error;
 const el=$("#linked-guest-messages");el.replaceChildren();
 (data||[]).forEach(m=>{const d=document.createElement("article");d.className="guest-messaging-message"+(m.sent_by_me?" mine":"");const meta=document.createElement("small");meta.textContent=(m.sender_anonymous_name||"Anonymous")+" · "+new Date(m.sent_at).toLocaleString();const body=document.createElement("p");body.textContent=m.message_text;d.append(meta,body);el.append(d);});
 $("#linked-guest-reply").disabled=false;$("#linked-guest-send").disabled=false;await list();
}
$("#linked-guest-reply-form").addEventListener("submit",async e=>{
 e.preventDefault();if(!active)return;const message=$("#linked-guest-reply").value.trim();if(!message)return;$("#linked-guest-send").disabled=true;
 try{const {data,error}=await supabase.rpc("account_send_linked_guest_message",{p_conversation_id:active,p_message:message});if(error)throw error;if(data?.status==="blocked")throw new Error(data.message||"Message blocked by moderation.");$("#linked-guest-reply").value="";say("Reply sent.");await open(active);}
 catch(err){say(err.message||"Could not send reply.",true);}finally{$("#linked-guest-send").disabled=false;}
});
(async()=>{if(!supabase){say("Connection unavailable.",true);return;}const {data,error}=await supabase.auth.getSession();if(error||!data?.session){say("Sign in to view linked guest history.",true);setTimeout(()=>location.href="/pages/home.html?auth=login",900);return;}try{await list();}catch(e){say(e.message||"Could not load linked guest history.",true);}})();
