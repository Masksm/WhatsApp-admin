"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.amoraSupabase;
  const byId = (id) => document.getElementById(id);
  if (!supabase) { window.location.replace("/"); return; }
  let user = null;
  let originalUsername = "";
  let originalDisplayName = "";
  let usernameChangedAt = null;
  const status = (message, error = false) => {
    const el = byId("settings-username-status");
    el.textContent = message || "";
    el.classList.toggle("is-error", error);
  };
  const displayNameStatus = (message, error = false) => {
    const el = byId("settings-display-name-status");
    el.textContent = message || "";
    el.classList.toggle("is-error", error);
  };
  const usernameNextChange = () => usernameChangedAt ? new Date(new Date(usernameChangedAt).getTime() + 12 * 60 * 60 * 1000) : null;
  const updateUsernameCooldownUI = () => {
    const next = usernameNextChange();
    const button = byId("settings-save-username");
    const blocked = Boolean(next && next.getTime() > Date.now());
    if (button) button.disabled = blocked;
    if (blocked) status("You can change your username again " + next.toLocaleString() + ".");
    else status("You can change your username now.");
  };
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session) { window.location.replace("/?auth=login"); return; }
    const { data: verified, error: verifyError } = await supabase.auth.getUser(sessionData.session.access_token);
    if (verifyError || !verified?.user) { await supabase.auth.signOut({scope:"local"}); window.location.replace("/?auth=login"); return; }
    user = verified.user;
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("username,display_name,last_username_change_at").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    originalUsername = profile?.username || "";
    originalDisplayName = profile?.display_name || "";
    usernameChangedAt = profile?.last_username_change_at || null;
    byId("settings-username").textContent = originalUsername || "Amora member";
    byId("settings-avatar").textContent = (originalDisplayName || originalUsername || "A").slice(0,1).toUpperCase();
    byId("settings-username-input").value = originalUsername;
    byId("settings-display-name-input").value = originalDisplayName;
    updateUsernameCooldownUI();
    if (!originalDisplayName) displayNameStatus("Choose a display name or generate one with Random.");
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
    const next = usernameNextChange();
    if (next && next.getTime() > Date.now()) { updateUsernameCooldownUI(); return; }
    const button = byId("settings-save-username"); button.disabled = true; status("Saving username…");
    try {
      const { data, error } = await supabase.from("profiles").update({username}).eq("id",user.id)
        .select("username,last_username_change_at").single();
      if (error) {
        if (error.code === "23505") throw new Error("That username is already taken. Try another one.");
        if (/once every 12 hours|change your username/i.test(error.message || "")) throw new Error(error.message);
        throw error;
      }
      originalUsername = data.username; usernameChangedAt = data.last_username_change_at || new Date().toISOString();
      input.value = originalUsername;
      byId("settings-username").textContent = originalUsername;
      refreshAccountSummaries();
      closeAccountDialog(usernameDialog);
      updateUsernameCooldownUI();
      status("Username updated. You can change it again " + usernameNextChange().toLocaleString() + ".");
    } catch (error) { status(error.message || "Could not update username.", true); }
    finally { updateUsernameCooldownUI(); }
  });
  const randomAdjectives = ["Velvet","Cosmic","Misty","Golden","Quiet","Lunar","Clever","Mellow","Crimson","Sunny","Hidden","Silver","Dreamy","Gentle","Wild","Lucky","Soft","Midnight","Honey","Nova"];
  const randomNouns = ["Fox","Comet","Willow","Raven","Otter","Bloom","Echo","Finch","Orbit","Clover","Ember","Cloud","Wren","River","Star","Dove","Pixel","Sparrow","Moon","Fern"];
  const randomDisplayName = () => randomAdjectives[Math.floor(Math.random()*randomAdjectives.length)] + " " + randomNouns[Math.floor(Math.random()*randomNouns.length)];
  byId("settings-random-display-name")?.addEventListener("click", () => {
    byId("settings-display-name-input").value = randomDisplayName();
    displayNameStatus("Random name generated. Save it to apply it to your profile.");
  });
  byId("settings-display-name-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!user) return;
    const input = byId("settings-display-name-input");
    const displayName = input.value.trim();
    if (displayName.length < 2 || displayName.length > 32) { displayNameStatus("Use a display name between 2 and 32 characters.", true); return; }
    if (displayName === originalDisplayName) { displayNameStatus("Your display name is already up to date."); return; }
    const button = byId("settings-save-display-name"); button.disabled = true; displayNameStatus("Saving display name…");
    try {
      const { data, error } = await supabase.from("profiles").update({display_name:displayName}).eq("id",user.id)
        .select("display_name").single();
      if (error) throw error;
      originalDisplayName = data.display_name || "";
      input.value = originalDisplayName;
      byId("settings-avatar").textContent = (originalDisplayName || originalUsername || "A").slice(0,1).toUpperCase();
      refreshAccountSummaries();
      closeAccountDialog(displayNameDialog);
      displayNameStatus("Display name updated.");
    } catch (error) { displayNameStatus(error.message || "Could not update your display name.", true); }
    finally { button.disabled = false; }
  });

  const usernameDialog = byId("settings-username-dialog");
  const displayNameDialog = byId("settings-display-name-dialog");
  const closeAccountDialog = dialog => { if (dialog) dialog.hidden = true; document.body.classList.remove("traits-dialog-open"); };
  const openAccountDialog = (dialog, focusId) => { if (!dialog) return; dialog.hidden = false; document.body.classList.add("traits-dialog-open"); byId(focusId)?.focus(); };
  byId("settings-open-username")?.addEventListener("click", () => openAccountDialog(usernameDialog, "settings-username-input"));
  byId("settings-open-display-name")?.addEventListener("click", () => openAccountDialog(displayNameDialog, "settings-display-name-input"));
  byId("settings-close-username")?.addEventListener("click", () => closeAccountDialog(usernameDialog));
  byId("settings-close-display-name")?.addEventListener("click", () => closeAccountDialog(displayNameDialog));
  [usernameDialog, displayNameDialog].forEach(dialog => dialog?.addEventListener("click", event => { if (event.target === dialog) closeAccountDialog(dialog); }));
  document.addEventListener("keydown", event => { if (event.key === "Escape") [usernameDialog, displayNameDialog].forEach(dialog => { if (dialog && !dialog.hidden) closeAccountDialog(dialog); }); });
  const usernameSummary = byId("settings-username-summary");
  const displayNameSummary = byId("settings-display-name-summary");
  const refreshAccountSummaries = () => { if (usernameSummary) usernameSummary.textContent = originalUsername ? "@" + originalUsername + " · Changeable once every 12 hours." : "Manage your unique @username."; if (displayNameSummary) displayNameSummary.textContent = originalDisplayName || "Choose the name shown on your profile."; };
  refreshAccountSummaries();

  const appearanceDialog=byId("settings-appearance-dialog");
  const appearanceOpen=byId("settings-open-appearance");
  const appearanceSummary=byId("settings-appearance-summary");
  const appearanceStatus=byId("settings-appearance-status");
  const appearanceKey="amora_appearance";
  const currentAppearance=()=>{try{return localStorage.getItem(appearanceKey)||"system";}catch{return "system";}};
  const systemDark=()=>window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effectiveAppearance=()=>currentAppearance()==="system"?(systemDark()?"dark":"light"):currentAppearance();
  function applyAppearance(value){
    const mode=["light","dark","system"].includes(value)?value:"system";
    try{if(mode==="system")localStorage.removeItem(appearanceKey);else localStorage.setItem(appearanceKey,mode);}catch{}
    if(mode==="system")document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme",mode);
    const active=mode==="system"?"System default":mode==="light"?"Light mode":"Dark mode";
    if(appearanceSummary)appearanceSummary.textContent=active+" selected. Tap to change.";
    document.querySelectorAll("[data-appearance]").forEach(button=>{
      const selected=button.dataset.appearance===mode;
      button.classList.toggle("is-selected",selected);
      button.setAttribute("aria-pressed",String(selected));
    });
    if(appearanceStatus)appearanceStatus.textContent=active+" applied.";
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=effectiveAppearance()==="light"?"#f7f4f8":"#160d1c";
  }
  const closeAppearance=()=>{if(appearanceDialog)appearanceDialog.hidden=true;document.body.classList.remove("traits-dialog-open");};
  appearanceOpen?.addEventListener("click",()=>{applyAppearance(currentAppearance());appearanceDialog.hidden=false;document.body.classList.add("traits-dialog-open");byId("settings-close-appearance")?.focus();});
  byId("settings-close-appearance")?.addEventListener("click",closeAppearance);
  appearanceDialog?.addEventListener("click",event=>{if(event.target===appearanceDialog)closeAppearance();});
  appearanceDialog?.querySelectorAll("[data-appearance]").forEach(button=>button.addEventListener("click",()=>{applyAppearance(button.dataset.appearance);closeAppearance();}));
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&appearanceDialog&&!appearanceDialog.hidden)closeAppearance();});
  applyAppearance(currentAppearance());
  if(window.matchMedia){
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if(currentAppearance()==="system"){applyAppearance("system");}});
  }
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
  const traitDialog=byId("settings-traits-dialog"), traitOpen=byId("settings-open-traits");
  const closeTraitDialog=()=>{if(traitDialog)traitDialog.hidden=true;document.body.classList.remove("traits-dialog-open");};
  const openTraitDialog=()=>{if(traitDialog){traitDialog.hidden=false;document.body.classList.add("traits-dialog-open");byId("settings-close-traits")?.focus();}};
  traitOpen?.addEventListener("click",openTraitDialog);
  byId("settings-close-traits")?.addEventListener("click",closeTraitDialog);
  byId("settings-cancel-traits")?.addEventListener("click",closeTraitDialog);
  traitDialog?.addEventListener("click",event=>{if(event.target===traitDialog)closeTraitDialog();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&traitDialog&&!traitDialog.hidden)closeTraitDialog();});
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
    try{const public_traits={};Object.entries(traitOptions).forEach(([category,options])=>{const values=Array.from(traitFields.querySelectorAll('[name="trait-'+category+'"]:checked')).map(el=>el.value).filter(v=>options.includes(v));if(values.length)public_traits[category]=category==="zodiac"||category==="gender"?values[0]:values.slice(0,8);});const {error}=await supabase.from("profiles").update({public_traits}).eq("id",user.id);if(error)throw error;traitStatus.textContent="Your public traits are saved.";closeTraitDialog();}
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