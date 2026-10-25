
import { $, supabase, setStatus } from "./core.js";

let currentUser = null;
let initialized = false;

function displayAnonymousLink(slug) {
  const result = $("#anonymous-link-result");
  const urlInput = $("#anonymous-link-url");

  if (!result || !urlInput) return;

  // Public links always open the dedicated sender page, not whichever
  // dashboard screen happened to generate the link.
  const link = new URL("/pages/anonymous-message.html", window.location.origin);
  link.searchParams.set("anon", slug);

  urlInput.value = link.toString();
  result.hidden = false;
}

async function loadAnonymousLink(user) {
  const createButton = $("#create-anonymous-link");
  const status = $("#anonymous-link-status");

  if (!user || !supabase || !createButton) return;

  currentUser = user;
  createButton.disabled = true;

  try {
    const { data, error } = await supabase
      .from("anonymous_links")
      .select("slug, is_active")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (data?.is_active && data.slug) {
      displayAnonymousLink(data.slug);
      setStatus(status, "Your anonymous link is ready.");
    } else {
      const result = $("#anonymous-link-result");
      if (result) result.hidden = true;
      setStatus(status, "Create your personal anonymous message link.");
    }
  } catch (error) {
    setStatus(
      status,
      error.message || "Could not load your anonymous link.",
      true
    );
  } finally {
    createButton.disabled = !currentUser;
  }
}

async function createAnonymousLink() {
  const button = $("#create-anonymous-link");
  const status = $("#anonymous-link-status");

  if (!supabase || !currentUser || !button) {
    setStatus(status, "Please sign in before creating your link.", true);
    return;
  }

  button.disabled = true;
  setStatus(status, "Checking your anonymous link...");

  try {
    const { data: existing, error: lookupError } = await supabase
      .from("anonymous_links")
      .select("slug, is_active")
      .eq("owner_id", currentUser.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing?.slug) {
      displayAnonymousLink(existing.slug);
      setStatus(status, "Your existing anonymous link is ready.");
      return;
    }

    const slug =
      "m-" +
      crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    const { data, error } = await supabase
      .from("anonymous_links")
      .insert({
        owner_id: currentUser.id,
        slug,
        is_active: true
      })
      .select("slug")
      .single();

    if (error) throw error;

    displayAnonymousLink(data.slug);
    setStatus(status, "Your anonymous link has been created.");
  } catch (error) {
    setStatus(
      status,
      error.message || "Could not create your anonymous link.",
      true
    );
  } finally {
    button.disabled = !currentUser;
  }
}

async function copyAnonymousLink() {
  const input = $("#anonymous-link-url");
  const status = $("#anonymous-link-status");

  if (!input?.value) {
    setStatus(status, "Create your link first.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(input.value);
    setStatus(status, "Link copied successfully.");
  } catch {
    input.focus();
    input.select();

    const copied = document.execCommand("copy");

    setStatus(
      status,
      copied
        ? "Link copied successfully."
        : "Copy the selected link manually.",
      !copied
    );
  }
}

function initAnonymousLinks() {
  if (initialized) return;
  initialized = true;

  $("#create-anonymous-link")?.addEventListener(
    "click",
    createAnonymousLink
  );

  $("#copy-anonymous-link")?.addEventListener(
    "click",
    copyAnonymousLink
  );

  if (!supabase) return;

  supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      setStatus(
        $("#anonymous-link-status"),
        error.message,
        true
      );
      return;
    }

    currentUser = data.session?.user || null;

    if (currentUser) {
      loadAnonymousLink(currentUser);
    }
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;

    if (currentUser) {
      loadAnonymousLink(currentUser);
    } else {
      const result = $("#anonymous-link-result");
      if (result) result.hidden = true;

      const button = $("#create-anonymous-link");
      if (button) button.disabled = true;

      setStatus(
        $("#anonymous-link-status"),
        "Sign in to manage your anonymous link."
      );
    }
  });
}

export {
  initAnonymousLinks,
  loadAnonymousLink
};
