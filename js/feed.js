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

  if (!composer || !textInput || !feedList || !publishButton) return;

  const supabase = window.amoraSupabase || null;
  let selectedImage = null;
  let previewUrl = null;
  let activeFeed = "for-you";
  let nextId = 10;

  // Clearly labelled preview content keeps the page from looking broken
  // while the real posts schema and privacy policies are being connected.
  const posts = [
    {
      id: 1, author: "MoonlitFox", avatar: "M", time: "12 min",
      text: "Sometimes you just need a place where you can say what you actually think, without overthinking every word. 💗",
      following: true, likes: 18, liked: false, reposts: 3, reposted: false,
      bookmarked: false, hidden: false, preview: true,
      comments: [
        { id: 101, author: "VelvetRose", text: "This. A little honesty goes a long way.", replies: [] },
        { id: 102, author: "Anonymous", text: "Especially when you can't say it anywhere else.", replies: [], anonymous: true }
      ]
    },
    {
      id: 2, author: "Anonymous", avatar: "♡", time: "34 min",
      text: "What's one thing you wish people understood about you without you having to explain it?",
      following: false, likes: 42, liked: false, reposts: 7, reposted: false,
      bookmarked: false, hidden: true, preview: true,
      comments: [
        { id: 201, author: "Anonymous", text: "That being quiet doesn't mean I have nothing to say.", anonymous: true, replies: [
          { id: 202, author: "Anonymous", text: "Exactly. Sometimes I'm just figuring out how to say it.", anonymous: true, replies: [] }
        ] }
      ]
    },
    {
      id: 3, author: "SoftChaos", avatar: "S", time: "1 hr",
      text: "A reminder that starting over is still progress. You don't have to have everything figured out today. ✨",
      following: true, likes: 9, liked: false, reposts: 1, reposted: false,
      bookmarked: false, hidden: false, preview: true, comments: []
    }
  ];

  document.querySelectorAll("[data-focus-composer]").forEach((button) => {
    button.addEventListener("click", () => {
      composer.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => textInput.focus(), 250);
    });
  });

  function setStatus(message, isError = false) {
    composerStatus.textContent = message;
    composerStatus.style.color = isError ? "#ff9aaa" : "";
  }

  function updatePublishButton() {
    publishButton.disabled = !textInput.value.trim() && !selectedImage;
  }
  textInput.addEventListener("input", updatePublishButton);

  function clearImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    selectedImage = null;
    imageInput.value = "";
    imagePreview.replaceChildren();
    imagePreview.hidden = true;
    updatePublishButton();
  }

  imageInput.addEventListener("change", () => {
    selectedImage = imageInput.files?.[0] || null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    imagePreview.replaceChildren();
    imagePreview.hidden = !selectedImage;
    if (!selectedImage) { updatePublishButton(); return; }

    if (!selectedImage.type.startsWith("image/")) {
      clearImage();
      setStatus("Choose an image file.", true);
      return;
    }
    if (selectedImage.size > 8 * 1024 * 1024) {
      clearImage();
      setStatus("Images must be 8 MB or smaller.", true);
      return;
    }

    previewUrl = URL.createObjectURL(selectedImage);
    const img = document.createElement("img");
    img.src = previewUrl;
    img.alt = "Selected image preview";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-image";
    remove.setAttribute("aria-label", "Remove selected image");
    remove.textContent = "×";
    remove.addEventListener("click", clearImage);
    imagePreview.append(img, remove);
    setStatus("");
    updatePublishButton();
  });

  function makeButton(label, className, action, pressed = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    if (pressed) button.classList.add("is-active");
    button.addEventListener("click", action);
    return button;
  }

  function makeComment(comment, post) {
    const item = document.createElement("div");
    item.className = "comment-item";
    const body = document.createElement("div");
    body.className = "comment-body";
    const head = document.createElement("div");
    head.className = "comment-head";
    const author = document.createElement("strong");
    author.textContent = post.hidden || comment.anonymous ? "Anonymous" : comment.author;
    const text = document.createElement("p");
    text.textContent = comment.text;
    head.append(author);
    body.append(head, text);
    item.append(body);

    const replyButton = makeButton("Reply", "comment-reply-button", () => {
      const existing = item.querySelector(".reply-composer");
      if (existing) { existing.remove(); return; }
      const form = document.createElement("form");
      form.className = "reply-composer";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 1000;
      input.placeholder = "Write a reply…";
      input.setAttribute("aria-label", "Write a reply");
      const send = document.createElement("button");
      send.type = "submit";
      send.textContent = "Reply";
      form.append(input, send);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        if (!comment.replies) comment.replies = [];
        comment.replies.push({
          id: nextId++, author: "You", text: value,
          anonymous: post.hidden, replies: []
        });
        renderFeed();
      });
      item.append(form);
      input.focus();
    });
    body.append(replyButton);

    if (comment.replies?.length) {
      const children = document.createElement("div");
      children.className = "comment-replies";
      comment.replies.forEach((reply) => children.append(makeComment(reply, post)));
      item.append(children);
    }
    return item;
  }

  function renderPost(post) {
    const article = document.createElement("article");
    article.className = "post-card card";
    article.dataset.postId = String(post.id);

    const header = document.createElement("div");
    header.className = "post-header";
    const avatar = document.createElement("span");
    avatar.className = "avatar post-avatar";
    avatar.textContent = post.hidden ? "♡" : post.avatar || "?";
    if (post.hidden) avatar.classList.add("avatar-anonymous");
    const identity = document.createElement("div");
    identity.className = "post-identity";
    const name = document.createElement("strong");
    name.textContent = post.hidden ? "Anonymous" : post.author;
    const meta = document.createElement("span");
    meta.textContent = post.preview ? `${post.time} · Preview post` : `${post.time} · Just now`;
    identity.append(name, meta);
    const more = document.createElement("span");
    more.className = "post-more";
    more.textContent = "···";
    more.setAttribute("aria-hidden", "true");
    header.append(avatar, identity, more);

    const content = document.createElement("p");
    content.className = "post-content";
    content.textContent = post.text;
    article.append(header, content);

    if (post.imageUrl) {
      const image = document.createElement("img");
      image.className = "post-image";
      image.src = post.imageUrl;
      image.alt = "Image attached to post";
      article.append(image);
    }

    const stats = document.createElement("div");
    stats.className = "post-stats";
    const likesText = document.createElement("span");
    likesText.textContent = `${post.likes} likes`;
    const repliesText = document.createElement("span");
    repliesText.textContent = `${post.comments.length} replies`;
    const repostsText = document.createElement("span");
    repostsText.textContent = `${post.reposts} reposts`;
    stats.append(likesText, repliesText, repostsText);

    const actions = document.createElement("div");
    actions.className = "post-actions";
    actions.append(
      makeButton(`${post.liked ? "♥" : "♡"} Like`, "post-action" + (post.liked ? " is-active" : ""), () => {
        post.liked = !post.liked;
        post.likes += post.liked ? 1 : -1;
        renderFeed();
      }),
      makeButton("▢ Reply", "post-action", () => {
        const box = article.querySelector(".post-reply-composer");
        if (box) { box.remove(); return; }
        const form = document.createElement("form");
        form.className = "post-reply-composer";
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 1000;
        input.placeholder = "Join the conversation…";
        input.setAttribute("aria-label", "Write a reply");
        const send = document.createElement("button");
        send.type = "submit";
        send.textContent = "Reply";
        form.append(input, send);
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const value = input.value.trim();
          if (!value) return;
          post.comments.push({
            id: nextId++, author: "You", text: value,
            anonymous: post.hidden, replies: []
          });
          renderFeed();
        });
        article.append(form);
        input.focus();
      }),
      makeButton(`${post.reposted ? "↻" : "⟳"} Repost`, "post-action" + (post.reposted ? " is-active" : ""), () => {
        post.reposted = !post.reposted;
        post.reposts += post.reposted ? 1 : -1;
        renderFeed();
      }),
      makeButton(post.bookmarked ? "▣ Saved" : "▢ Save", "post-action" + (post.bookmarked ? " is-active" : ""), () => {
        post.bookmarked = !post.bookmarked;
        renderFeed();
      }),
      makeButton("↗ Share", "post-action", async () => {
        const shareUrl = `${window.location.origin}/pages/social-home.html#post-${post.id}`;
        try {
          if (navigator.share) await navigator.share({ title: "Amora post", text: post.text, url: shareUrl });
          else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(shareUrl);
            setStatus("Post link copied.");
          } else {
            setStatus(shareUrl);
          }
        } catch (error) {
          if (error?.name !== "AbortError") setStatus("Could not share this post.", true);
        }
      })
    );
    article.append(stats, actions);

    if (post.comments.length) {
      const comments = document.createElement("section");
      comments.className = "post-comments";
      const title = document.createElement("h3");
      title.textContent = "Conversation";
      comments.append(title);
      post.comments.forEach((comment) => comments.append(makeComment(comment, post)));
      article.append(comments);
    }
    return article;
  }

  function renderFeed() {
    feedList.replaceChildren();
    const visible = posts.filter((post) => activeFeed !== "following" || post.following);
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "feed-empty card";
      const art = document.createElement("div");
      art.className = "empty-art";
      art.textContent = "♡";
      const heading = document.createElement("h2");
      heading.textContent = activeFeed === "following" ? "Your circle is growing" : "The public feed is waiting";
      const copy = document.createElement("p");
      copy.textContent = activeFeed === "following"
        ? "Posts from accounts you follow will appear here."
        : "Public posts will appear here when Amora's feed database is connected.";
      empty.append(art, heading, copy);
      feedList.append(empty);
      return;
    }
    visible.forEach((post) => feedList.append(renderPost(post)));
    const note = document.createElement("p");
    note.className = "preview-feed-note";
    note.textContent = "Preview content and interactions are temporary in this first UI build. They are not shared with other accounts yet.";
    feedList.append(note);
  }

  feedTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeFeed = tab.dataset.feed;
      feedTabs.forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      renderFeed();
    });
  });

  publishButton.addEventListener("click", async () => {
    const body = textInput.value.trim();
    if (!body && !selectedImage) return;

    let user = null;
    if (supabase) {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        user = data?.user || null;
      } catch {
        setStatus("Could not verify your session. Your draft is still here.", true);
        return;
      }
    }
    if (!user) {
      setStatus("Log in before posting. Your draft is still here.", true);
      window.location.href = "/pages/home.html?auth=login";
      return;
    }

    // Frontend preview only. Do not send a post to Supabase until the
    // schema and database-level hidden-identity rules have been verified.
    const imageUrl = selectedImage ? URL.createObjectURL(selectedImage) : null;
    posts.unshift({
      id: nextId++, author: "You", avatar: "Y", time: "now",
      text: body, imageUrl, following: true, likes: 0, liked: false,
      reposts: 0, reposted: false, bookmarked: false,
      hidden: hideIdentity.checked, preview: false, comments: []
    });
    textInput.value = "";
    hideIdentity.checked = false;
    clearImage();
    setStatus("Post added to this preview. It is not published to other accounts yet.");
    activeFeed = "for-you";
    feedTabs.forEach((tab) => {
      const selected = tab.dataset.feed === activeFeed;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    renderFeed();
  });

  if (!supabase) setStatus("Supabase did not load. Refresh the page and check the connection.", true);
  renderFeed();
});
