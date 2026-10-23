"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const composer = document.getElementById("composer");
  const textInput = document.getElementById("post-text");
  const imageInput = document.getElementById("post-image");
  const imagePreview = document.getElementById("image-preview");
  const hideIdentity = document.getElementById("hide-identity");
  const publishButton = document.getElementById("publish-post");
  const composerStatus = document.getElementById("composer-status");
  const feedList = document.getElementById("feed-list");
  const feedTabs = [...document.querySelectorAll("[data-feed]")];
  const supabase = window.amoraSupabase || null;

  if (!composer || !textInput || !feedList || !publishButton) return;

  let selectedImage = null;
  let activeFeed = "for-you";
  let currentUser = null;
  let loading = false;
  let posts = [];
  const commentCache = new Map();
  const likeCache = new Set();
  const bookmarkCache = new Set();
  const repostCache = new Set();
  const hiddenTokenStorageKey = "amora_hidden_post_delete_tokens";

  document.querySelectorAll("[data-focus-composer]").forEach((button) => {
    button.addEventListener("click", () => {
      composer.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => textInput.focus(), 250);
    });
  });

  function setStatus(message, isError = false) {
    composerStatus.textContent = message || "";
    composerStatus.style.color = isError ? "#ff9aaa" : "";
  }

  function updatePublishButton() {
    publishButton.disabled = loading || (!textInput.value.trim() && !selectedImage);
  }
  textInput.addEventListener("input", updatePublishButton);

  imageInput?.addEventListener("change", () => {
    selectedImage = imageInput.files?.[0] || null;
    imagePreview?.replaceChildren();
    if (!selectedImage) {
      if (imagePreview) imagePreview.hidden = true;
      updatePublishButton();
      return;
    }
    // No storage bucket has been verified yet. Never pretend a local image was published.
    selectedImage = null;
    imageInput.value = "";
    if (imagePreview) imagePreview.hidden = true;
    setStatus("Photo posts are being connected securely. For now, publish text-only posts.", true);
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

  function saveHiddenToken(postId, token) {
    const tokens = readHiddenTokens();
    tokens[postId] = token;
    try { localStorage.setItem(hiddenTokenStorageKey, JSON.stringify(tokens)); } catch {}
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

  async function loadComments(postId) {
    if (commentCache.has(postId)) return commentCache.get(postId);
    const { data, error } = await supabase
      .from("post_comments")
      .select("id,post_id,parent_comment_id,author_id,content,is_anonymous,created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const rows = data || [];
    const byId = new Map();
    rows.forEach((row) => byId.set(row.id, {
      ...row, author: row.is_anonymous ? "Anonymous" : (row.author_id === currentUser?.id ? "You" : "Amora member"),
      replies: []
    }));
    const roots = [];
    rows.forEach((row) => {
      const item = byId.get(row.id);
      const parent = row.parent_comment_id ? byId.get(row.parent_comment_id) : null;
      if (parent) parent.replies.push(item);
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
      const payload = {
        post_id: post.id,
        parent_comment_id: parentId || null,
        author_id: post.is_anonymous ? null : user.id,
        is_anonymous: Boolean(post.is_anonymous),
        content: value
      };
      const { error } = await supabase.from("post_comments").insert(payload);
      if (error) throw error;
      commentCache.delete(post.id);
      await renderFeed();
    } catch (error) {
      setStatus(error.message || "Could not publish your reply.", true);
    } finally {
      const button = form.querySelector("button[type=submit]");
      if (button) button.disabled = false;
    }
  }

  function makeComment(comment, post, depth = 0) {
    const item = document.createElement("div");
    item.className = "comment-item";
    const body = document.createElement("div");
    body.className = "comment-body";
    const head = document.createElement("div");
    head.className = "comment-head";
    const author = document.createElement("strong");
    author.textContent = post.is_anonymous || comment.is_anonymous ? "Anonymous" : comment.author;
    const text = document.createElement("p");
    text.textContent = comment.content;
    head.append(author);
    body.append(head, text);
    const replyButton = makeButton("Reply", "comment-reply-button", () => {
      const old = item.querySelector(":scope > .reply-composer");
      if (old) { old.remove(); return; }
      const form = document.createElement("form");
      form.className = "reply-composer";
      const input = document.createElement("input");
      input.maxLength = 3000;
      input.placeholder = "Write a reply…";
      input.setAttribute("aria-label", "Write a reply");
      const send = document.createElement("button");
      send.type = "submit";
      send.textContent = "Reply";
      form.append(input, send);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        addComment(post, comment.id, input, form);
      });
      item.append(form);
      input.focus();
    });
    body.append(replyButton);
    item.append(body);
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
    await renderFeed();
  }

  async function renderPost(post) {
    const article = document.createElement("article");
    article.className = "post-card card";
    article.dataset.postId = post.id;

    const header = document.createElement("div");
    header.className = "post-header";
    const avatar = document.createElement("span");
    avatar.className = "avatar post-avatar";
    avatar.textContent = post.is_anonymous ? "♡" : "a";
    if (post.is_anonymous) avatar.classList.add("avatar-anonymous");
    const identity = document.createElement("div");
    identity.className = "post-identity";
    const name = document.createElement("strong");
    name.textContent = post.is_anonymous ? "Anonymous" : (post.author_id === currentUser?.id ? "You" : "Amora member");
    const meta = document.createElement("span");
    meta.textContent = timeAgo(post.created_at) + (post.visibility === "followers" ? " · Followers" : "");
    identity.append(name, meta);
    header.append(avatar, identity);
    if (post.is_anonymous && readHiddenTokens()[post.id]) {
      header.append(makeButton("Delete", "post-more", async () => {
        const token = readHiddenTokens()[post.id];
        try {
          const { data, error } = await supabase.rpc("delete_hidden_post", { p_post_id: post.id, p_deletion_token: token });
          if (error) throw error;
          if (data !== true) throw new Error("The deletion token was not accepted.");
          const tokens = readHiddenTokens();
          delete tokens[post.id];
          localStorage.setItem(hiddenTokenStorageKey, JSON.stringify(tokens));
          setStatus("Anonymous post deleted.");
          await loadFeed();
        } catch (error) { setStatus(error.message || "Could not delete this post.", true); }
      }));
    } else {
      const more = document.createElement("span");
      more.className = "post-more";
      more.textContent = "♡";
      more.setAttribute("aria-hidden", "true");
      header.append(more);
    }

    const content = document.createElement("p");
    content.className = "post-content";
    content.textContent = post.content;
    article.append(header, content);

    const comments = await loadComments(post.id);
    const stats = document.createElement("div");
    stats.className = "post-stats";
    const likesText = document.createElement("span");
    likesText.textContent = "Likes are private to each account";
    const repliesText = document.createElement("span");
    repliesText.textContent = comments.length + (comments.length === 1 ? " reply" : " replies");
    stats.append(likesText, repliesText);

    const actions = document.createElement("div");
    actions.className = "post-actions";
    actions.append(
      makeButton(likeCache.has(post.id) ? "♥ Liked" : "♡ Like", "post-action", async () => {
        try { await toggleRow("post_likes", post.id, likeCache); }
        catch (error) { setStatus(error.message || "Could not update like.", true); }
      }, likeCache.has(post.id)),
      makeButton("▢ Reply", "post-action", () => {
        const old = article.querySelector(":scope > .post-reply-composer");
        if (old) { old.remove(); return; }
        const form = document.createElement("form");
        form.className = "post-reply-composer";
        const input = document.createElement("input");
        input.maxLength = 3000;
        input.placeholder = "Join the conversation…";
        input.setAttribute("aria-label", "Write a reply");
        const send = document.createElement("button");
        send.type = "submit";
        send.textContent = "Reply";
        form.append(input, send);
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          addComment(post, null, input, form);
        });
        article.append(form);
        input.focus();
      }),
      makeButton(repostCache.has(post.id) ? "↻ Reposted" : "⟳ Repost", "post-action", async () => {
        try { await toggleRow("post_reposts", post.id, repostCache); }
        catch (error) { setStatus(error.message || "Could not repost.", true); }
      }, repostCache.has(post.id)),
      makeButton(bookmarkCache.has(post.id) ? "▣ Saved" : "▢ Save", "post-action", async () => {
        try { await toggleRow("post_bookmarks", post.id, bookmarkCache); }
        catch (error) { setStatus(error.message || "Could not save post.", true); }
      }, bookmarkCache.has(post.id)),
      makeButton("↗ Share", "post-action", async () => {
        const shareUrl = window.location.origin + "/pages/social-home.html#post-" + post.id;
        try {
          if (navigator.share) await navigator.share({ title: "Amora post", text: post.content, url: shareUrl });
          else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(shareUrl);
            setStatus("Post link copied.");
          } else setStatus(shareUrl);
        } catch (error) {
          if (error?.name !== "AbortError") setStatus("Could not share this post.", true);
        }
      })
    );
    article.append(stats, actions);
    if (comments.length) {
      const section = document.createElement("section");
      section.className = "post-comments";
      const title = document.createElement("h3");
      title.textContent = "Conversation";
      section.append(title);
      comments.forEach((comment) => section.append(makeComment(comment, post)));
      article.append(section);
    }
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
    if (activeFeed === "following" && currentUser) {
      const { data, error } = await supabase.from("user_follows").select("followed_id").eq("follower_id", currentUser.id);
      if (!error) {
        const followed = new Set((data || []).map((row) => row.followed_id));
        visible = posts.filter((post) => post.is_anonymous || followed.has(post.author_id));
      }
    }
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "feed-empty card";
      const art = document.createElement("div");
      art.className = "empty-art";
      art.textContent = "♡";
      const heading = document.createElement("h2");
      heading.textContent = activeFeed === "following" ? "Your circle is growing" : "Your feed starts here";
      const copy = document.createElement("p");
      copy.textContent = activeFeed === "following"
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
      if (sessionError) throw sessionError;
      currentUser = sessionData.user || null;
      let query = supabase.from("posts")
        .select("id,author_id,content,media_urls,visibility,is_anonymous,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (activeFeed === "public") query = query.eq("visibility", "public");
      const { data, error } = await query;
      if (error) throw error;
      posts = data || [];
      commentCache.clear();
      await loadMyInteractions();
      loading = false;
      await renderFeed();
    } catch (error) {
      loading = false;
      feedList.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "feed-empty card";
      const heading = document.createElement("h2");
      heading.textContent = "Your feed could not load";
      const copy = document.createElement("p");
      copy.textContent = error.message || "Please refresh and try again.";
      empty.append(heading, copy);
      feedList.append(empty);
      setStatus("Could not load posts. Check the connection and try again.", true);
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
      await loadFeed();
    });
  });

  publishButton.addEventListener("click", async () => {
    const body = textInput.value.trim();
    if (!body) {
      setStatus("Write something first. Photo-only posts will be available after secure storage is configured.", true);
      return;
    }
    loading = true;
    updatePublishButton();
    try {
      const user = await requireUser();
      let error;
      if (hideIdentity.checked) {
        const token = randomDeletionToken();
        const result = await supabase.rpc("create_hidden_post", {
          p_content: body,
          p_media_urls: [],
          p_deletion_token: token
        });
        error = result.error;
        if (error) throw error;
        if (typeof result.data !== "string") throw new Error("The post was not confirmed by the server.");
        saveHiddenToken(result.data, token);
      } else {
        const result = await supabase.from("posts").insert({
          author_id: user.id,
          content: body,
          media_urls: [],
          visibility: "public",
          is_anonymous: false
        });
        error = result.error;
        if (error) throw error;
      }
      textInput.value = "";
      hideIdentity.checked = false;
      if (imageInput) imageInput.value = "";
      selectedImage = null;
      setStatus("Your post has been published.");
      activeFeed = "for-you";
      feedTabs.forEach((tab) => {
        const selected = tab.dataset.feed === activeFeed;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", String(selected));
      });
      await loadFeed();
    } catch (error) {
      setStatus(error.message || "Could not publish your post. Your draft is still here.", true);
    } finally {
      loading = false;
      updatePublishButton();
    }
  });

  loadFeed();
});