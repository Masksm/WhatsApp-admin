"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const supabase = window.amoraSupabase || null;
  const byId = (id) => document.getElementById(id);
  const form = byId("profile-form");
  const usernameInput = byId("profile-username");
  const status = byId("profile-status");
  const saveButton = byId("save-profile");
  const postsContainer = byId("profile-posts");
  const settingsButton = byId("profile-settings-button");
  const settingsSection = byId("identity-settings");
  const targetUsername = new URLSearchParams(window.location.search).get("username");
  let user = null;
  let viewedProfile = null;
  let originalUsername = "";
  let currentUserId = null;

  function showStatus(message, isError = false) {
    if (!status) return;
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
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function renderEmptyPosts(message = "No identified posts yet.") {
    postsContainer.replaceChildren();
    const empty = node("div", "profile-empty");
    const title = node("strong", "", "Nothing here yet");
    const copy = node("span", "", message);
    empty.append(title, copy);
    if (viewedProfile?.id === currentUserId) {
      const link = node("a", "", "Share your first thought ↗");
      link.href = "/pages/social-home.html";
      empty.append(document.createElement("br"), link);
    }
    postsContainer.append(empty);
  }
  function setStats(summary) {
    setText("post-count", Number(summary.identified_posts || 0).toLocaleString());
    setText("follower-count", Number(summary.followers || 0).toLocaleString());
    setText("likes-count", Number(summary.likes || 0).toLocaleString());
  }
  function setProfileHeader(profile) {
    const username = profile.username || "Amora member";
    const isOwner = profile.id === currentUserId;
    setText("profile-title", "@" + username);
    setText("profile-handle", "@" + username);
    setText("profile-avatar", username.slice(0, 1).toUpperCase());
    setText("sidebar-avatar", username.slice(0, 1).toUpperCase());
    setText("sidebar-username", "@" + username);
    setText("profile-page-title", isOwner ? "Your profile ♡" : "@" + username);
    setText("profile-eyebrow", isOwner ? "YOUR AMORA SPACE" : "AMORA COMMUNITY");
    setText("profile-kicker", isOwner ? "YOUR AMORA IDENTITY" : "PUBLIC PROFILE");
    setText("posts-section-title", isOwner ? "Your posts" : "Posts");
    setText("posts-section-description", isOwner
      ? "Your identified posts appear here. Anonymous posts stay separate."
      : "Identified posts shared by this account. Private account details are not shown.");
    setText("profile-private-note", isOwner
      ? "🔒 Your email and account details are private."
      : "♡ Public profile. Private account details are not shown.");
    byId("profile-private-note").firstChild.textContent = isOwner ? "🔒 " : "♡ ";
    byId("profile-form").hidden = !isOwner;
    settingsButton.hidden = !isOwner;
    byId("identity-settings").hidden = !isOwner || !settingsSection.dataset.open;
    byId("write-post-link").hidden = !isOwner;
    byId("sidebar-profile-link").href = "/pages/profile.html?username=" + encodeURIComponent(username);
    document.title = "@" + username + " · Amora";
  }

  async function getCurrentUser() {
    if (!supabase) throw new Error("Amora could not connect to its account service. Refresh the page.");
    const { data, error } = await supabase.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError") console.warn("Could not check current session.");
    user = data?.user || null;
    currentUserId = user?.id || null;
  }

  async function loadPublicSummary(username) {
    const { data, error } = await supabase.rpc("get_public_profile_summary", { p_username: username });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  }

  function requireSignedIn() {
    if (!user) {
      showStatus("Log in to like, comment, or repost.");
      return false;
    }
    return true;
  }

  async function toggleLike(postId, button, countNode) {
    if (!requireSignedIn()) return;
    button.disabled = true;
    try {
      const { data: existing, error: readError } = await supabase.from("post_likes")
        .select("post_id").eq("post_id", postId).eq("user_id", user.id).maybeSingle();
      if (readError) throw readError;
      if (existing) {
        const { error } = await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", user.id);
        if (error) throw error;
        button.textContent = "♡ Like";
      } else {
        const { error } = await supabase.from("post_likes").insert({ post_id: postId, user_id: user.id });
        if (error) throw error;
        button.textContent = "♥ Liked";
      }
      const { count, error: countError } = await supabase.from("post_likes").select("post_id", { count: "exact", head: true }).eq("post_id", postId);
      if (!countError) countNode.textContent = (count || 0) + ((count || 0) === 1 ? " like" : " likes");
      const summary = await loadPublicSummary(viewedProfile.username);
      setStats(summary);
    } catch (error) {
      showStatus(error.message || "Could not update your like.", true);
    } finally {
      button.disabled = false;
    }
  }

  async function addComment(postId, input, sendButton, commentsList) {
    if (!requireSignedIn()) return;
    const content = input.value.trim();
    if (!content) return;
    sendButton.disabled = true;
    try {
      const { error } = await supabase.from("post_comments").insert({
        post_id: postId, parent_comment_id: null, author_id: user.id,
        is_anonymous: false, content
      });
      if (error) throw error;
      input.value = "";
      const comment = node("p", "profile-comment", "You: " + content);
      commentsList.append(comment);
      showStatus("Comment added.");
    } catch (error) {
      showStatus(error.message || "Could not add your comment.", true);
    } finally {
      sendButton.disabled = false;
    }
  }

  async function toggleRepost(postId, button) {
    if (!requireSignedIn()) return;
    button.disabled = true;
    try {
      const { data: existing, error: readError } = await supabase.from("post_reposts")
        .select("post_id").eq("post_id", postId).eq("user_id", user.id).maybeSingle();
      if (readError) throw readError;
      if (existing) {
        const { error } = await supabase.from("post_reposts").delete().eq("post_id", postId).eq("user_id", user.id);
        if (error) throw error;
        button.textContent = "⟳ Repost";
      } else {
        const { error } = await supabase.from("post_reposts").insert({ post_id: postId, user_id: user.id });
        if (error) throw error;
        button.textContent = "↻ Reposted";
      }
      showStatus("Post activity updated.");
    } catch (error) {
      showStatus(error.message || "Could not repost this post.", true);
    } finally {
      button.disabled = false;
    }
  }

  async function renderPosts(rows) {
    postsContainer.replaceChildren();
    if (!rows.length) { renderEmptyPosts(); return; }
    for (const post of rows) {
      const article = node("article", "profile-post profile-post-card");
      const meta = node("div", "profile-post-meta");
      meta.append(node("span", "", relativeTime(post.created_at)));
      meta.append(node("span", "profile-post-visibility", post.visibility === "followers" ? "Followers only" : "Public"));
      const content = node("p", "profile-post-content", post.content || "");
      article.append(meta, content);
      (post.media_urls || []).slice(0, 4).forEach((url) => {
        if (typeof url !== "string" || !/^https:\/\//i.test(url)) return;
        const image = node("img", "", undefined);
        image.src = url; image.alt = "Image attached to post"; image.loading = "lazy";
        article.append(image);
      });
      const { data: postCounts, error: countsError } = await supabase.rpc("get_post_interaction_counts", { p_post_ids: [post.id] });
      const postCount = !countsError && Array.isArray(postCounts) ? postCounts.find((row) => row.post_id === post.id) : null;
      const likeCount = Number(postCount?.likes_count || 0);
      const stats = node("div", "profile-post-stats");
      const likesText = node("span", "", (likeCount || 0) + ((likeCount || 0) === 1 ? " like" : " likes"));
      const commentsResult = await supabase.from("post_comments")
        .select("id,author_id,content,is_anonymous,created_at").eq("post_id", post.id)
        .order("created_at", { ascending: true }).limit(30);
      const commentsList = node("div", "profile-comments");
      if (!commentsResult.error) {
        commentsResult.data.forEach((comment) => {
          commentsList.append(node("p", "profile-comment",
            (comment.is_anonymous ? "Anonymous" : (comment.author_id === user?.id ? "You" : "Amora member")) + ": " + comment.content));
        });
      }
      stats.append(likesText);
      const actions = node("div", "profile-post-actions");
      let liked = false;
      if (user) {
        const { data: ownLike } = await supabase.from("post_likes").select("post_id")
          .eq("post_id", post.id).eq("user_id", user.id).maybeSingle();
        liked = Boolean(ownLike);
      }
      const likeButton = node("button", "post-action", liked ? "♥ Liked" : "♡ Like");
      likeButton.type = "button";
      likeButton.addEventListener("click", () => toggleLike(post.id, likeButton, likesText));
      const replyButton = node("button", "post-action", "▢ Comment");
      replyButton.type = "button";
      replyButton.addEventListener("click", () => {
        if (!requireSignedIn()) return;
        const form = node("form", "profile-comment-form");
        const input = node("input", "", undefined);
        input.maxLength = 3000; input.placeholder = "Write a comment…"; input.setAttribute("aria-label", "Write a comment");
        const send = node("button", "", "Send"); send.type = "submit";
        form.append(input, send);
        form.addEventListener("submit", (event) => { event.preventDefault(); addComment(post.id, input, send, commentsList); });
        article.insertBefore(form, commentsList);
        input.focus();
      });
      const repostButton = node("button", "post-action", "⟳ Repost");
      repostButton.type = "button";
      if (user) {
        const { data: ownRepost } = await supabase.from("post_reposts").select("post_id")
          .eq("post_id", post.id).eq("user_id", user.id).maybeSingle();
        if (ownRepost) repostButton.textContent = "↻ Reposted";
      }
      repostButton.addEventListener("click", () => toggleRepost(post.id, repostButton));
      actions.append(likeButton, replyButton, repostButton);
      article.append(stats, actions, commentsList);
      postsContainer.append(article);
    }
  }

  async function loadProfile() {
    if (!supabase) throw new Error("Amora could not connect to its account service. Refresh the page.");
    await getCurrentUser();
    let summary;
    if (targetUsername) {
      summary = await loadPublicSummary(targetUsername);
      if (!summary) {
        setText("profile-title", "Profile not found");
        renderEmptyPosts("This username does not exist or is not public.");
        return;
      }
      viewedProfile = summary;
    } else if (user) {
      const { data: ownProfile, error } = await supabase.from("profiles")
        .select("id,username").eq("id", user.id).maybeSingle();
      if (error) throw error;
      if (!ownProfile?.username) {
        throw new Error("Set your username first to create your public profile.");
      }
      summary = await loadPublicSummary(ownProfile.username);
      viewedProfile = summary;
    } else {
      window.location.replace("/index.html?auth=login");
      return;
    }
    if (!viewedProfile) throw new Error("This profile could not be found.");
    originalUsername = viewedProfile.username || "";
    if (usernameInput) usernameInput.value = originalUsername;
    setProfileHeader(viewedProfile);
    setStats(viewedProfile);

    const { data: posts, error: postsError } = await supabase.from("posts")
      .select("id,author_id,content,media_urls,visibility,is_anonymous,created_at")
      .eq("author_id", viewedProfile.id).eq("is_anonymous", false)
      .order("created_at", { ascending: false }).limit(50);
    if (postsError) throw postsError;
    await renderPosts(posts || []);
  }

  settingsButton?.addEventListener("click", () => {
    if (viewedProfile?.id !== currentUserId) {
      showStatus("Settings are only available on your own profile.");
      return;
    }
    settingsSection.dataset.open = settingsSection.hidden ? "true" : "false";
    settingsSection.hidden = settingsSection.dataset.open !== "true";
    if (!settingsSection.hidden) settingsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = usernameInput.value.trim();
    if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) { showStatus("Use 3–30 letters, numbers, or underscores.", true); return; }
    if (username.toLowerCase() === originalUsername.toLowerCase()) { showStatus("Your username is already up to date."); return; }
    saveButton.disabled = true; showStatus("Saving your username…");
    try {
      const { data, error } = await supabase.from("profiles").update({ username, display_name: null })
        .eq("id", user.id).select("username").single();
      if (error) {
        if (error.code === "23505") throw new Error("That username is already taken. Try another one.");
        throw error;
      }
      originalUsername = data.username;
      viewedProfile.username = data.username;
      usernameInput.value = originalUsername;
      setProfileHeader(viewedProfile);
      window.history.replaceState({}, "", "/pages/profile.html?username=" + encodeURIComponent(originalUsername));
      showStatus("Username saved.");
    } catch (error) {
      showStatus(error.message || "Could not save your username. Please try again.", true);
    } finally { saveButton.disabled = false; }
  });

  loadProfile().catch((error) => {
    console.error("[Amora profile]", error?.message || error);
    if (postsContainer) {
      postsContainer.replaceChildren(node("p", "profile-empty", "We couldn't load this profile right now. Refresh the page and try again."));
    }
    showStatus(error.message || "Your profile could not be loaded. Refresh and try again.", true);
  });
});