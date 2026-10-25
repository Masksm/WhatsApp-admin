"use strict";
document.addEventListener("DOMContentLoaded", () => {
  const db = window.amoraSupabase;
  const row = document.getElementById("stories-row");
  const status = document.getElementById("stories-status");
  const createButton = document.getElementById("story-create-button");
  const composerStoryButton = document.getElementById("story-create-composer-button");
  const likeButton = document.getElementById("story-like-button");
  const commentToggle = document.getElementById("story-comment-toggle");
  const shareButton = document.getElementById("story-share-button");
  const moreButton = document.getElementById("story-more-button");
  const moreMenu = document.getElementById("story-more-menu");
  const commentsPanel = document.getElementById("story-comments-panel");
  const commentsList = document.getElementById("story-comments-list");
  const commentForm = document.getElementById("story-comment-form");
  const commentInput = document.getElementById("story-comment-input");
  const fileInput = document.getElementById("story-file-input");
  const viewer = document.getElementById("story-viewer");
  const viewerProgress = document.getElementById("story-viewer-progress");
  const viewerMedia = document.getElementById("story-viewer-media");
  const viewerName = document.getElementById("story-viewer-name");
  const viewerAvatar = document.getElementById("story-viewer-avatar");
  const viewerTime = document.getElementById("story-viewer-time");
  const viewerCaption = document.getElementById("story-viewer-caption");
  const closeButton = document.getElementById("story-viewer-close");
  const prevButton = document.getElementById("story-viewer-prev");
  const nextButton = document.getElementById("story-viewer-next");
  if (!db || !row || !fileInput || !viewer) return;

  const BUCKET = "amora-stories-media";
  const MAX_VIDEO_SECONDS = 60;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  let currentUser = null;
  let storyGroups = [];
  let activeGroup = 0;
  let activeIndex = 0;
  let signedUrlCache = new Map();
  let advanceTimer = null;
  let progressTimer = null;
  let viewerStartedAt = 0;
  let currentVideo = null;
  let pausedStoryState = null;
  let activeStory = null;
  let mutedUserIds = new Set();

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const say = (message) => { status.textContent = message || ""; };
  const initials = (name) => (String(name || "A").trim().charAt(0) || "A").toUpperCase();
  const nameFor = (profile) => profile?.display_name || (profile?.username ? "@" + profile.username : "Amora member");
  const elapsed = (date) => {
    const mins = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
    if (mins < 1) return "Just now";
    if (mins < 60) return mins + "m ago";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h ago";
    return Math.floor(hours / 24) + "d ago";
  };
  function stopViewerTimers() {
    if (advanceTimer) clearTimeout(advanceTimer);
    if (progressTimer) clearInterval(progressTimer);
    advanceTimer = null; progressTimer = null;
    if (currentVideo) { currentVideo.pause(); currentVideo = null; }
  }
  function pauseStoryForMenu() {
    if (pausedStoryState) return;
    const segment = viewerProgress.children[activeIndex]?.firstElementChild;
    pausedStoryState = {
      remaining: advanceTimer ? Math.max(0, (advanceTimer._amoraDueAt || Date.now()) - Date.now()) : 0,
      progress: segment ? segment.style.width : "",
      videoTime: currentVideo ? currentVideo.currentTime : null,
      wasVideo: Boolean(currentVideo)
    };
    if (advanceTimer) clearTimeout(advanceTimer);
    if (progressTimer) clearInterval(progressTimer);
    advanceTimer = null;
    progressTimer = null;
    if (currentVideo) currentVideo.pause();
  }
  function resumeStoryAfterMenu() {
    if (!pausedStoryState || viewer.hidden || moreMenu?.hidden === false || commentsPanel?.hidden === false) return;
    const saved = pausedStoryState;
    pausedStoryState = null;
    const segment = viewerProgress.children[activeIndex]?.firstElementChild;
    if (currentVideo) {
      currentVideo.play().catch(() => {});
      if (saved.wasVideo && currentVideo.duration) {
        const duration = currentVideo.duration;
        progressTimer = setInterval(() => {
          if (segment) segment.style.width = Math.min(100, (currentVideo.currentTime / duration) * 100) + "%";
        }, 80);
      }
      return;
    }
    const width = Number.parseFloat(saved.progress) || 0;
    const remaining = saved.remaining || Math.max(250, 5000 * (1 - width / 100));
    const start = Date.now();
    progressTimer = setInterval(() => {
      if (segment) segment.style.width = Math.min(100, width + ((Date.now() - start) / remaining) * (100 - width)) + "%";
    }, 80);
    advanceTimer = setTimeout(() => nextStory(), remaining);
    advanceTimer._amoraDueAt = Date.now() + remaining;
  }
  async function getSignedUrl(story) {
    if (signedUrlCache.has(story.id)) return signedUrlCache.get(story.id);
    const storage = db.storage.from(BUCKET);
    const signed = await storage.createSignedUrl(story.media_path, 300);
    if (!signed.error && signed.data?.signedUrl) {
      signedUrlCache.set(story.id, signed.data.signedUrl);
      return signed.data.signedUrl;
    }
    console.warn("Amora signed story URL failed; trying authenticated media download:", signed.error?.message);
    const downloaded = await storage.download(story.media_path);
    if (downloaded.error || !downloaded.data) throw downloaded.error || new Error("Story media is unavailable.");
    const objectUrl = URL.createObjectURL(downloaded.data);
    signedUrlCache.set(story.id, objectUrl);
    return objectUrl;
  }
  async function loadStories() {
    row.innerHTML = '<p class="stories-loading">Loading stories…</p>';
    const auth = await db.auth.getUser();
    currentUser = auth.data?.user || null;
    if (createButton) { createButton.disabled = !currentUser; createButton.title = currentUser ? "Share a story" : "Sign in to share a story"; }
    if (composerStoryButton) composerStoryButton.disabled = !currentUser;
    if (!currentUser) {
      row.innerHTML = '<p class="stories-empty">Sign in to view and share stories.</p>';
      return;
    }
    const { data: muteRows } = await db.from("story_mutes").select("muted_user_id").eq("user_id", currentUser.id);
    mutedUserIds = new Set((muteRows || []).map(item => item.muted_user_id));
    const { data, error } = await db.from("stories")
      .select("id,user_id,media_path,media_type,caption,visibility,created_at,expires_at")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true });
    if (error) {
      row.innerHTML = '<p class="stories-empty">Stories could not load right now.</p>';
      say("Stories could not load. Please refresh the page.");
      console.error("Amora stories load failed:", error);
      return;
    }
    const stories = (data || []).filter(story => story.user_id === currentUser.id || !mutedUserIds.has(story.user_id));
    const ids = [...new Set(stories.map(s => s.user_id))];
    let profiles = [];
    if (ids.length) {
      const result = await db.from("profiles").select("id,username,display_name").in("id", ids);
      if (!result.error) profiles = result.data || [];
    }
    const profileMap = new Map(profiles.map(p => [p.id, p]));
    const grouped = new Map();
    stories.forEach(s => {
      if (!grouped.has(s.user_id)) grouped.set(s.user_id, []);
      grouped.get(s.user_id).push({...s, profile: profileMap.get(s.user_id) || null});
    });
    storyGroups = [...grouped.entries()].map(([userId, items]) => ({userId, items, profile: items[items.length - 1].profile}))
      .sort((a,b) => (a.userId === currentUser.id ? -1 : b.userId === currentUser.id ? 1 : new Date(b.items[b.items.length-1].created_at) - new Date(a.items[a.items.length-1].created_at)));
    renderRow();
  }
  function renderRow() {
    row.innerHTML = "";
    const own = storyGroups.find(g => g.userId === currentUser?.id);
    const create = document.createElement("button");
    create.type = "button"; create.className = "story-person is-own";
    create.setAttribute("aria-label", own ? "View your story or add another" : "Add your story");
    create.innerHTML = '<span class="story-ring"><span class="story-avatar">' + (own ? escapeHtml(initials(nameFor(own.profile))) : "＋") + '</span></span><span class="story-person-name">Your story</span>';
    create.addEventListener("click", () => {
      if (own) {
        openViewer(storyGroups.indexOf(own), 0);
        return;
      }
      const composer = document.getElementById("composer-dialog");
      const quickComposer = document.querySelector(".feed-quick-composer");
      if (composer) {
        composer.hidden = false;
        requestAnimationFrame(() => composer.classList.add("is-expanded"));
        quickComposer?.setAttribute("aria-expanded", "true");
      }
      window.setTimeout(() => fileInput.click(), composer ? 180 : 0);
    });
    row.appendChild(create);
    storyGroups.filter(g => g.userId !== currentUser?.id).forEach(group => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "story-person";
      const label = nameFor(group.profile);
      button.setAttribute("aria-label", "View story by " + label);
      button.innerHTML = '<span class="story-ring has-story"><span class="story-avatar">' + escapeHtml(initials(label)) + '</span></span><span class="story-person-name">' + escapeHtml(label) + '</span>';
      button.addEventListener("click", () => openViewer(storyGroups.indexOf(group), 0));
      row.appendChild(button);
    });
    if (!storyGroups.length) {
      const empty = document.createElement("span");
      empty.className = "stories-empty";
      empty.textContent = "Be the first to share a moment.";
      row.appendChild(empty);
    }
  }
  async function validateVideo(file) {
    if (!file.type.startsWith("video/")) return true;
    return new Promise((resolve, reject) => {
      const probe = document.createElement("video");
      const url = URL.createObjectURL(file);
      probe.preload = "metadata";
      probe.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        if (!Number.isFinite(probe.duration) || probe.duration <= 0) reject(new Error("This video could not be read."));
        else if (probe.duration > MAX_VIDEO_SECONDS + 0.15) reject(new Error("Stories videos must be 60 seconds or shorter."));
        else resolve(true);
      };
      probe.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This video could not be read.")); };
      probe.src = url;
    });
  }
  const beginCreateStory = () => {
    if (!currentUser) { say("Please sign in before sharing a story."); return; }
    fileInput.click();
  };
  createButton?.addEventListener("click", beginCreateStory);
  composerStoryButton?.addEventListener("click", beginCreateStory);
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = "";
    if (!currentUser) { say("Please sign in before sharing a story."); return; }
    const allowed = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"];
    if (!allowed.includes(file.type)) { say("Choose a JPG, PNG, WebP, GIF, MP4, WebM, or MOV file."); return; }
    if (file.size > MAX_FILE_BYTES) { say("Stories media must be 50 MB or smaller."); return; }
    if (createButton) createButton.disabled = true;
    if (composerStoryButton) composerStoryButton.disabled = true;
    say("Checking and uploading your story…");
    let uploadedPath = null;
    try {
      await validateVideo(file);
      const extension = (file.name.split(".").pop() || (file.type.startsWith("video/") ? "mp4" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g,"") || "bin";
      const unique = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
      uploadedPath = currentUser.id + "/" + unique + "." + extension;
      const upload = await db.storage.from(BUCKET).upload(uploadedPath, file, {contentType:file.type, cacheControl:"300", upsert:false});
      if (upload.error) throw upload.error;
      const created = new Date();
      const expires = new Date(created.getTime() + 24 * 60 * 60 * 1000);
      const inserted = await db.from("stories").insert({
        user_id: currentUser.id, media_path: uploadedPath,
        media_type: file.type.startsWith("video/") ? "video" : "image",
        caption: "", visibility: "public", created_at: created.toISOString(), expires_at: expires.toISOString()
      });
      if (inserted.error) throw inserted.error;
      say("Your story is live for 24 hours.");
      signedUrlCache.clear();
      await loadStories();
    } catch (err) {
      if (uploadedPath) {
        try { await db.storage.from(BUCKET).remove([uploadedPath]); } catch (_) {}
      }
      console.error("Amora story upload failed:", err);
      say(err?.message || "Your story could not be uploaded. Please try again.");
    } finally {
      if (createButton) createButton.disabled = !currentUser;
      if (composerStoryButton) composerStoryButton.disabled = !currentUser;
    }
  });

  async function openViewer(groupIndex, itemIndex) {
    if (groupIndex < 0 || groupIndex >= storyGroups.length) return;
    activeGroup = groupIndex; activeIndex = itemIndex;
    viewer.hidden = false;
    document.body.style.overflow = "hidden";
    await renderViewerStory();
  }
  async function renderViewerStory() {
    stopViewerTimers();
    const group = storyGroups[activeGroup];
    const story = group?.items[activeIndex];
    if (!story) { closeViewer(); return; }
    activeStory = story;
    if (commentsPanel) commentsPanel.hidden = true;
    if (commentsList) commentsList.replaceChildren();
    if (moreMenu) moreMenu.hidden = true;
    if (moreButton) moreButton.setAttribute("aria-expanded", "false");
    if (likeButton) { likeButton.disabled = !currentUser || story.user_id === currentUser.id; likeButton.textContent = "♡ Like"; }
    if (commentToggle) commentToggle.disabled = !currentUser || story.user_id === currentUser.id;
    if (shareButton) shareButton.disabled = !currentUser;
    viewerProgress.innerHTML = group.items.map((_,i) => '<span class="story-progress-segment"><span style="width:' + (i < activeIndex ? "100%" : "0%") + '"></span></span>').join("");
    viewerName.textContent = nameFor(group.profile);
    viewerAvatar.textContent = initials(nameFor(group.profile));
    viewerTime.textContent = elapsed(story.created_at);
    viewerCaption.textContent = story.caption || "";
    viewerCaption.hidden = !story.caption;
    viewerMedia.innerHTML = '<span>Loading story…</span>';
    try {
      const url = await getSignedUrl(story);
      if (viewer.hidden || storyGroups[activeGroup]?.items[activeIndex]?.id !== story.id) return;
      viewerMedia.innerHTML = "";
      refreshStoryLikeState();
      if (story.media_type === "video") {
        const video = document.createElement("video");
        video.src = url; video.autoplay = true; video.playsInline = true; video.controls = true; video.preload = "metadata";
        viewerMedia.appendChild(video); currentVideo = video;
        video.onended = () => nextStory();
        video.onloadedmetadata = () => {
          const duration = Math.min(60, video.duration || 60);
          const segment = viewerProgress.children[activeIndex]?.firstElementChild;
          if (!segment) return;
          const start = performance.now();
          progressTimer = setInterval(() => { segment.style.width = Math.min(100, ((performance.now()-start)/(duration*1000))*100) + "%"; }, 80);
        };
        video.play().catch(() => {});
      } else {
        const img = document.createElement("img");
        img.alt = "Story shared by " + nameFor(group.profile); img.src = url;
        viewerMedia.appendChild(img);
        const segment = viewerProgress.children[activeIndex]?.firstElementChild;
        const start = Date.now();
        viewerStartedAt = start;
        progressTimer = setInterval(() => {
          if (segment) segment.style.width = Math.min(100, ((Date.now()-start)/5000)*100) + "%";
        }, 50);
        advanceTimer = setTimeout(() => nextStory(), 5000);
        advanceTimer._amoraDueAt = Date.now() + 5000;
      }
    } catch (err) {
      console.error("Amora story media could not open:", err);
      viewerMedia.textContent = "This story is unavailable or has expired.";
      advanceTimer = setTimeout(() => nextStory(), 1600);
    }
  }
  function nextStory() {
    stopViewerTimers();
    const group = storyGroups[activeGroup];
    if (group && activeIndex + 1 < group.items.length) { activeIndex++; renderViewerStory(); return; }
    if (activeGroup + 1 < storyGroups.length) { activeGroup++; activeIndex = 0; renderViewerStory(); return; }
    closeViewer();
  }
  function previousStory() {
    stopViewerTimers();
    if (activeIndex > 0) { activeIndex--; renderViewerStory(); return; }
    if (activeGroup > 0) { activeGroup--; activeIndex = storyGroups[activeGroup].items.length - 1; renderViewerStory(); }
    else renderViewerStory();
  }
  function closeViewer() {
    stopViewerTimers(); viewer.hidden = true; viewerMedia.innerHTML = ""; document.body.style.overflow = ""; activeStory = null;
    if (commentsPanel) commentsPanel.hidden = true;
    if (moreMenu) moreMenu.hidden = true;
  }

  async function refreshStoryLikeState() {
    if (!activeStory || !currentUser || !likeButton) return;
    const { data, error } = await db.from("story_likes").select("story_id").eq("story_id", activeStory.id).eq("user_id", currentUser.id).maybeSingle();
    if (error) { say("Couldn't load the story like status."); return; }
    likeButton.textContent = data ? "♥ Liked" : "♡ Like";
    likeButton.classList.toggle("is-liked", Boolean(data));
  }
  likeButton?.addEventListener("click", async () => {
    if (!activeStory || !currentUser || activeStory.user_id === currentUser.id) return;
    likeButton.disabled = true;
    try {
      const { data: existing, error: readError } = await db.from("story_likes").select("story_id").eq("story_id", activeStory.id).eq("user_id", currentUser.id).maybeSingle();
      if (readError) throw readError;
      if (existing) {
        const { error } = await db.from("story_likes").delete().eq("story_id", activeStory.id).eq("user_id", currentUser.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("story_likes").insert({story_id:activeStory.id,user_id:currentUser.id});
        if (error) throw error;
      }
      await refreshStoryLikeState();
    } catch (err) { say(err?.message || "Couldn't update this story like."); }
    finally { likeButton.disabled = false; }
  });
  async function loadStoryComments() {
    if (!activeStory || !commentsList) return;
    commentsList.replaceChildren();
    const { data, error } = await db.from("story_comments").select("id,user_id,content,created_at").eq("story_id", activeStory.id).order("created_at", {ascending:true});
    if (error) { commentsList.textContent = "Comments could not load."; return; }
    const comments = data || [];
    const userIds = [...new Set(comments.map(item => item.user_id))];
    let profiles = [];
    if (userIds.length) {
      const result = await db.from("profiles").select("id,username,display_name").in("id", userIds);
      if (!result.error) profiles = result.data || [];
    }
    const profileMap = new Map(profiles.map(profile => [profile.id,profile]));
    if (!comments.length) { commentsList.textContent = "Be the first to comment."; return; }
    comments.forEach(item => {
      const entry = document.createElement("article");
      entry.className = "story-comment";
      const author = document.createElement("strong");
      author.textContent = nameFor(profileMap.get(item.user_id));
      const body = document.createElement("p");
      body.textContent = item.content;
      const time = document.createElement("small");
      time.textContent = elapsed(item.created_at);
      entry.append(author,body,time);
      commentsList.appendChild(entry);
    });
  }
  commentToggle?.addEventListener("click", async () => {
    if (!currentUser || !activeStory || activeStory.user_id === currentUser.id) return;
    const opening = commentsPanel.hidden;
    if (opening) pauseStoryForMenu();
    commentsPanel.hidden = !opening;
    if (opening) { await loadStoryComments(); commentInput?.focus(); }
    else resumeStoryAfterMenu();
  });
  commentForm?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!activeStory || !currentUser) return;
    const content = commentInput.value.trim();
    if (!content) return;
    const submit = commentForm.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const { error } = await db.from("story_comments").insert({story_id:activeStory.id,user_id:currentUser.id,content});
      if (error) throw error;
      commentInput.value = "";
      await loadStoryComments();
    } catch (err) { say(err?.message || "Couldn't send this comment."); }
    finally { submit.disabled = false; }
  });
  shareButton?.addEventListener("click", async () => {
    if (!activeStory || !currentUser) return;
    shareButton.disabled = true;
    let newPath = null;
    try {
      const sourceUrl = await getSignedUrl(activeStory);
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error("The story media could not be fetched.");
      const blob = await response.blob();
      const extension = activeStory.media_path.split(".").pop() || (activeStory.media_type === "video" ? "mp4" : "jpg");
      newPath = currentUser.id + "/" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)) + "." + extension;
      const upload = await db.storage.from(BUCKET).upload(newPath, blob, {contentType:blob.type || (activeStory.media_type === "video" ? "video/mp4" : "image/jpeg"),cacheControl:"300",upsert:false});
      if (upload.error) throw upload.error;
      const created = new Date();
      const inserted = await db.from("stories").insert({user_id:currentUser.id,media_path:newPath,media_type:activeStory.media_type,caption:"Shared story",visibility:"public",created_at:created.toISOString(),expires_at:new Date(created.getTime()+86400000).toISOString()});
      if (inserted.error) throw inserted.error;
      say("Shared to your story.");
      signedUrlCache.clear();
      await loadStories();
    } catch (err) {
      if (newPath) await db.storage.from(BUCKET).remove([newPath]);
      say(err?.message || "Couldn't share this story.");
    } finally { shareButton.disabled = false; }
  });
  moreButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!moreMenu || !activeStory) return;
    const opening = moreMenu.hidden;
    if (opening) {
      pauseStoryForMenu();
      commentsPanel.hidden = true;
    }
    moreMenu.hidden = !opening;
    moreButton.setAttribute("aria-expanded", String(opening));
    if (!opening) resumeStoryAfterMenu();
  });
  moreMenu?.querySelectorAll("[data-story-action]").forEach(button => button.addEventListener("click", async () => {
    if (!activeStory) return;
    const action = button.dataset.storyAction;
    moreMenu.hidden = true;
    moreButton?.setAttribute("aria-expanded", "false");
    if (action === "create") { beginCreateStory(); return; }
    if (!currentUser) { say("Please sign in to manage story safety."); return; }
    if (action === "mute") {
      if (activeStory.user_id === currentUser.id) { say("You cannot mute your own stories."); return; }
      try {
        const { error } = await db.from("story_mutes").insert({user_id:currentUser.id,muted_user_id:activeStory.user_id});
        if (error && error.code !== "23505") throw error;
        say("Stories from this person are now muted.");
        closeViewer();
        await loadStories();
      } catch (err) { say(err?.message || "Couldn't mute this person's stories."); }
    } else if (action === "report") {
      if (activeStory.user_id === currentUser.id) { say("You cannot report your own story."); return; }
      const reason = window.prompt("Why are you reporting this story? Enter spam, harassment, nudity, violence, scam, or other.");
      if (!reason) return;
      const normalized = reason.trim().toLowerCase();
      if (!["spam","harassment","nudity","violence","scam","other"].includes(normalized)) { say("Choose spam, harassment, nudity, violence, scam, or other."); return; }
      const details = window.prompt("Add details (optional, up to 1000 characters).") || "";
      try {
        const { error } = await db.from("story_reports").insert({story_id:activeStory.id,reporter_id:currentUser.id,reason:normalized,details:details.slice(0,1000)});
        if (error) throw error;
        say("Report submitted. Thank you for helping keep Amora safe.");
      } catch (err) { say(err?.code === "23505" ? "You have already reported this story." : err?.message || "Couldn't report this story."); }
    }
  }));

  closeButton.addEventListener("click", closeViewer);
  nextButton.addEventListener("click", nextStory);
  prevButton.addEventListener("click", previousStory);
  let swipeStartX = 0;
  let swipeStartY = 0;
  viewer.addEventListener("touchstart", event => {
    if (viewer.hidden || moreMenu?.hidden === false || commentsPanel?.hidden === false) return;
    const touch = event.changedTouches[0];
    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
  }, { passive: true });
  viewer.addEventListener("touchend", event => {
    if (viewer.hidden || moreMenu?.hidden === false || commentsPanel?.hidden === false) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - swipeStartX;
    const dy = touch.clientY - swipeStartY;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (dx < 0) nextStory();
    else previousStory();
  }, { passive: true });
  viewer.addEventListener("click", e => { if (e.target === viewer) closeViewer(); });
  document.addEventListener("keydown", e => {
    if (viewer.hidden) return;
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowRight") nextStory();
    if (e.key === "ArrowLeft") previousStory();
  });
  db.auth.onAuthStateChange(() => { setTimeout(loadStories, 0); });
  loadStories();
});
