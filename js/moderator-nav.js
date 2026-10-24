"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const links = document.querySelectorAll("[data-moderator-nav]");
  if (!links.length) return;

  const supabase = window.amoraSupabase;
  if (!supabase) return;

  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session) return;

    const { data: tier, error } = await supabase.rpc("amora_moderator_tier");
    if (error || Number(tier || 0) < 2) return;

    links.forEach(link => {
      link.hidden = false;
      link.setAttribute("aria-hidden", "false");
    });
  } catch (error) {
    // Fail closed: keep the moderator navigation hidden if verification fails.
    console.warn("Moderator navigation could not be verified.");
  }
});
