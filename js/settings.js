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
  byId("settings-logout").addEventListener("click", async () => {
    const button = byId("settings-logout"); button.disabled = true; button.textContent = "Logging out…";
    const { error } = await supabase.auth.signOut();
    if (error) { button.disabled = false; button.textContent = "Log out ↗"; status(error.message || "Could not log out.", true); return; }
    window.location.replace("/?auth=login");
  });
});