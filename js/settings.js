"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.amoraSupabase;
  const byId = (id) => document.getElementById(id);
  if (!supabase) { window.location.replace("/"); return; }
  let user = null;
  let originalUsername = "";
  const status = (message, error = false) => {
    const el = byId("settings-username-status");
    el.textContent = message || "";
    el.classList.toggle("is-error", error);
  };
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session) { window.location.replace("/?auth=login"); return; }
    const { data: verified, error: verifyError } = await supabase.auth.getUser(sessionData.session.access_token);
    if (verifyError || !verified?.user) { await supabase.auth.signOut({scope:"local"}); window.location.replace("/?auth=login"); return; }
    user = verified.user;
    const { data: profile, error: profileError } = await supabase.from("profiles").select("username").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    originalUsername = profile?.username || "";
    byId("settings-username").textContent = originalUsername || "Amora member";
    byId("settings-avatar").textContent = (originalUsername || "A").slice(0,1).toUpperCase();
    byId("settings-username-input").value = originalUsername;
  } catch (error) {
    byId("settings-username").textContent = "Could not load account";
    status(error.message || "Could not load your account.", true);
  }
  byId("settings-username-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!user) return;
    const input = byId("settings-username-input");
    const username = input.value.trim();
    if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) { status("Use 3–30 letters, numbers, or underscores.", true); return; }
    if (username.toLowerCase() === originalUsername.toLowerCase()) { status("Your username is already up to date."); return; }
    const button = byId("settings-save-username"); button.disabled = true; status("Saving username…");
    try {
      const { data, error } = await supabase.from("profiles").update({username,display_name:null}).eq("id",user.id).select("username").single();
      if (error) { if (error.code === "23505") throw new Error("That username is already taken. Try another one."); throw error; }
      originalUsername = data.username; input.value = originalUsername;
      byId("settings-username").textContent = originalUsername; byId("settings-avatar").textContent = originalUsername.slice(0,1).toUpperCase();
      status("Username updated.");
    } catch (error) { status(error.message || "Could not update username.", true); }
    finally { button.disabled = false; }
  });

  const traitOptions = {
    hobbies:["Reading","Gaming","Music","Cooking","Writing","Photography","Drawing","Sports","Gardening","Travel"],
    skills:["Coding","Design","Problem solving","Storytelling","Teaching","Making things","Research"],
    interests:["Science","Art","Technology","History","Nature","Psychology","Space","Fashion","Books","Movies"],
    vibe:["Adventure","Indoor activities","Outdoor activities","Quiet moments","Social butterfly","Trying new things","Routine and comfort"],
    likes:["Cats","Dogs","Coffee","Tea","Rainy days","Sunsets","Deep conversations","Comedy","Learning"],
    dislikes:["Loud places","Crowds","Spoilers","Early mornings","Spicy food","Small talk"],
    zodiac:["Aries","Taurus","Gemini","Cancer","Leo","Virgo","Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"],
    gender:["Woman","Man","Non-binary","Prefer not to say"]
  };
  const traitLabels={hobbies:"Hobbies",skills:"Skills",interests:"Interested in",vibe:"Your kind of vibe",likes:"Likes",dislikes:"Dislikes",zodiac:"Zodiac sign (optional)",gender:"Gender (optional)"};
  const traitFields=byId("settings-traits-fields"), traitStatus=byId("settings-traits-status"), traitSave=byId("settings-save-traits");
  const traitNode=(tag,cls,value)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=value;return el;};
  function renderTraitEditor(traits){
    traitFields.replaceChildren();
    Object.entries(traitOptions).forEach(([category,options])=>{
      const raw=traits?.[category],chosen=Array.isArray(raw)?raw.filter(v=>options.includes(v)):(typeof raw==="string"&&options.includes(raw)?[raw]:[]);
      const group=traitNode("fieldset","trait-editor-group");group.append(traitNode("legend","",traitLabels[category]));
      const wrap=traitNode("div","trait-options");
      options.forEach(value=>{const label=traitNode("label","trait-option"),input=document.createElement("input");input.type=category==="zodiac"||category==="gender"?"radio":"checkbox";input.name="trait-"+category;input.value=value;input.checked=chosen.includes(value);label.append(input,document.createTextNode(value));wrap.append(label);});
      if(category==="zodiac"||category==="gender"){const label=traitNode("label","trait-option"),input=document.createElement("input");input.type="radio";input.name="trait-"+category;input.value="";input.checked=chosen.length===0;label.append(input,document.createTextNode("Prefer not to share"));wrap.append(label);}
      group.append(wrap);traitFields.append(group);
    });
  }
  async function loadTraitEditor(){
    if(!user||!traitFields||!traitSave)return;
    traitStatus.textContent="Loading saved choices…";
    try{const {data,error}=await supabase.from("profiles").select("public_traits").eq("id",user.id).single();if(error)throw error;renderTraitEditor(data?.public_traits&&typeof data.public_traits==="object"?data.public_traits:{});traitStatus.textContent="";}
    catch(error){traitStatus.textContent=error.message||"Could not load your choices.";traitStatus.classList.add("is-error");}
  }
  traitSave?.addEventListener("click",async()=>{
    if(!user)return;traitSave.disabled=true;traitStatus.classList.remove("is-error");traitStatus.textContent="Saving your choices…";
    try{const public_traits={};Object.entries(traitOptions).forEach(([category,options])=>{const values=Array.from(traitFields.querySelectorAll('[name="trait-'+category+'"]:checked')).map(el=>el.value).filter(v=>options.includes(v));if(values.length)public_traits[category]=category==="zodiac"||category==="gender"?values[0]:values.slice(0,8);});const {error}=await supabase.from("profiles").update({public_traits}).eq("id",user.id);if(error)throw error;traitStatus.textContent="Your public traits are saved.";}
    catch(error){traitStatus.textContent=error.message||"Could not save your choices.";traitStatus.classList.add("is-error");}
    finally{traitSave.disabled=false;}
  });
  if(user)await loadTraitEditor();
  byId("settings-logout").addEventListener("click", async () => {
    const button = byId("settings-logout"); button.disabled = true; button.textContent = "Logging out…";
    const { error } = await supabase.auth.signOut();
    if (error) { button.disabled = false; button.textContent = "Log out ↗"; status(error.message || "Could not log out.", true); return; }
    window.location.replace("/?auth=login");
  });
});