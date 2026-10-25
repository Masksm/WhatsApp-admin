import { supabase } from "./core.js";
import { getPendingClaimTokens, savePendingClaimTokens } from "./auth.js";
const $=s=>document.querySelector(s);const params=new URLSearchParams(location.search);const slug=params.get("anon");
const form=$("#public-anonymous-form"),input=$("#public-anonymous-text"),button=$("#public-anonymous-submit"),status=$("#public-anonymous-status"),guestLink=$("#public-guest-chat-link");
if(guestLink&&slug)guestLink.href="/pages/guest-chat.html?slug="+encodeURIComponent(slug);
function say(message,error=false){status.textContent=message;status.style.color=error?"#b42318":"";}
if(!slug){form.hidden=true;say("This anonymous message link is missing its link code. Ask the sender for a fresh link.",true);}
form?.addEventListener("submit",async e=>{
 e.preventDefault();if(!supabase){say("Connection unavailable. Please try again.",true);return;}
 const message=input.value.trim();if(!message){say("Please enter a message.",true);return;}if(message.length>2000){say("Messages must be 2,000 characters or fewer.",true);return;}
 button.disabled=true;say("Sending your anonymous message…");
 try{
  const {data:claimToken,error}=await supabase.rpc("submit_anonymous_message",{p_slug:slug,p_message:message});if(error)throw error;
  if(typeof claimToken!=="string"||!/^[a-f0-9]{64}$/.test(claimToken))throw new Error("The message was sent, but its claim token was not returned correctly.");
  const tokens=getPendingClaimTokens();tokens.push(claimToken);savePendingClaimTokens(tokens);form.reset();
  status.replaceChildren();const title=document.createElement("strong");title.textContent="Message sent 💗";
  const copy=document.createElement("p");copy.textContent="Your anonymous message has been delivered. Create an account or log in to claim it within seven days.";
  const signup=document.createElement("a");signup.href="/pages/home.html?auth=signup";signup.className="primary-btn";signup.textContent="Create account";
  const login=document.createElement("a");login.href="/pages/home.html?auth=login";login.className="primary-btn";login.textContent="Log in";
  status.append(title,copy,signup,document.createTextNode(" "),login);
 }catch(err){say(err.message||"Could not send the anonymous message.",true);}
 finally{button.disabled=false;}
});
