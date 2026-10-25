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
  say("Guest history linked to your verified account. Existing conversations were not duplicated.");
  const link=document.createElement("a");link.href="/pages/linked-guest-history.html";link.textContent="Open linked guest history";status?.append(" ",link);
 }catch(err){say(err.message||"Could not link guest history.",true);}
 finally{button.disabled=false;}
});
