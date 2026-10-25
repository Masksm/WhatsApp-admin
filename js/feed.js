"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const composer = document.getElementById("composer");
  const textInput = document.getElementById("post-text");
  const imageInput = document.getElementById("post-image");
  const imagePreview = document.getElementById("image-preview");
  const hideIdentity = document.getElementById("hide-identity");
  const forceAnonymousComments = document.getElementById("force-anonymous-comments");
  const publishButton = document.getElementById("publish-post");
  const composerStatus = document.getElementById("composer-status");
  const feedList = document.getElementById("feed-list");
  const feedTabs = [...document.querySelectorAll("[data-feed]")];
  const homeStateKey = "amora_home_navigation_state";
  const homeFeedCacheKey = "amora_home_feed_cache";
  const homeFeedCacheMaxAge = 5 * 60 * 1000;
  const saveHomeState = () => {
    try {
      sessionStorage.setItem(homeStateKey, JSON.stringify({
        scrollY: window.scrollY,
        activeFeed: activeFeed,
        savedAt: Date.now()
      }));
    } catch (_) {}
  };
  // Keep the current feed view when navigating away and back in this tab.
  document.querySelectorAll('a[href="/pages/social-home.html"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = new URL(link.href, window.location.href);
      if (target.pathname === window.location.pathname && !target.search && !target.hash) {
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (target.pathname !== window.location.pathname) saveHomeState();
    });
  });
  window.addEventListener("pagehide", saveHomeState);
  const restoreHomeState = () => {
    try {
      const raw = sessionStorage.getItem(homeStateKey);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (!state || Date.now() - state.savedAt > 30 * 60 * 1000) {
        sessionStorage.removeItem(homeStateKey);
        return;
      }
      if (state.activeFeed && feedTabs.some(tab => tab.dataset.feed === state.activeFeed)) {
        activeFeed = state.activeFeed;
        feedTabs.forEach(tab => {
          const selected = tab.dataset.feed === activeFeed;
          tab.classList.toggle("active", selected);
          tab.setAttribute("aria-selected", String(selected));
        });
      }
      requestAnimationFrame(() => window.scrollTo({ top: Number(state.scrollY) || 0, behavior: "instant" }));
    } catch (_) {}
  };

  const supabase = window.amoraSupabase || null;

  if (!composer || !textInput || !feedList || !publishButton) {
    console.error("[Amora] Home initialization stopped: required feed elements are missing.", {
      composer: !!composer, textInput: !!textInput, feedList: !!feedList, publishButton: !!publishButton
    });
    if (feedList) {
      feedList.replaceChildren();
      const message = document.createElement("p");
      message.className = "feed-empty card";
      message.textContent = "The feed could not start. Refresh the page; if this continues, the page scripts are out of sync.";
      feedList.append(message);
    }
    return;
  }

  let selectedImage = null;
  let activeFeed = "for-you";
  let feedSearchQuery = "";
  let currentUser = null;
  let loading = false;
  let posts = [];
  let restoredFeedCache = null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(homeFeedCacheKey) || "null");
    if (cached && Array.isArray(cached.posts) && Date.now() - cached.savedAt < homeFeedCacheMaxAge) {
      restoredFeedCache = cached;
      posts = cached.posts;
      activeFeed = cached.activeFeed || "for-you";
      feedTabs.forEach(tab => {
        const selected = tab.dataset.feed === activeFeed;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", String(selected));
      });
    } else {
      sessionStorage.removeItem(homeFeedCacheKey);
    }
  } catch (_) {}
  const saveHomeFeedCache = () => {
    try {
      sessionStorage.setItem(homeFeedCacheKey, JSON.stringify({
        posts,
        activeFeed,
        savedAt: Date.now()
      }));
    } catch (_) {}
  };
  const commentCache = new Map();
  const profileCache = new Map();
  const interactionCounts = new Map();
  const likeCache = new Set();
  const bookmarkCache = new Set();
  const repostCache = new Set();
  const hiddenTokenStorageKey = "amora_hidden_post_delete_tokens";

  const composerDialog = document.getElementById("composer-dialog");
  const quickComposer = document.querySelector(".feed-quick-composer");
  const closeComposer = () => {
    if (!composerDialog) return;
    composerDialog.classList.remove("is-expanded");
    if (quickComposer) quickComposer.setAttribute("aria-expanded", "false");
    window.setTimeout(() => { composerDialog.hidden = true; }, 260);
  };
  document.querySelectorAll("[data-focus-composer]").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      if (!composerDialog) return;
      composerDialog.hidden = false;
      requestAnimationFrame(() => composerDialog.classList.add("is-expanded"));
      button.setAttribute("aria-expanded", "true");
      window.setTimeout(() => textInput.focus(), 180);
    });
  });
  document.getElementById("composer-close")?.addEventListener("click", closeComposer);

  function setStatus(message, isError = false) {
    composerStatus.textContent = message || "";
    composerStatus.style.color = isError ? "#ff9aaa" : "";
  }

  function errorDetails(error) {
    const rawMessage = String(error?.message || error || "Unknown error");
    const message = rawMessage
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/https?:\/\/\S+/gi, "[url]")
      .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted-token]")
      .slice(0, 500);
    return {
      code: String(error?.code || error?.name || "CLIENT_ERROR").slice(0, 80),
      message
    };
  }

  async function logClientError(context, error) {
    const details = errorDetails(error);
    console.error("[Amora]", context, details.code, details.message);
    if (!supabase) return;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data?.session) return;
      await supabase.rpc("log_client_error", {
        p_error_code: details.code,
        p_context: context,
        p_message: details.message
      });
    } catch (loggingError) {
      console.error("[Amora] Error logger unavailable:", loggingError?.message || "unknown");
    }
  }

  window.addEventListener("unhandledrejection", (event) => {
    logClientError("unhandled_rejection", event.reason);
  });
  window.addEventListener("error", (event) => {
    logClientError("window_error", event.error || event.message);
  });

  function updatePublishButton() {
    publishButton.disabled = loading || (!textInput.value.trim() && !selectedImage);
  }
  textInput.addEventListener("input", updatePublishButton);

  imageInput?.addEventListener("change", () => {
    const file = imageInput.files?.[0] || null;
    imagePreview?.replaceChildren();
    if (!file) {
      selectedImage = null;
      if (imagePreview) imagePreview.hidden = true;
      updatePublishButton();
      return;
    }
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      selectedImage = null;
      imageInput.value = "";
      if (imagePreview) imagePreview.hidden = true;
      setStatus("Choose a JPG, PNG, WebP, or GIF image.", true);
      updatePublishButton();
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      selectedImage = null;
      imageInput.value = "";
      if (imagePreview) imagePreview.hidden = true;
      setStatus("Images must be 8 MB or smaller.", true);
      updatePublishButton();
      return;
    }
    selectedImage = file;
    if (imagePreview) {
      imagePreview.hidden = false;
      const img = document.createElement("img");
      img.alt = "Selected image preview";
      img.src = URL.createObjectURL(file);
      img.onload = () => URL.revokeObjectURL(img.src);
      imagePreview.append(img);
    }
    setStatus("");
    updatePublishButton();
  });

  function readHiddenTokens() {
    try {
      const value = JSON.parse(localStorage.getItem(hiddenTokenStorageKey) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function saveHiddenToken(postId, token, ownerId) {
    const tokens = readHiddenTokens();
    tokens[postId] = { token, ownerId };
    try { localStorage.setItem(hiddenTokenStorageKey, JSON.stringify(tokens)); } catch {}
  }

  function getOwnedHiddenToken(postId) {
    const record = readHiddenTokens()[postId];
    if (!record || typeof record !== "object" || typeof record.token !== "string") return null;
    if (!currentUser || record.ownerId !== currentUser.id) return null;
    return record.token;
  }

  function randomDeletionToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function makeButton(label, className, action, active = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className + (active ? " is-active" : "");
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function closeAllPostMoreMenus() {
    document.querySelectorAll(".post-more-menu:not([hidden])").forEach((menu) => {
      menu.hidden = true;
      menu.closest(".post-actions")?.querySelector(".post-more-trigger")?.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".post-more-backdrop:not([hidden])").forEach((backdrop) => { backdrop.hidden = true; });
  }
  document.addEventListener("click", (event) => {
    const clickedMoreTrigger = event.target.closest(".post-more-trigger");
    if (!clickedMoreTrigger) closeAllPostMoreMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllPostMoreMenus();
  });

  function timeAgo(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Recently";
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
    if (seconds < 604800) return Math.floor(seconds / 86400) + "d ago";
    return date.toLocaleDateString();
  }

  async function requireUser() {
    if (!supabase) throw new Error("Supabase did not load. Refresh and try again.");
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    currentUser = data.user || null;
    if (!currentUser) throw new Error("Log in to use this feature.");
    return currentUser;
  }

  async function loadInteractionCounts() {
    interactionCounts.clear();
    if (!supabase || !posts.length) return;
    const ids = posts.map((post) => post.id).slice(0, 50);
    const { data, error } = await supabase.rpc("get_post_interaction_counts", { p_post_ids: ids });
    if (error) {
      await logClientError("load_interaction_counts", error);
      return;
    }
    (data || []).forEach((row) => interactionCounts.set(row.post_id, {
      likes: Number(row.likes_count || 0),
      reposts: Number(row.reposts_count || 0),
      comments: Number(row.comments_count || 0)
    }));
  }

  async function loadMyInteractions() {
    likeCache.clear();
    bookmarkCache.clear();
    repostCache.clear();
    if (!currentUser || !posts.length) return;
    const ids = posts.map((post) => post.id);
    const [likes, bookmarks, reposts] = await Promise.all([
      supabase.from("post_likes").select("post_id").eq("user_id", currentUser.id).in("post_id", ids),
      supabase.from("post_bookmarks").select("post_id").eq("user_id", currentUser.id).in("post_id", ids),
      supabase.from("post_reposts").select("post_id").eq("user_id", currentUser.id).in("post_id", ids)
    ]);
    if (!likes.error) likes.data.forEach((row) => likeCache.add(row.post_id));
    if (!bookmarks.error) bookmarks.data.forEach((row) => bookmarkCache.add(row.post_id));
    if (!reposts.error) reposts.data.forEach((row) => repostCache.add(row.post_id));
  }

  async function loadPublicProfiles(ids) {
    const missing = [...new Set((ids || []).filter((id) => typeof id === "string" && id && !profileCache.has(id)))].slice(0, 200);
    if (!missing.length || !supabase) return;
    const { data, error } = await supabase.rpc("get_public_profiles", { p_user_ids: missing });
    if (error) {
      console.warn("Public profile lookup failed:", error.message);
      missing.forEach((id) => profileCache.set(id, null));
      return;
    }
    (data || []).forEach((profile) => profileCache.set(profile.id, profile));
    missing.forEach((id) => {
      if (!profileCache.has(id)) profileCache.set(id, null);
    });
  }

  function profileLabel(userId) {
    if (!userId) return "Amora member";
    const profile = profileCache.get(userId);
    if (!profile) return userId === currentUser?.id ? "You" : "Amora member";
    if (profile.display_name?.trim()) return profile.display_name.trim();
    if (profile.username?.trim()) return "@" + profile.username.trim();
    return userId === currentUser?.id ? "You" : "Amora member";
  }

  async function loadComments(postId) {
    if (commentCache.has(postId)) return commentCache.get(postId);
    const { data, error } = await supabase
      .from("post_comments")
      .select("id,post_id,parent_comment_id,author_id,content,is_anonymous,created_at,edited_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const rows = data || [];
    await loadPublicProfiles(rows.filter((row) => row.author_id).map((row) => row.author_id));
    const ids = rows.map((row) => row.id);
    const countsById = new Map();
    if (ids.length) {
      const { data: counts } = await supabase.rpc("get_comment_interaction_counts", { p_comment_ids: ids });
      (counts || []).forEach((row) => countsById.set(row.comment_id, Number(row.likes_count || 0)));
    }
    const myLikes = new Set();
    if (currentUser && ids.length) {
      const { data: ownLikes } = await supabase.from("comment_likes")
        .select("comment_id").eq("user_id", currentUser.id).in("comment_id", ids);
      (ownLikes || []).forEach((row) => myLikes.add(row.comment_id));
    }
    const byId = new Map();
    rows.forEach((row) => byId.set(row.id, {
      ...row, author: row.is_anonymous ? "Anonymous" : profileLabel(row.author_id),
      like_count: countsById.get(row.id) || 0, liked_by_me: myLikes.has(row.id), replies: []
    }));
    const roots = [];
    rows.forEach((row) => {
      const item = byId.get(row.id);
      const parent = row.parent_comment_id ? byId.get(row.parent_comment_id) : null;
      if (parent) { item.parent_comment = parent; parent.replies.push(item); }
      else roots.push(item);
    });
    commentCache.set(postId, roots);
    return roots;
  }

  async function addComment(post, parentId, input, form) {
    const value = input.value.trim();
    if (!value) return;
    try {
      const user = await requireUser();
      form.querySelector("button[type=submit]").disabled = true;
      const anonymousChoice = form.querySelector("[name=comment-anonymous]");
      const isAnonymous = Boolean(post.is_anonymous || post.force_anonymous_comments || anonymousChoice?.checked);
      const payload = {
        post_id: post.id,
        parent_comment_id: parentId || null,
        author_id: isAnonymous ? null : user.id,
        is_anonymous: isAnonymous,
        content: value
      };
      const { error } = await supabase.from("post_comments").insert(payload);
      if (error) throw error;
      input.value = "";
      commentCache.delete(post.id);
      const comments = await loadComments(post.id);
      const article = feedList.querySelector('[data-post-id="' + post.id + '"]');
      if (article) {
        const countLabel = article.querySelector(".post-stats span:last-child");
        if (countLabel) countLabel.textContent = comments.length + (comments.length === 1 ? " comment" : " comments");
        const trigger = article.querySelector(".post-comments-trigger");
        if (trigger) trigger.textContent = "Comments · " + comments.length;
      }
      if (activeCommentsPost?.id === post.id) await refreshCommentsDialog();
    } catch (error) {
      await logClientError("submit_comment", error);
      setStatus("Couldn't post your reply. Please try again.", true);
    } finally {
      const button = form.querySelector("button[type=submit]");
      if (button) button.disabled = false;
    }
  }

  async function toggleCommentLike(comment, button, countLabel) {
    try {
      const user = await requireUser();
      const { data: existing, error: readError } = await supabase.from("comment_likes")
        .select("comment_id").eq("comment_id", comment.id).eq("user_id", user.id).maybeSingle();
      if (readError) throw readError;
      if (existing) {
        const { error } = await supabase.from("comment_likes").delete().eq("comment_id", comment.id).eq("user_id", user.id);
        if (error) throw error;
        comment.liked_by_me = false;
        comment.like_count = Math.max(0, Number(comment.like_count || 0) - 1);
      } else {
        const { error } = await supabase.from("comment_likes").insert({ comment_id: comment.id, user_id: user.id });
        if (error) throw error;
        comment.liked_by_me = true;
        comment.like_count = Number(comment.like_count || 0) + 1;
      }
      button.textContent = (comment.liked_by_me ? "♥ Liked" : "♡ Like") + " · " + comment.like_count;
      button.classList.toggle("is-active", comment.liked_by_me);
      countLabel.textContent = comment.like_count + (comment.like_count === 1 ? " like" : " likes");
    } catch (error) {
      await logClientError("toggle_comment_like", error);
      setStatus("Couldn't update the comment like. Please try again.", true);
    }
  }

  function formatCommentTimestamp(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return "now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h";
    if (seconds < 604800) return Math.floor(seconds / 86400) + "d";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function makeComment(comment, post, depth = 0) {
    const item = document.createElement("div");
    item.className = "comment-item";
    item.id = "comment-" + comment.id;
    item.dataset.commentId = comment.id;
    const body = document.createElement("div");
    body.className = "comment-body";
    const head = document.createElement("div");
    head.className = "comment-head";
    const author = document.createElement("strong");
    author.className = "comment-author-name";
    author.textContent = post.is_anonymous || comment.is_anonymous ? "Anonymous" : comment.author;
    const commentProfile = comment.author_id ? profileCache.get(comment.author_id) : null;
    if (!post.is_anonymous && !comment.is_anonymous && commentProfile?.is_official) {
      const badge = document.createElement("span");
      badge.className = "official-account-badge";
      badge.setAttribute("role", "img");
      badge.setAttribute("aria-label", "Verified official Amora account");
      badge.title = "Verified official Amora account";
      badge.style.cssText = "display:inline-flex!important;align-items:center!important;justify-content:center!important;width:18px!important;height:18px!important;min-width:18px!important;flex:0 0 18px!important;margin-left:6px!important;border-radius:50%!important;background:#1877f2!important;color:#ffffff!important;vertical-align:middle!important;overflow:hidden!important;box-sizing:border-box!important";
      badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="display:block!important;width:12px!important;height:12px!important;fill:#fff!important;color:#fff!important"><path d="M9.2 16.2 4.9 12l-1.8 1.8 6.1 6.1L21 8.1l-1.8-1.8z" fill="#ffffff"/></svg>';
      author.append(badge);
    }
    const timestamp = document.createElement("span");
    timestamp.className = "comment-timestamp";
    timestamp.textContent = formatCommentTimestamp(comment.created_at);
    timestamp.title = comment.created_at ? new Date(comment.created_at).toLocaleString() : "";
    head.append(author, timestamp);
    const text = document.createElement("p");
    text.textContent = comment.content;
    body.append(head);
    if (comment.parent_comment) {
      const quoted = document.createElement("div");
      quoted.className = "comment-reply-context";
      const quoteAuthor = document.createElement("strong");
      quoteAuthor.textContent = comment.parent_comment.is_anonymous || post.is_anonymous ? "Anonymous" : comment.parent_comment.author;
      const quoteText = document.createElement("span");
      quoteText.textContent = comment.parent_comment.content;
      quoted.append(quoteAuthor, quoteText);
      body.append(quoted);
    }
    body.append(text);
    if (comment.edited_at) {
      const edited = document.createElement("span");
      edited.className = "comment-edited-label";
      edited.textContent = "Edited";
      edited.title = "Edited " + new Date(comment.edited_at).toLocaleString();
      body.append(edited);
    }
    const actions = document.createElement("div");
    actions.className = "comment-actions";
    const countLabel = document.createElement("span");
    countLabel.className = "comment-like-count";
    countLabel.textContent = Number(comment.like_count || 0) + (Number(comment.like_count || 0) === 1 ? " like" : " likes");
    let likeButton;
    likeButton = makeButton((comment.liked_by_me ? "♥ Liked" : "♡ Like") + " · " + Number(comment.like_count || 0), "comment-action", () => toggleCommentLike(comment, likeButton, countLabel), comment.liked_by_me);
    const shareButton = makeButton("↗ Share", "comment-action", async () => {
      const shareUrl = window.location.origin + "/pages/social-home.html#comment-" + comment.id;
      try {
        if (navigator.share) await navigator.share({ title: "Amora comment", text: comment.content, url: shareUrl });
        else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(shareUrl); setStatus("Comment link copied."); }
        else setStatus(shareUrl);
      } catch (error) {
        if (error?.name !== "AbortError") setStatus("Couldn't share this comment.", true);
      }
    });
    actions.append(likeButton, countLabel, shareButton);
    if (currentUser && comment.author_id === currentUser.id && !comment.is_anonymous && !post.is_anonymous) {
      const editButton = makeButton("Edit", "comment-reply-button comment-owner-action", async () => {
        if (item.querySelector(":scope > .comment-edit-form")) return;
        const editForm = document.createElement("form");
        editForm.className = "comment-edit-form";
        const editInput = document.createElement("textarea");
        editInput.maxLength = 3000;
        editInput.required = true;
        editInput.value = comment.content;
        editInput.setAttribute("aria-label", "Edit comment");
        const save = document.createElement("button");
        save.type = "submit";
        save.textContent = "Save";
        const cancel = makeButton("Cancel", "comment-reply-button", () => editForm.remove());
        editForm.append(editInput, save, cancel);
        editForm.addEventListener("submit", async event => {
          event.preventDefault();
          const content = editInput.value.trim();
          if (!content) return;
          save.disabled = true;
          try {
            const user = await requireUser();
            const { data, error } = await supabase.from("post_comments")
              .update({ content, edited_at: new Date().toISOString() })
              .eq("id", comment.id).eq("author_id", user.id).eq("is_anonymous", false)
              .select("id").maybeSingle();
            if (error) throw error;
            if (!data) throw new Error("Comment update was not permitted.");
            commentCache.delete(post.id);
            await refreshCommentsDialog();
          } catch (error) {
            await logClientError("edit_comment", error);
            setStatus("Couldn't edit this comment. Check that you still own it and try again.", true);
            save.disabled = false;
          }
        });
        item.insertBefore(editForm, actions);
        editInput.focus();
      });
      const deleteButton = makeButton("Delete", "comment-reply-button comment-owner-action", async () => {
        if (!window.confirm("Delete this comment? Any replies beneath it will also be deleted. This cannot be undone.")) return;
        try {
          const user = await requireUser();
          const { data, error } = await supabase.from("post_comments").delete()
            .eq("id", comment.id).eq("author_id", user.id).eq("is_anonymous", false)
            .select("id").maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("Comment deletion was not permitted.");
          commentCache.delete(post.id);
          await refreshCommentsDialog();
        } catch (error) {
          await logClientError("delete_comment", error);
          setStatus("Couldn't delete this comment. It may have replies or deletion may be restricted.", true);
        }
      });
      actions.append(editButton, deleteButton);
    }
    const replyButton = makeButton("Reply", "comment-reply-button", () => {
      if (activeCommentsPost?.id !== post.id || !commentsDialog || commentsDialog.hidden) {
        openCommentsDialog(post).then(() => focusReplyComposer(comment, post));
        return;
      }
      focusReplyComposer(comment, post);
    });
    actions.append(replyButton);
    item.append(body, actions);
    if (comment.replies?.length && depth < 8) {
      const children = document.createElement("div");
      children.className = "comment-replies";
      comment.replies.forEach((reply) => children.append(makeComment(reply, post, depth + 1)));
      item.append(children);
    }
    return item;
  }

  async function toggleRow(table, postId, cache, column = "post_id") {
    const user = await requireUser();
    const active = cache.has(postId);
    if (active) {
      const { error } = await supabase.from(table).delete().eq(column, postId).eq("user_id", user.id);
      if (error) throw error;
      cache.delete(postId);
    } else {
      const { error } = await supabase.from(table).insert({ [column]: postId, user_id: user.id });
      if (error) throw error;
      cache.add(postId);
    }
    await loadInteractionCounts();
    await renderFeed();
  }

  let commentsDialog = null;
  let activeCommentsPost = null;
  let activeReplyParentId = null;

  function ensureCommentsDialog() {
    if (commentsDialog) return commentsDialog;
    commentsDialog = document.createElement("div");
    commentsDialog.className = "comments-dialog";
    commentsDialog.hidden = true;
    commentsDialog.innerHTML = `
      <div class="comments-dialog-backdrop" data-comments-close></div>
      <section class="comments-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="comments-dialog-title">
        <header class="comments-dialog-header">
          <div><h2 id="comments-dialog-title">Comments</h2><p class="comments-dialog-subtitle"></p></div>
          <button type="button" class="comments-dialog-close" aria-label="Close comments" data-comments-close>×</button>
        </header>
        <div class="comments-dialog-post"></div>
        <div class="comments-dialog-list" aria-live="polite"></div>
        <form class="comments-dialog-form post-reply-composer">
          <div class="comments-reply-context comment-reply-context" hidden></div>
          <input name="comment-content" maxlength="3000" placeholder="Write a comment…" aria-label="Write a comment" required>
          <label class="comment-anonymous-choice comments-dialog-anonymous"><input type="checkbox" name="comment-anonymous"> Comment anonymously</label>
          <button type="submit">Reply</button>
        </form>
      </section>`;
    document.body.append(commentsDialog);
    installCommentsViewportHandlers();
    syncCommentsViewport();
    commentsDialog.querySelectorAll("[data-comments-close]").forEach(button => button.addEventListener("click", closeCommentsDialog));
    commentsDialog.querySelector(".comments-dialog-form").addEventListener("submit", event => {
      event.preventDefault();
      if (!activeCommentsPost) return;
      addComment(activeCommentsPost, activeReplyParentId, event.currentTarget.elements.namedItem("comment-content"), event.currentTarget);
    });
    const composerInput = commentsDialog.querySelector('[name="comment-content"]');
    composerInput.addEventListener("focus", () => {
      syncCommentsViewport();
      window.requestAnimationFrame(() => composerInput.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    });
    commentsDialog.addEventListener("keydown", event => {
      if (event.key === "Escape") closeCommentsDialog();
    });
    return commentsDialog;
  }

  let commentsViewportHandlersInstalled = false;
  function syncCommentsViewport() {
    if (!commentsDialog) return;
    const viewport = window.visualViewport;
    const visibleHeight = viewport ? viewport.height : window.innerHeight;
    const topOffset = viewport ? Math.max(0, viewport.offsetTop) : 0;
    commentsDialog.style.setProperty("--comments-viewport-height", Math.max(280, visibleHeight) + "px");
    commentsDialog.style.setProperty("--comments-viewport-top", topOffset + "px");
  }
  function installCommentsViewportHandlers() {
    if (commentsViewportHandlersInstalled) return;
    commentsViewportHandlersInstalled = true;
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncCommentsViewport);
      window.visualViewport.addEventListener("scroll", syncCommentsViewport);
    }
    window.addEventListener("resize", syncCommentsViewport);
  }

  function closeCommentsDialog() {
    if (!commentsDialog || commentsDialog.hidden) return;
    commentsDialog.classList.remove("is-open");
    document.body.classList.remove("comments-dialog-open");
    window.setTimeout(() => { if (commentsDialog) commentsDialog.hidden = true; }, 200);
    activeCommentsPost = null;
  }

  async function openCommentsDialog(post) {
    activeCommentsPost = post;
    const dialog = ensureCommentsDialog();
    const profile = post.author_id ? profileCache.get(post.author_id) : null;
    dialog.querySelector(".comments-dialog-subtitle").textContent = (profile?.display_name || profile?.username || "Amora post");
    dialog.querySelector(".comments-dialog-post").textContent = post.content || "";
    activeReplyParentId = null;
    const replyContext = dialog.querySelector(".comments-reply-context");
    if (replyContext) { replyContext.hidden = true; replyContext.replaceChildren(); }
    const composerInput = dialog.querySelector('[name="comment-content"]');
    composerInput.placeholder = "Write a comment…";
    dialog.querySelector('.comments-dialog-form button[type="submit"]').textContent = "Comment";
    const form = dialog.querySelector(".comments-dialog-form");
    form.elements.namedItem("comment-content").placeholder = post.is_anonymous || post.force_anonymous_comments ? "Reply anonymously…" : "Write a comment…";
    dialog.querySelector(".comments-dialog-anonymous").hidden = Boolean(post.is_anonymous || post.force_anonymous_comments);
    dialog.hidden = false;
    document.body.classList.add("comments-dialog-open");
    requestAnimationFrame(() => dialog.classList.add("is-open"));
    await refreshCommentsDialog();
    form.elements.namedItem("comment-content").focus({ preventScroll: true });
  }

  function focusReplyComposer(comment, post) {
    if (!commentsDialog || activeCommentsPost?.id !== post.id) return;
    activeReplyParentId = comment.id;
    const context = commentsDialog.querySelector(".comments-reply-context");
    context.replaceChildren();
    const label = document.createElement("strong");
    label.textContent = "Replying to " + (post.is_anonymous || comment.is_anonymous ? "Anonymous" : comment.author);
    const quote = document.createElement("span");
    quote.textContent = comment.content || "";
    context.append(label, quote);
    context.hidden = false;
    const input = commentsDialog.querySelector('[name="comment-content"]');
    input.placeholder = "Write a reply…";
    commentsDialog.querySelector('.comments-dialog-form button[type="submit"]').textContent = "Reply";
    input.focus({ preventScroll: true });
    input.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function refreshCommentsDialog() {
    if (!activeCommentsPost || !commentsDialog) return;
    const post = activeCommentsPost;
    const list = commentsDialog.querySelector(".comments-dialog-list");
    list.replaceChildren();
    const loadingNote = document.createElement("p");
    loadingNote.className = "comments-dialog-empty";
    loadingNote.textContent = "Loading conversation…";
    list.append(loadingNote);
    try {
      const comments = await loadComments(post.id);
      if (!activeCommentsPost || activeCommentsPost.id !== post.id) return;
      const ids = [];
      const collect = rows => (rows || []).forEach(row => { if (row.author_id && !row.is_anonymous) ids.push(row.author_id); collect(row.replies); });
      collect(comments);
      await loadPublicProfiles(ids);
      list.replaceChildren();
      if (!comments.length) {
        const empty = document.createElement("p");
        empty.className = "comments-dialog-empty";
        empty.textContent = "No comments yet. Start the conversation.";
        list.append(empty);
      } else comments.forEach(comment => list.append(makeComment(comment, post)));
      commentsDialog.querySelector("#comments-dialog-title").textContent = "Comments (" + comments.length + ")";
      const article = feedList.querySelector('[data-post-id="' + post.id + '"]');
      const countLabel = article?.querySelector(".post-stats span:last-child");
      if (countLabel) countLabel.textContent = comments.length + (comments.length === 1 ? " comment" : " comments");
      const trigger = article?.querySelector(".post-comments-trigger");
      if (trigger) trigger.textContent = "☏ Comments · " + comments.length;
    } catch (error) {
      await logClientError("refresh_comments_dialog", error);
      list.replaceChildren();
      const message = document.createElement("p");
      message.className = "comments-dialog-empty";
      message.textContent = "Couldn't load comments. Close and try again.";
      list.append(message);
    }
  }

  async function renderPost(post) {
    const article = document.createElement("article");
    article.className = "post-card card";
    article.dataset.postId = post.id;

    const header = document.createElement("div");
    header.className = "post-header";
    const avatar = document.createElement("span");
    avatar.className = "avatar post-avatar";
    const publicProfile = post.author_id ? profileCache.get(post.author_id) : null;
    const avatarLabel = publicProfile?.display_name?.trim() || publicProfile?.username?.trim() || "";
    avatar.textContent = post.is_anonymous ? "♡" : (avatarLabel ? avatarLabel.slice(0, 1).toUpperCase() : "a");
    if (post.is_anonymous) avatar.classList.add("avatar-anonymous");
    const identity = document.createElement("div");
    identity.className = "post-identity";
    const name = document.createElement("strong");
    name.className = "post-author-name";
    name.textContent = post.is_anonymous ? "Anonymous" : profileLabel(post.author_id);
    if (!post.is_anonymous && publicProfile?.is_official) {
      const badge = document.createElement("span");
      badge.className = "official-account-badge";
      badge.setAttribute("role", "img");
      badge.setAttribute("aria-label", "Verified official Amora account");
      badge.title = "Verified official Amora account";
      badge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.2 16.2 4.9 12l-1.8 1.8 6.1 6.1L21 8.1l-1.8-1.8z" fill="currentColor"/></svg>';
      name.append(badge);
    }
    if (!post.is_anonymous && publicProfile?.username) {
      const profileLink = document.createElement("a");
      profileLink.href = "/pages/profile.html?username=" + encodeURIComponent(publicProfile.username);
      profileLink.className = "post-author-profile-link";
      profileLink.append(name);
      identity.append(profileLink);
    } else {
      identity.append(name);
    }
    const meta = document.createElement("span");
    meta.textContent = timeAgo(post.created_at) + (post.visibility === "followers" ? " · Followers" : "");
    identity.append(meta);
    header.append(avatar, identity);
    const ownedDeletionToken = getOwnedHiddenToken(post.id);
    const ownsIdentifiedPost = Boolean(currentUser && post.author_id === currentUser.id && !post.is_anonymous);
    if ((post.is_anonymous && ownedDeletionToken) || ownsIdentifiedPost) {
      const deleteButton = makeButton("Delete", "post-delete-button", async () => {
        if (!window.confirm("Delete this post permanently? This cannot be undone.")) return;
        try {
          if (post.is_anonymous) {
            const { data, error } = await supabase.rpc("delete_hidden_post", { p_post_id: post.id, p_deletion_token: ownedDeletionToken });
            if (error) throw error;
            if (data !== true) throw new Error("The deletion token was not accepted.");
            const tokens = readHiddenTokens();
            delete tokens[post.id];
            localStorage.setItem(hiddenTokenStorageKey, JSON.stringify(tokens));
          } else {
            const { error } = await supabase.from("posts").delete().eq("id", post.id).eq("author_id", currentUser.id).eq("is_anonymous", false);
            if (error) throw error;
          }
          posts = posts.filter(item => item.id !== post.id);
          setStatus("Post deleted.");
          article.remove();
          if (!feedList.querySelector(".post-card")) await renderFeed();
        } catch (error) { await logClientError("delete_post", error); setStatus("Couldn't delete this post. Please try again.", true); }
      });
      deleteButton.setAttribute("aria-label", "Delete post");
      deleteButton.title = "Delete your post";
      header.append(deleteButton);
    }

    const content = document.createElement("p");
    content.className = "post-content";
    content.textContent = post.content;
    article.append(header, content);
    (Array.isArray(post.media_urls) ? post.media_urls : []).slice(0, 4).forEach((url) => {
      if (typeof url !== "string" || !url.startsWith("https://")) return;
      const image = document.createElement("img");
      image.className = "post-image";
      image.src = url;
      image.alt = "Image attached to post";
      image.loading = "lazy";
      article.append(image);
    });

    let comments = [];
    try {
      comments = await loadComments(post.id);
    } catch (error) {
      await logClientError("load_comments", error);
      const unavailable = document.createElement("p");
      unavailable.className = "post-comments-unavailable";
      unavailable.textContent = "Conversation temporarily unavailable.";
      article.append(unavailable);
    }
    const counts = interactionCounts.get(post.id) || { likes: 0, reposts: 0, comments: comments.length };
    const stats = document.createElement("div");
    stats.className = "post-stats";
    const likesText = document.createElement("span");
    likesText.textContent = counts.likes + (counts.likes === 1 ? " like" : " likes");
    const repostsText = document.createElement("span");
    repostsText.textContent = counts.reposts + (counts.reposts === 1 ? " repost" : " reposts");
    const repliesText = document.createElement("span");
    repliesText.textContent = counts.comments + (counts.comments === 1 ? " comment" : " comments");
    stats.append(likesText, repostsText, repliesText);

    const actions = document.createElement("div");
    actions.className = "post-actions";
    const closeMoreMenu = () => {
      moreMenu.hidden = true;
      moreButton.setAttribute("aria-expanded", "false");
    };
    const moreButton = makeButton("••• More", "post-action post-more-trigger", () => {
      const shouldOpen = moreMenu.hidden;
      closeAllPostMoreMenus();
      moreMenu.hidden = !shouldOpen;
      moreBackdrop.hidden = !shouldOpen;
      moreButton.setAttribute("aria-expanded", String(shouldOpen));
      document.body.classList.toggle("post-more-open", shouldOpen);
    });
    moreButton.setAttribute("aria-haspopup", "dialog");
    moreButton.setAttribute("aria-expanded", "false");
    const moreBackdrop = document.createElement("div");
    moreBackdrop.className = "post-more-backdrop";
    moreBackdrop.hidden = true;
    moreBackdrop.addEventListener("click", closeAllPostMoreMenus);
    const moreMenu = document.createElement("div");
    moreMenu.className = "post-more-menu";
    moreMenu.hidden = true;
    moreMenu.setAttribute("role", "dialog");
    moreMenu.setAttribute("aria-label", "Post options");
    const moreMenuHeader = document.createElement("div");
    moreMenuHeader.className = "post-more-menu-header";
    const moreMenuTitle = document.createElement("strong");
    moreMenuTitle.textContent = "Post options";
    const moreMenuClose = makeButton("×", "post-more-menu-close", closeAllPostMoreMenus);
    moreMenuClose.setAttribute("aria-label", "Close post options");
    moreMenuHeader.append(moreMenuTitle, moreMenuClose);
    moreMenu.append(moreMenuHeader);
    const menuAction = (label, action, className = "") => {
      const button = makeButton(label, "post-more-menu-item" + (className ? " " + className : ""), async () => {
        closeMoreMenu();
        await action();
      });
      button.setAttribute("role", "menuitem");
      moreMenu.append(button);
      return button;
    };
    actions.append(
      makeButton(likeCache.has(post.id) ? "♥ Liked" : "♡ Like", "post-action", async () => {
        try {
          await toggleRow("post_likes", post.id, likeCache);
          setStatus(likeCache.has(post.id) ? "You liked this post." : "Like removed.");
        } catch (error) {
          await logClientError("toggle_post_like", error);
          setStatus("Couldn't update your like. Please try again.", true);
        }
      }, likeCache.has(post.id)),
      makeButton("Comments · " + comments.length, "post-action post-comments-trigger", () => openCommentsDialog(post)),
      makeButton(repostCache.has(post.id) ? "↻ Reposted" : "⟳ Repost", "post-action", async () => {
        try {
          await toggleRow("post_reposts", post.id, repostCache);
          setStatus(repostCache.has(post.id) ? "Post reposted to your activity." : "Repost removed.");
        } catch (error) {
          await logClientError("toggle_post_repost", error);
          setStatus("Couldn't repost this. Please try again.", true);
        }
      }, repostCache.has(post.id)),
      moreButton
    );
    menuAction(bookmarkCache.has(post.id) ? "▣ Remove saved post" : "▢ Save post", async () => {
      try {
        await toggleRow("post_bookmarks", post.id, bookmarkCache);
        moreButton.classList.toggle("is-active", bookmarkCache.has(post.id));
        setStatus(bookmarkCache.has(post.id) ? "Post saved." : "Post removed from saved items.");
      } catch (error) {
        await logClientError("toggle_post_bookmark", error);
        setStatus("Couldn't save this post. Please try again.", true);
      }
    });
    menuAction("↗ Share post", async () => {
      const shareUrl = window.location.origin + "/pages/social-home.html?post=" + encodeURIComponent(post.id);
      try {
        if (navigator.share) await navigator.share({ title: "Amora post", text: post.content, url: shareUrl });
        else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareUrl);
          setStatus("Post link copied.");
        } else setStatus(shareUrl);
      } catch (error) {
        if (error?.name !== "AbortError") {
          await logClientError("share_post", error);
          setStatus("Couldn't share this post. Please try again.", true);
        }
      }
    });
    menuAction("⚑ Report post", async () => {
      try {
        const reportUser = await requireUser();
        const reason = window.prompt("Why are you reporting this post? (1–1000 characters)");
        if (reason === null) return;
        const trimmedReason = reason.trim();
        if (!trimmedReason || trimmedReason.length > 1000) {
          setStatus("Enter a report reason between 1 and 1000 characters.", true);
          return;
        }
        const { error } = await supabase.from("post_reports").insert({
          post_id: post.id,
          reporter_id: reportUser.id,
          reason: trimmedReason
        });
        if (error?.code === "23505") {
          setStatus("You have already reported this post.");
          return;
        }
        if (error) throw error;
        setStatus("Report submitted for review.");
      } catch (error) {
        await logClientError("report_post", error);
        setStatus("Couldn't submit the report. Please try again.", true);
      }
    }, "post-more-report");
    if (post.author_id && currentUser && post.author_id !== currentUser.id && !post.is_anonymous) {
      menuAction("⊘ Block account", async () => {
        const confirmed = window.confirm("Block this account? Their posts will be hidden from your feed.");
        if (!confirmed) return;
        try {
          const { error } = await supabase.from("user_blocks").insert({
            blocker_id: currentUser.id,
            blocked_id: post.author_id
          });
          if (error && error.code !== "23505") throw error;
          setStatus("Account blocked.");
          await loadFeed();
        } catch (error) {
          await logClientError("block_account", error);
          setStatus("Couldn't block this account. Please try again.", true);
        }
      }, "post-more-report");
    }
    document.body.append(moreBackdrop, moreMenu);
    article.append(stats, actions);
    return article;
  }

  async function renderFeed() {
    feedList.replaceChildren();
    if (loading) {
      const message = document.createElement("div");
      message.className = "feed-empty card";
      message.textContent = "Loading your feed…";
      feedList.append(message);
      return;
    }
    let visible = posts;
    if (activeFeed === "anonymous") visible = posts.filter(post => Boolean(post.is_anonymous));
    if (activeFeed === "following" && currentUser) {
      const { data, error } = await supabase.from("user_follows").select("followed_id").eq("follower_id", currentUser.id);
      if (!error) {
        const followed = new Set((data || []).map((row) => row.followed_id));
        visible = posts.filter((post) => post.is_anonymous || followed.has(post.author_id));
      }
    }
    if (feedSearchQuery.trim()) {
      const query = feedSearchQuery.trim().toLowerCase();
      visible = visible.filter(post => {
        const profile = post.is_anonymous ? null : profileCache.get(post.author_id);
        return [post.content, post.is_anonymous ? "anonymous" : "", profile?.username, profile?.display_name].filter(Boolean).join(" ").toLowerCase().includes(query);
      });
    }
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "feed-empty card";
      const art = document.createElement("div");
      art.className = "empty-art";
      art.textContent = "♡";
      const heading = document.createElement("h2");
      heading.textContent = feedSearchQuery.trim() ? "No matching posts" : activeFeed === "anonymous" ? "No anonymous posts yet" : activeFeed === "following" ? "Your circle is growing" : "Your feed starts here";
      const copy = document.createElement("p");
      copy.textContent = feedSearchQuery.trim() ? "Try another search phrase." : activeFeed === "anonymous" ? "Anonymous posts from the community will appear here, without exposing their authors." : activeFeed === "following"
        ? "Posts from accounts you follow will appear here."
        : "Be the first to share a thought with the Amora community.";
      empty.append(art, heading, copy);
      feedList.append(empty);
      return;
    }
    for (const post of visible) feedList.append(await renderPost(post));
  }

  async function loadFeed() {
    if (!supabase) {
      setStatus("Supabase did not load. Refresh the page and check the connection.", true);
      return;
    }
    loading = true;
    await renderFeed();
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getUser();

      // The social home is for signed-in accounts only. If Supabase confirms
      // there is no valid user, clear this browser's saved session and return
      // to the landing page instead of leaving an unauthenticated feed open.
      if (sessionError) {
        const authFailure = /invalid jwt|jwt expired|user from sub claim in jwt does not exist|user not found|session not found|refresh token.*(invalid|not found|already used)|not authenticated|auth session missing/i
          .test(String(sessionError.message || ""));
        if (authFailure) {
          try { await supabase.auth.signOut({ scope: "local" }); } catch {}
          window.location.replace("/index.html");
          return;
        }
        throw sessionError;
      }

      currentUser = sessionData.user || null;
      if (currentUser) {
        const { data: ownProfile } = await supabase.from("profiles").select("display_name,username").eq("id", currentUser.id).maybeSingle();
        const displayName = ownProfile?.display_name?.trim() || ownProfile?.username || "Your profile";
        const initial = displayName.slice(0,1).toUpperCase();
        const nameNode = document.getElementById("composer-display-name");
        const avatarNode = document.getElementById("composer-user-avatar");
        const quickAvatar = document.querySelector(".quick-composer-avatar");
        if (nameNode) nameNode.textContent = displayName;
        if (avatarNode) avatarNode.textContent = initial;
        if (quickAvatar) quickAvatar.textContent = initial;
      }
      if (!currentUser) {
        try { await supabase.auth.signOut({ scope: "local" }); } catch {}
        window.location.replace("/index.html");
        return;
      }

      const useCachedPosts = restoredFeedCache &&
        restoredFeedCache.activeFeed === activeFeed &&
        Date.now() - restoredFeedCache.savedAt < homeFeedCacheMaxAge;
      if (useCachedPosts) {
        posts = restoredFeedCache.posts;
        restoredFeedCache = null;
      } else {
        let query = supabase.from("posts")
          .select("id,author_id,content,media_urls,visibility,is_anonymous,force_anonymous_comments,created_at")
          .order("created_at", { ascending: false })
          .limit(50);
        if (activeFeed === "public") query = query.eq("visibility", "public");
        const { data, error } = await query;
        if (error) throw error;
        posts = data || [];
      }
      if (currentUser && posts.length) {
        const { data: blocks, error: blockError } = await supabase
          .from("user_blocks")
          .select("blocked_id")
          .eq("blocker_id", currentUser.id);
        if (!blockError && blocks?.length) {
          const blockedIds = new Set(blocks.map((row) => row.blocked_id));
          posts = posts.filter((post) => post.is_anonymous || !blockedIds.has(post.author_id));
        }
      }
      commentCache.clear();
      await loadPublicProfiles(posts.filter((post) => !post.is_anonymous && post.author_id).map((post) => post.author_id));
      await Promise.all([loadMyInteractions(), loadInteractionCounts()]);
      loading = false;
      await renderFeed();
      saveHomeFeedCache();
    } catch (error) {
      await logClientError("load_feed", error);
      loading = false;
      feedList.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "feed-empty card";
      const heading = document.createElement("h2");
      heading.textContent = "Your feed is temporarily unavailable";
      const copy = document.createElement("p");
      copy.textContent = "Please try again in a moment.";
      empty.append(heading, copy);
      feedList.append(empty);
      setStatus("Couldn't load the feed. Please try again.", true);
    }
  }

  feedTabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      activeFeed = tab.dataset.feed;
      feedTabs.forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      restoredFeedCache = null;
      await loadFeed();
    });
  });

  publishButton.addEventListener("click", async () => {
    const body = textInput.value.trim();
    if (!body && !selectedImage) {
      setStatus("Write something or attach an image first.", true);
      return;
    }
    loading = true;
    updatePublishButton();
    let uploadedPath = null;
    let publishedPostId = null;
    try {
      const user = await requireUser();
      let mediaUrls = [];
      if (selectedImage) {
        const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[selectedImage.type];
        if (!extension) throw new Error("That image format is not supported.");
        uploadedPath = user.id + "/" + crypto.randomUUID() + "." + extension;
        const { error: uploadError } = await supabase.storage
          .from("amora-post-images")
          .upload(uploadedPath, selectedImage, { contentType: selectedImage.type, upsert: false });
        if (uploadError) throw uploadError;
        const { data: publicUrlData } = supabase.storage.from("amora-post-images").getPublicUrl(uploadedPath);
        if (!publicUrlData?.publicUrl) throw new Error("Could not create the image URL.");
        mediaUrls = [publicUrlData.publicUrl];
      }

      if (hideIdentity.checked) {
        const token = randomDeletionToken();
        const result = await supabase.rpc("create_hidden_post", {
          p_content: body,
          p_media_urls: mediaUrls,
          p_deletion_token: token,
          p_force_anonymous_comments: Boolean(forceAnonymousComments?.checked)
        });
        if (result.error) throw result.error;
        if (typeof result.data !== "string") throw new Error("The post was not confirmed by the server.");
        saveHiddenToken(result.data, token, user.id);
        publishedPostId = result.data;
      } else {
        const { data: insertedPost, error } = await supabase.from("posts").insert({
          author_id: user.id,
          content: body,
          media_urls: mediaUrls,
          visibility: "public",
          is_anonymous: false,
          force_anonymous_comments: Boolean(forceAnonymousComments?.checked)
        }).select("id").single();
        if (error) throw error;
        publishedPostId = insertedPost.id;
      }
      textInput.value = "";
      hideIdentity.checked = false;
      if (forceAnonymousComments) forceAnonymousComments.checked = false;
      if (imageInput) imageInput.value = "";
      selectedImage = null;
      if (imagePreview) {
        imagePreview.replaceChildren();
        imagePreview.hidden = true;
      }
      setStatus("Your post has been published.");
      activeFeed = "for-you";
      feedTabs.forEach((tab) => {
        const selected = tab.dataset.feed === activeFeed;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", String(selected));
      });
      const { data: newPost, error: newPostError } = await supabase.from("posts")
        .select("id,author_id,content,media_urls,visibility,is_anonymous,force_anonymous_comments,created_at")
        .eq("id", publishedPostId).single();
      if (newPostError) throw newPostError;
      posts = [newPost, ...posts.filter(post => post.id !== newPost.id)].slice(0, 50);
      if (newPost.author_id) await loadPublicProfiles([newPost.author_id]);
      interactionCounts.set(newPost.id, { likes: 0, reposts: 0, comments: 0 });
      commentCache.delete(newPost.id);
      const renderedPost = await renderPost(newPost);
      feedList.querySelector(".feed-empty")?.remove();
      feedList.prepend(renderedPost);
      saveHomeFeedCache();
      if (composerDialog) {
        composerDialog.classList.remove("is-expanded");
        composerDialog.hidden = true;
      }
      if (quickComposer) quickComposer.setAttribute("aria-expanded", "false");
    } catch (error) {
      if (uploadedPath) {
        try { await supabase.storage.from("amora-post-images").remove([uploadedPath]); } catch {}
      }
      await logClientError("publish_post", error);
      setStatus("Couldn't publish your post. Your draft is still here.", true);
    } finally {
      loading = false;
      updatePublishButton();
    }
  });



  async function openNotificationTarget() {
    const params = new URLSearchParams(window.location.search);
    const postId = params.get("post");
    const commentId = params.get("comment");
    const isUuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    if (!isUuid(postId) || (commentId && !isUuid(commentId))) return;
    try {
      let post = posts.find(item => item.id === postId);
      if (!post) {
        const { data, error } = await supabase.from("posts").select("id,author_id,content,media_urls,visibility,is_anonymous,force_anonymous_comments,created_at").eq("id", postId).maybeSingle();
        if (error) throw error;
        post = data;
      }
      if (!post) { setStatus("That post is unavailable or is no longer accessible.", true); return; }
      if (!posts.some(item => item.id === post.id)) posts.unshift(post);
      activeFeed = "for-you";
      feedTabs.forEach(tab => { const selected = tab.dataset.feed === activeFeed; tab.classList.toggle("active", selected); tab.setAttribute("aria-selected", String(selected)); });
      await loadPublicProfiles([post.author_id].filter(Boolean));
      await renderFeed();
      const article = feedList.querySelector('[data-post-id="' + postId + '"]');
      if (!article) { setStatus("That post could not be shown in this feed.", true); return; }
      article.classList.add("notification-target-highlight");
      article.scrollIntoView({ behavior: "smooth", block: "center" });
      if (commentId) {
        await openCommentsDialog(post);
        const findComment = rows => { for (const row of rows || []) { if (row.id === commentId) return row; const nested = findComment(row.replies); if (nested) return nested; } return null; };
        const target = findComment(await loadComments(post.id));
        if (!target) setStatus("The post is open, but that comment is unavailable.", true);
        else {
          const targetNode = commentsDialog.querySelector('[data-comment-id="' + commentId + '"]');
          if (targetNode) { targetNode.classList.add("notification-target-highlight"); targetNode.scrollIntoView({ behavior: "smooth", block: "center" }); }
          if (target.parent_comment) commentsDialog.querySelector('[data-comment-id="' + target.parent_comment.id + '"]')?.classList.add("notification-target-highlight");
        }
      }
      const cleanUrl = new URL(window.location.href); cleanUrl.searchParams.delete("post"); cleanUrl.searchParams.delete("comment");
      window.history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    } catch (error) { await logClientError("open_notification_target", error); setStatus("Could not open that notification post. It may have been deleted or access may be restricted.", true); }
  }

  // Photo viewer for feed media. Uses only URLs already rendered on accessible posts.
  const lightbox = document.getElementById("media-lightbox");
  const lightboxImage = document.getElementById("media-lightbox-image");
  const lightboxCounter = document.getElementById("media-lightbox-counter");
  let lightboxImages = [];
  let lightboxIndex = 0;
  function showLightboxImage() {
    if (!lightboxImages.length || !lightbox) return;
    lightboxImage.src = lightboxImages[lightboxIndex].src;
    lightboxImage.alt = lightboxImages[lightboxIndex].alt || "Expanded post photo";
    lightboxCounter.textContent = (lightboxIndex + 1) + " of " + lightboxImages.length;
    const prev = lightbox.querySelector(".media-lightbox-prev");
    const next = lightbox.querySelector(".media-lightbox-next");
    prev.hidden = lightboxImages.length < 2;
    next.hidden = lightboxImages.length < 2;
  }
  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    document.body.classList.remove("media-viewer-open");
    lightboxImage.removeAttribute("src");
    lightboxImages = [];
  }
  feedList.addEventListener("click", (event) => {
    const image = event.target.closest(".post-image");
    if (!image || !image.closest(".post-card")) return;
    const article = image.closest(".post-card");
    lightboxImages = [...article.querySelectorAll(".post-image")];
    lightboxIndex = Math.max(0, lightboxImages.indexOf(image));
    showLightboxImage();
    lightbox.hidden = false;
    document.body.classList.add("media-viewer-open");
    lightbox.querySelector(".media-lightbox-close").focus();
  });
  if (lightbox) {
    lightbox.querySelector(".media-lightbox-close").addEventListener("click", closeLightbox);
    lightbox.querySelector(".media-lightbox-prev").addEventListener("click", () => {
      if (lightboxImages.length) { lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length; showLightboxImage(); }
    });
    lightbox.querySelector(".media-lightbox-next").addEventListener("click", () => {
      if (lightboxImages.length) { lightboxIndex = (lightboxIndex + 1) % lightboxImages.length; showLightboxImage(); }
    });
    lightbox.addEventListener("click", (event) => { if (event.target === lightbox) closeLightbox(); });
    document.addEventListener("keydown", (event) => {
      if (lightbox.hidden) return;
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowLeft" && lightboxImages.length > 1) { lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length; showLightboxImage(); }
      if (event.key === "ArrowRight" && lightboxImages.length > 1) { lightboxIndex = (lightboxIndex + 1) % lightboxImages.length; showLightboxImage(); }
    });
  }
  const refreshFeedButton = document.getElementById("refresh-feed");
  if (refreshFeedButton) refreshFeedButton.addEventListener("click", async () => {
    refreshFeedButton.disabled = true;
    refreshFeedButton.textContent = "…";
    restoredFeedCache = null;
    try { await loadFeed(); }
    finally { refreshFeedButton.disabled = false; refreshFeedButton.textContent = "↻"; }
  });

  loadFeed().then(async () => { restoreHomeState(); await openNotificationTarget(); });
});