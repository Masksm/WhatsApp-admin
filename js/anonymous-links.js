
import {
  $,
  supabase,
  setStatus
} from "./core.js";

// ============================================================
// AMORA ANONYMOUS LINKS
// ============================================================

function setLinkStatus(message, isError = false) {
  setStatus($("#anonymous-link-status"), message, isError);
}

function displayAnonymousLink(slug) {
  const result = $("#anonymous-link-result");
  const urlElement = $("#anonymous-link-url");

  if (!slug || typeof slug !== "string") {
    setLinkStatus("Your anonymous link is unavailable.", true);
    return;
  }

  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/[^/]*$/, "/");
  url.searchParams.set("anon", slug);

  if (urlElement) {
    urlElement.textContent = url.toString();
    urlElement.href = url.toString();
  }

  if (result) {
    result.hidden = false;
  }
}

async function loadAnonymousLink() {
  if (!supabase) return;

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    setLinkStatus("Unable to check your account. Please try again.", true);
    return;
  }

  if (!sessionData.session?.user) return;

  const { data, error } = await supabase
    .from("anonymous_links")
    .select("slug")
    .eq("user_id", sessionData.session.user.id)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Unable to load anonymous link:", error.message);
    setLinkStatus("Unable to load your anonymous link.", true);
    return;
  }

  if (data?.slug) {
    displayAnonymousLink(data.slug);
  }
}

async function createAnonymousLink() {
  if (!supabase) {
    setLinkStatus("Unable to connect. Please try again later.", true);
    return;
  }

  const createButton = $("#create-anonymous-link");
  if (createButton) createButton.disabled = true;

  setLinkStatus("Preparing your link…");

  try {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) throw sessionError;

    const user = sessionData.session?.user;

    if (!user) {
      setLinkStatus("Log in before creating your anonymous link.", true);
      return;
    }

    // Reuse the existing link instead of creating duplicates.
    const { data: existing, error: lookupError } = await supabase
      .from("anonymous_links")
      .select("slug")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing?.slug) {
      displayAnonymousLink(existing.slug);
      setLinkStatus("Your existing anonymous link is ready.");
      return;
    }

    // Generate an unpredictable slug in the browser.
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);

    const slug = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");

    const { data, error } = await supabase
      .from("anonymous_links")
      .insert({
        user_id: user.id,
        slug
      })
      .select("slug")
      .single();

    if (error) throw error;

    displayAnonymousLink(data.slug);
    setLinkStatus("Your anonymous link is ready to share.");
  } catch (error) {
    console.error("Unable to create anonymous link:", error.message);

    setLinkStatus(
      error.message?.includes("duplicate")
        ? "A link may already exist. Try refreshing the page."
        : "Unable to create your link. Please try again.",
      true
    );
  } finally {
    if (createButton) createButton.disabled = false;
  }
}

async function copyAnonymousLink() {
  const urlElement = $("#anonymous-link-url");
  const url = urlElement?.href || urlElement?.textContent || "";

  if (!url || url === window.location.href) {
    setLinkStatus("Create or load your link first.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    setLinkStatus("Link copied. Share it with your friends.");
  } catch (_) {
    setLinkStatus("Copy failed. Select and copy the link manually.", true);
  }
}

function initAnonymousLinks() {
  $("#create-anonymous-link")?.addEventListener(
    "click",
    createAnonymousLink
  );

  $("#copy-anonymous-link")?.addEventListener(
    "click",
    copyAnonymousLink
  );

  // Load the existing link when a signed-in user opens the dashboard.
  loadAnonymousLink();

  supabase?.auth.onAuthStateChange((event, session) => {
    if (session?.user && event !== "TOKEN_REFRESHED") {
      loadAnonymousLink();
    }
  });
}

export {
  initAnonymousLinks,
  loadAnonymousLink,
  createAnonymousLink,
  copyAnonymousLink,
  displayAnonymousLink
};
