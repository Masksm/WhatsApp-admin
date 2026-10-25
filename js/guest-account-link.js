import { supabase } from "./core.js";
const form=document.querySelector("#guest-account-link-form");
const tokenInput=document.querySelector("#guest-account-link-token");
const consent=document.querySelector("#guest-account-link-consent");
const status=document.querySelector("#guest-account-link-status");
function say(message,error=false){if(status){status.textContent=message;status.style.color=error?"#b42318":"";}}
form?.addEventListener("submit",async event=>{
 event.preventDefault();
 const token=tokenInput?.value.trim()||"";
 if(!/^[a-f0-9]{64}$/.test(token)){say("Enter a valid 64-character recovery token.",true);return;}
 if(!consent?.checked){say("Please confirm consent before linking.",true);return;}
 const button=form.querySelector('button[type="submit"]');button.disabled=true;say("Checking account verification and linking guest history…");
 try{
  const {data:sessionData,error:sessionError}=await supabase.auth.getSession();if(sessionError)throw sessionError;
  if(!sessionData?.session){throw new Error("Sign in before linking guest history.");}
  const {data,error}=await supabase.rpc("guest_link_account",{p_token:token,p_consent:true});if(error)throw error;
  tokenInput.value="";consent.checked=false;
  const mergedChats = Number(data?.merged_conversations || 0);
  const mergedMessages = Number(data?.merged_messages || 0);
  say("Guest history linked. " + mergedChats + " conversation(s) and " + mergedMessages + " message(s) merged into your Chats.");
  const link=document.createElement("a");link.href="/pages/messages.html";link.textContent="Open Messages";status?.append(" ",link);
 }catch(err){say(err.message||"Could not link guest history.",true);}
 finally{button.disabled=false;}
});


// These controls only dismiss the optional recovery panel; they never alter guest data.
const guestLinkPanel=document.querySelector("#guest-account-link-panel");
const closeGuestLink=document.querySelector("#guest-link-close");
const noGuestAccount=document.querySelector("#guest-link-no-history");
closeGuestLink?.addEventListener("click",()=>{if(guestLinkPanel){guestLinkPanel.hidden=true;guestLinkPanel.classList.remove("guest-link-modal");document.body.classList.remove("guest-link-modal-open");}});
noGuestAccount?.addEventListener("click",()=>{
 if(guestLinkPanel){guestLinkPanel.hidden=true;guestLinkPanel.classList.remove("guest-link-modal");document.body.classList.remove("guest-link-modal-open");}
});

// Show recovery as a first-visit prompt whenever Messages is entered or reloaded.
if (guestLinkPanel) {
  const fromSettings = window.location.hash === "#guest-chat-recovery";
  guestLinkPanel.hidden = false;
  guestLinkPanel.classList.add("guest-link-modal");
  document.body.classList.add("guest-link-modal-open");
  if (fromSettings) setTimeout(() => guestLinkPanel.scrollIntoView({behavior:"smooth",block:"center"}), 50);
}
