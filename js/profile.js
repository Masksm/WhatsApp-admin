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
    setText("following-count", Number(summary.following || 0).toLocaleString());
  }

  const traitOptions = {
    hobbies: ["Reading", "Gaming", "Music", "Cooking", "Writing", "Photography", "Drawing", "Sports", "Gardening", "Travel"],
    skills: ["Coding", "Design", "Problem solving", "Storytelling", "Teaching", "Making things", "Research"],
    interests: ["Science", "Art", "Technology", "History", "Nature", "Psychology", "Space", "Fashion", "Books", "Movies"],
    vibe: ["Adventure", "Indoor activities", "Outdoor activities", "Quiet moments", "Social butterfly", "Trying new things", "Routine and comfort"],
    likes: ["Cats", "Dogs", "Coffee", "Tea", "Rainy days", "Sunsets", "Deep conversations", "Comedy", "Learning"],
    dislikes: ["Loud places", "Crowds", "Spoilers", "Early mornings", "Spicy food", "Small talk"],
    zodiac: ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"],
    gender: ["Woman", "Man", "Non-binary", "Prefer not to say"]
  };
  const traitLabels = {
    hobbies: "Hobbies", skills: "Skills", interests: "Interested in",
    vibe: "Your kind of vibe", likes: "Likes", dislikes: "Dislikes",
    zodiac: "Zodiac sign (optional)", gender: "Gender (optional)"
  };

  function renderTraits(traits, isOwner) {
    const display = byId("profile-traits-display");
    if (!display) return;
    display.replaceChildren();
    const selected = traits && typeof traits === "object" ? traits : {};
    let count = 0;
    Object.entries(traitOptions).forEach(([category, options]) => {
      const raw = selected[category];
      const chosen = Array.isArray(raw) ? raw.filter((value) => options.includes(value))
        : (typeof raw === "string" && options.includes(raw) ? [raw] : []);
      if (chosen.length) {
        const group = node("div", "public-trait-group");
        group.append(node("h3", "", traitLabels[category]));
        const chips = node("div", "public-trait-chips");
        chosen.forEach((value) => chips.append(node("span", "public-trait-chip", value)));
        group.append(chips);
        display.append(group);
        count += chosen.length;
      }

    });
    if (!count) display.append(node("p", "profile-empty", isOwner ? "Choose any traits you want to share. Leaving everything blank is fine." : "This person has not shared any profile traits."));
  }

  function setAnonymousLinkStatus(message, isError = false) {
    const statusNode = byId("profile-anonymous-link-status");
    if (!statusNode) return;
    statusNode.textContent = message || ""; statusNode.classList.toggle("is-error", isError);
  }
  function showProfileAnonymousLink(slug) {
    const result = byId("profile-anonymous-link-result"); const input = byId("profile-anonymous-link-url");
    if (!result || !input) return;
    input.value = window.location.origin + "/?anon=" + encodeURIComponent(slug); result.hidden = false;
  }
  async function loadProfileAnonymousLink() {
    if (!user || viewedProfile?.id !== currentUserId) return;
    try {
      const { data, error } = await supabase.from("anonymous_links").select("slug,is_active")
        .eq("owner_id", user.id).eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (data?.slug) { showProfileAnonymousLink(data.slug); setAnonymousLinkStatus("Your anonymous message link is ready."); }
      else setAnonymousLinkStatus("Create a link to receive anonymous messages.");
    } catch (error) { setAnonymousLinkStatus(error.message || "Could not load your anonymous link.", true); }
  }
  async function createProfileAnonymousLink() {
    if (!user || viewedProfile?.id !== currentUserId) return;
    const button = byId("profile-create-anonymous-link"); button.disabled = true;
    setAnonymousLinkStatus("Creating your anonymous link…");
    try {
      const { data: existing, error: lookupError } = await supabase.from("anonymous_links").select("slug,is_active")
        .eq("owner_id", user.id).eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (lookupError) throw lookupError;
      let slug = existing?.slug;
      if (!slug) {
        slug = "m-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const { data, error } = await supabase.from("anonymous_links").insert({ owner_id: user.id, slug, is_active: true }).select("slug").single();
        if (error) throw error; slug = data.slug;
      }
      showProfileAnonymousLink(slug); setAnonymousLinkStatus("Your anonymous message link is ready.");
    } catch (error) { setAnonymousLinkStatus(error.message || "Could not create your link.", true); }
    finally { button.disabled = false; }
  }
  async function copyProfileAnonymousLink() {
    const input = byId("profile-anonymous-link-url"); if (!input?.value) return;
    try { await navigator.clipboard.writeText(input.value); setAnonymousLinkStatus("Link copied."); }
    catch { input.focus(); input.select(); const copied = document.execCommand("copy"); setAnonymousLinkStatus(copied ? "Link copied." : "Copy the selected link manually.", !copied); }
  }
  async function deleteIdentifiedPost(postId, button, article) {
    if (!user || viewedProfile?.id !== currentUserId) return;
    if (!window.confirm("Delete this identified post? This cannot be undone.")) return;
    button.disabled = true;
    try {
      const { error } = await supabase.from("posts").delete().eq("id", postId).eq("author_id", user.id).eq("is_anonymous", false);
      if (error) throw error;
      article.remove();
      const summary = await loadPublicSummary(viewedProfile.username); setStats(summary);
      showStatus("Identified post deleted.");
      if (!postsContainer.querySelector(".profile-post")) renderEmptyPosts("You have no identified posts left.");
    } catch (error) { showStatus(error.message || "Could not delete this post.", true); button.disabled = false; }
  }
  function setProfileHeader(profile) {
    const username = profile.username || "Amora member";
    const isOwner = profile.id === currentUserId;
    const displayName = profile.display_name?.trim() || "Amora member";
    setText("profile-title", displayName);
    setText("profile-handle", "@" + username);
    setText("profile-avatar", displayName.slice(0, 1).toUpperCase());
    setText("sidebar-avatar", displayName.slice(0, 1).toUpperCase());
    setText("sidebar-username", "@" + username);
    setText("profile-page-title", isOwner ? "Your profile" : displayName);
    setText("profile-eyebrow", isOwner ? "YOUR AMORA SPACE" : "AMORA COMMUNITY");
    byId("profile-action-row").hidden = isOwner;
    byId("profile-private-note").hidden = isOwner;
    byId("profile-more-button")?.setAttribute("aria-expanded", "false");
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
      const metaRight = node("div", "profile-post-meta-actions");
      if (post.is_repost) metaRight.append(node("span", "profile-repost-label", "↻ Reposted"));
      metaRight.append(node("span", "profile-post-visibility", post.visibility === "followers" ? "Followers only" : "Public"));
      if (!post.is_repost && viewedProfile?.id === currentUserId) {
        const deleteButton = node("button", "profile-delete-post", "Delete");
        deleteButton.type = "button";
        deleteButton.addEventListener("click", () => deleteIdentifiedPost(post.id, deleteButton, article));
        metaRight.append(deleteButton);
      }
      meta.append(metaRight);
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
    byId("owner-tools").hidden = viewedProfile.id !== currentUserId;
    await loadProfileTraits(viewedProfile);
    if (viewedProfile.id === currentUserId) await loadProfileAnonymousLink();
    let postsQuery = supabase.from("posts")
      .select("id,author_id,content,media_urls,visibility,is_anonymous,created_at")
      .eq("author_id", viewedProfile.id).eq("is_anonymous", false)
      .order("created_at", { ascending: false }).limit(50);
    if (viewedProfile.id !== currentUserId) postsQuery = postsQuery.eq("visibility", "public");
    const { data: ownPosts, error: postsError } = await postsQuery;
    if (postsError) throw postsError;
    const combinedPosts = (ownPosts || []).map(post => ({ ...post, is_repost: false }));
    const { data: repostRows, error: repostError } = await supabase.from("post_reposts")
      .select("post_id,created_at").eq("user_id", viewedProfile.id)
      .order("created_at", { ascending: false }).limit(50);
    if (!repostError && repostRows?.length) {
      const ownIds = new Set(combinedPosts.map(post => post.id));
      const repostIds = repostRows.map(row => row.post_id).filter(id => !ownIds.has(id));
      if (repostIds.length) {
        let repostQuery = supabase.from("posts")
          .select("id,author_id,content,media_urls,visibility,is_anonymous,created_at")
          .in("id", repostIds).eq("is_anonymous", false);
        if (viewedProfile.id !== currentUserId) repostQuery = repostQuery.eq("visibility", "public");
        const { data: repostPosts, error: repostPostsError } = await repostQuery;
        if (!repostPostsError && repostPosts) {
          const byId = new Map(repostPosts.map(post => [post.id, post]));
          repostRows.forEach(row => {
            const post = byId.get(row.post_id);
            if (post) combinedPosts.push({ ...post, is_repost: true, reposted_at: row.created_at });
          });
        }
      }
    }
    combinedPosts.sort((a, b) => new Date(b.reposted_at || b.created_at) - new Date(a.reposted_at || a.created_at));
    await renderPosts(combinedPosts.slice(0, 50));
  }

  byId("profile-more-button")?.addEventListener("click", () => {
    const menu = byId("profile-more-menu");
    if (!menu) return;
    menu.hidden = !menu.hidden;
    byId("profile-more-button").setAttribute("aria-expanded", String(!menu.hidden));
  });
  document.addEventListener("click", event => {
    const wrap = document.querySelector(".profile-more-wrap");
    const menu = byId("profile-more-menu");
    if (wrap && menu && !wrap.contains(event.target)) {
      menu.hidden = true;
      byId("profile-more-button")?.setAttribute("aria-expanded", "false");
    }
  });
  byId("profile-follow-button")?.addEventListener("click", () => {
    showStatus("Following is not connected yet. The profile layout is ready for the follow feature.");
  });
  byId("profile-report-button")?.addEventListener("click", () => {
    showStatus("Account reporting is not connected yet.");
    byId("profile-more-menu").hidden = true;
  });
  byId("profile-block-button")?.addEventListener("click", () => {
    showStatus("Account blocking is not connected yet.");
    byId("profile-more-menu").hidden = true;
  });

  byId("profile-create-anonymous-link")?.addEventListener("click", createProfileAnonymousLink);
  byId("profile-copy-anonymous-link")?.addEventListener("click", copyProfileAnonymousLink);



  settingsButton?.addEventListener("click", (event) => {
    // Settings is now a dedicated page, not an expandable profile panel.
    if (settingsButton.tagName !== "A") event.preventDefault();
    window.location.href = "/pages/settings.html";
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