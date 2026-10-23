"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const supabase = window.amoraSupabase || null;
  const byId = (id) => document.getElementById(id);
  const form = byId("profile-form");
  const usernameInput = byId("profile-username");
  const status = byId("profile-status");
  const saveButton = byId("save-profile");
  const postsContainer = byId("profile-posts");
  const logoutButtons = [byId("logout-button"), byId("logout-main")].filter(Boolean);

  let user = null;
  let originalUsername = "";

  function showStatus(message, isError = false) {
    status.textContent = message || "";
    status.classList.toggle("is-error", isError);
  }

  function setText(id, value) {
    const node = byId(id);
    if (node) node.textContent = value;
  }

  function relativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Recently";
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
    if (seconds < 604800) return Math.floor(seconds / 86400) + "d ago";
    return date.toLocaleDateString();
  }

  function renderEmptyPosts() {
    postsContainer.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "profile-empty";
    const title = document.createElement("strong");
    title.textContent = "Your story starts here";
    const copy = document.createElement("span");
    copy.textContent = "You have no identified posts yet. Anonymous posts do not appear in this list.";
    const link = document.createElement("a");
    link.href = "/pages/social-home.html";
    link.textContent = "Share your first thought ↗";
    empty.append(title, copy, document.createElement("br"), link);
    postsContainer.append(empty);
  }

  function renderPosts(rows) {
    postsContainer.replaceChildren();
    if (!rows.length) {
      renderEmptyPosts();
      return;
    }
    rows.forEach((post) => {
      const article = document.createElement("article");
      article.className = "profile-post";
      const meta = document.createElement("div");
      meta.className = "profile-post-meta";
      const date = document.createElement("span");
      date.textContent = relativeTime(post.created_at);
      const visibility = document.createElement("span");
      visibility.className = "profile-post-visibility";
      visibility.textContent = post.visibility === "followers" ? "Followers only" : "Public";
      meta.append(date, visibility);
      const content = document.createElement("p");
      content.className = "profile-post-content";
      content.textContent = post.content || "";
      article.append(meta, content);
      (post.media_urls || []).forEach((url) => {
        if (typeof url !== "string" || !/^https:\/\//i.test(url)) return;
        const image = document.createElement("img");
        image.src = url;
        image.alt = "Image attached to your post";
        image.loading = "lazy";
        article.append(image);
      });
      postsContainer.append(article);
    });
  }

  async function loadProfile() {
    if (!supabase) throw new Error("Amora could not connect to its account service. Refresh the page.");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      window.location.replace("/index.html?auth=login");
      return;
    }
    user = authData.user;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id,username,display_name,created_at")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    originalUsername = profile?.username || "";
    usernameInput.value = originalUsername;
    const shownName = originalUsername ? "@" + originalUsername : "Choose your username";
    setText("profile-title", shownName);
    setText("profile-handle", originalUsername ? "@" + originalUsername : "Your anonymous identity is not set yet");
    setText("profile-avatar", originalUsername ? originalUsername.slice(0, 1).toUpperCase() : "?");
    setText("sidebar-avatar", originalUsername ? originalUsername.slice(0, 1).toUpperCase() : "?");
    setText("sidebar-username", originalUsername ? "@" + originalUsername : "Your space");

    const [postsResult, followersResult, followingResult] = await Promise.all([
      supabase.from("posts").select("id,content,media_urls,visibility,created_at")
        .eq("author_id", user.id).eq("is_anonymous", false)
        .order("created_at", { ascending: false }).limit(30),
      supabase.from("user_follows").select("follower_id").eq("followed_id", user.id),
      supabase.from("user_follows").select("followed_id").eq("follower_id", user.id)
    ]);

    if (postsResult.error) throw postsResult.error;
    if (followersResult.error) throw followersResult.error;
    if (followingResult.error) throw followingResult.error;

    setText("post-count", postsResult.data.length);
    setText("follower-count", followersResult.data.length);
    setText("following-count", followingResult.data.length);
    renderPosts(postsResult.data);
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = usernameInput.value.trim();
    if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
      showStatus("Use 3–30 letters, numbers, or underscores.", true);
      return;
    }
    if (username === originalUsername) {
      showStatus("Your username is already up to date.");
      return;
    }
    saveButton.disabled = true;
    showStatus("Saving your username…");
    try {
      const { data, error } = await supabase.from("profiles")
        .update({ username, display_name: null })
        .eq("id", user.id)
        .select("username")
        .single();
      if (error) {
        if (error.code === "23505") throw new Error("That username is already taken. Try another one.");
        if (error.code === "42501") throw new Error("Your account is not allowed to update this profile.");
        throw error;
      }
      originalUsername = data.username;
      usernameInput.value = originalUsername;
      setText("profile-title", "@" + originalUsername);
      setText("profile-handle", "@" + originalUsername);
      setText("profile-avatar", originalUsername.slice(0, 1).toUpperCase());
      setText("sidebar-avatar", originalUsername.slice(0, 1).toUpperCase());
      setText("sidebar-username", "@" + originalUsername);
      showStatus("Username saved.");
    } catch (error) {
      showStatus(error.message || "Could not save your username. Please try again.", true);
    } finally {
      saveButton.disabled = false;
    }
  });

  async function logout() {
    if (!supabase) return;
    logoutButtons.forEach((button) => { button.disabled = true; });
    const { error } = await supabase.auth.signOut();
    if (error) {
      showStatus("Could not sign out. Please try again.", true);
      logoutButtons.forEach((button) => { button.disabled = false; });
      return;
    }
    window.location.replace("/index.html?auth=login");
  }
  logoutButtons.forEach((button) => button.addEventListener("click", logout));

  loadProfile().catch((error) => {
    console.error("[Amora profile]", error?.message || error);
    if (postsContainer) {
      postsContainer.replaceChildren();
      const message = document.createElement("p");
      message.className = "profile-empty";
      message.textContent = "We couldn't load your profile right now. Refresh the page and try again.";
      postsContainer.append(message);
    }
    showStatus("Your profile could not be loaded. Refresh and try again.", true);
  });
});