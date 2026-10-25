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
  const storyComposer = document.getElementById("story-create-dialog");
  const storyComposerCaption = document.getElementById("story-create-caption");
  const storyComposerPreview = document.getElementById("story-create-preview");
  const storyComposerChoose = document.getElementById("story-create-choose");
  const storyComposerPublish = document.getElementById("story-create-publish");
  const storyComposerClose = document.getElementById("story-create-close");
  let pendingStoryFile = null;
  let previewObjectUrl = null;
  let storyPaused = false;
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
    if (storyPaused) return;
    storyPaused = true;
    const segment = viewerProgress.children[activeIndex]?.firstElementChild;
    pausedStoryState = { remaining: advanceTimer ? Math.max(0, (advanceTimer._amoraDueAt || Date.now()) - Date.now()) : 0, progress: segment ? Number.parseFloat(segment.style.width) || 0 : 0, videoTime: currentVideo ? currentVideo.currentTime : null, wasVideo: Boolean(currentVideo) };
    if (advanceTimer) clearTimeout(advanceTimer);
    if (progressTimer) clearInterval(progressTimer);
    advanceTimer = null; progressTimer = null;
    if (currentVideo) currentVideo.pause();
  }
  function resumeStoryAfterMenu() {
    if (!storyPaused || viewer.hidden || moreMenu?.hidden === false || commentsPanel?.hidden === false) return;
    storyPaused = false;
    const saved = pausedStoryState || {remaining:0,progress:0,wasVideo:false};
    pausedStoryState = null;
    const segment = viewerProgress.children[activeIndex]?.firstElementChild;
    if (currentVideo && saved.wasVideo) {
      if (Number.isFinite(saved.videoTime)) currentVideo.currentTime = saved.videoTime;
      const video = currentVideo;
      video.play().catch(() => {});
      progressTimer = setInterval(() => { if (segment && video.duration) segment.style.width = Math.min(100, (video.currentTime / video.duration) * 100) + "%"; }, 80);
      return;
    }
    const remaining = Math.max(250, saved.remaining || 5000 * (1 - saved.progress / 100));
    const started = Date.now();
    progressTimer = setInterval(() => { if (!storyPaused && segment) segment.style.width = Math.min(100, saved.progress + ((Date.now() - started) / remaining) * (100 - saved.progress)) + "%"; }, 80);
    advanceTimer = setTimeout(() => { if (!storyPaused && commentsPanel?.hidden !== false && moreMenu?.hidden !== false) nextStory(); }, remaining);
    advanceTimer._amoraDueAt = Date.now() + remaining;
  }
  async function getSignedUrl(story) {
    const cached = signedUrlCache.get(story.id);
    if (cached && cached.expiresAt > Date.now() + 15000) return cached.url;
    const storage = db.storage.from(BUCKET);
    const signed = await storage.createSignedUrl(story.media_path, 1800);
    if (!signed.error && signed.data?.signedUrl) {
      signedUrlCache.set(story.id, {url:signed.data.signedUrl,expiresAt:Date.now()+1700000});
      return signed.data.signedUrl;
    }
    console.warn("Amora signed story URL failed; trying authenticated media download:", signed.error?.message);
    const downloaded = await storage.download(story.media_path);
    if (downloaded.error || !downloaded.data) throw downloaded.error || new Error("Story media is unavailable.");
    const objectUrl = URL.createObjectURL(downloaded.data);
    signedUrlCache.set(story.id, {url:objectUrl,expiresAt:Date.now()+1700000});
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
    pendingStoryFile = null;
    if (storyComposerCaption) storyComposerCaption.value = "";
    if (storyComposerPreview) storyComposerPreview.replaceChildren();
    if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
    if (storyComposerPublish) storyComposerPublish.disabled = true;
    if (storyComposer) storyComposer.hidden = false;
    document.body.style.overflow = "hidden";
  };
  createButton?.addEventListener("click", beginCreateStory);
  composerStoryButton?.addEventListener("click", beginCreateStory);
  storyComposerChoose?.addEventListener("click", () => fileInput.click());
  storyComposerClose?.addEventListener("click", () => {
    if (storyComposer) storyComposer.hidden = true;
    pendingStoryFile = null;
    if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
    if (storyComposerPreview) storyComposerPreview.replaceChildren();
    document.body.style.overflow = "";
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0]; fileInput.value = ""; if (!file) return;
    const allowed = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"];
    if (!allowed.includes(file.type)) { say("Choose a JPG, PNG, WebP, GIF, MP4, WebM, or MOV file."); return; }
    if (file.size > MAX_FILE_BYTES) { say("Stories media must be 50 MB or smaller."); return; }
    pendingStoryFile = file;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);
    if (storyComposerPreview) {
      storyComposerPreview.replaceChildren();
      const preview = document.createElement(file.type.startsWith("video/") ? "video" : "img");
      preview.src = previewObjectUrl; preview.alt = "Story preview";
      if (preview.tagName === "VIDEO") { preview.controls = true; preview.playsInline = true; }
      storyComposerPreview.appendChild(preview);
    }
    if (storyComposerPublish) storyComposerPublish.disabled = false;
  });
  storyComposerPublish?.addEventListener("click", async () => {
    const file = pendingStoryFile; if (!file || !currentUser) return;
    storyComposerPublish.disabled = true; if (storyComposerChoose) storyComposerChoose.disabled = true;
    say("Checking and uploading your story…");
    let uploadedPath = null;
    try {
      await validateVideo(file);
      const extension = (file.name.split(".").pop() || (file.type.startsWith("video/") ? "mp4" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g,"") || "bin";
      const unique = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
      uploadedPath = currentUser.id + "/" + unique + "." + extension;
      const upload = await db.storage.from(BUCKET).upload(uploadedPath,file,{contentType:file.type,cacheControl:"300",upsert:false});
      if (upload.error) throw upload.error;
      const created = new Date();
      const caption = (storyComposerCaption?.value || "").trim().slice(0,500);
      const inserted = await db.from("stories").insert({user_id:currentUser.id,media_path:uploadedPath,media_type:file.type.startsWith("video/")?"video":"image",caption,visibility:"public",created_at:created.toISOString(),expires_at:new Date(created.getTime()+86400000).toISOString()}).select("id").single();
      if (inserted.error) throw inserted.error;
      if (storyComposer) storyComposer.hidden = true; document.body.style.overflow = ""; pendingStoryFile = null;
      if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
      if (storyComposerPreview) storyComposerPreview.replaceChildren(); signedUrlCache.clear(); await loadStories();
      say("Your story is live for 24 hours.");
      const ownIndex = storyGroups.findIndex(group => group.userId === currentUser.id);
      if (ownIndex >= 0) openViewer(ownIndex,Math.max(0,storyGroups[ownIndex].items.findIndex(item => item.id === inserted.data.id)));
    } catch (err) {
      if (uploadedPath) { try { await db.storage.from(BUCKET).remove([uploadedPath]); } catch (_) {} }
      console.error("Amora story upload failed:",err); say(err?.message || "Your story could not be uploaded. Please try again.");
      if (storyComposerPublish) storyComposerPublish.disabled = !pendingStoryFile;
    } finally { if (storyComposerChoose) storyComposerChoose.disabled = false; }
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
    storyPaused = false;
    pausedStoryState = null;
    const group = storyGroups[activeGroup];
    const story = group?.items[activeIndex];
    if (!story) { closeViewer(); return; }
    activeStory = story;
    if (commentsPanel) commentsPanel.hidden = true;
    if (commentsList) commentsList.replaceChildren();
    if (moreMenu) moreMenu.hidden = true;
    if (moreButton) moreButton.setAttribute("aria-expanded", "false");
    moreMenu?.querySelectorAll("[data-story-action]").forEach(button => {
      if (button.dataset.storyAction === "delete") button.hidden = story.user_id !== currentUser?.id;
      if (button.dataset.storyAction === "report" || button.dataset.storyAction === "mute") button.hidden = story.user_id === currentUser?.id;
    });
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
        video.onended = () => { if (!storyPaused && commentsPanel?.hidden !== false && moreMenu?.hidden !== false) nextStory(); };
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
        advanceTimer = setTimeout(() => { if (!storyPaused && commentsPanel?.hidden !== false && moreMenu?.hidden !== false) nextStory(); }, 5000);
        advanceTimer._amoraDueAt = Date.now() + 5000;
      }
    } catch (err) {
      console.error("Amora story media could not open:", err);
      viewerMedia.textContent = "This story media could not load. Close and retry.";
      console.error("Story media failed:", story.id, story.media_path);
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
    storyPaused = false;
    pausedStoryState = null;
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
    const storyBeingManaged = activeStory;
    moreMenu.hidden = true;
    moreButton?.setAttribute("aria-expanded", "false");
    if (action === "create") { resumeStoryAfterMenu(); beginCreateStory(); return; }
    if (!currentUser) { say("Please sign in to manage story safety."); resumeStoryAfterMenu(); return; }
    if (action === "delete") {
      if (storyBeingManaged.user_id !== currentUser.id) { say("You can only delete your own story."); resumeStoryAfterMenu(); return; }
      if (!window.confirm("Delete this story? This cannot be undone.")) { resumeStoryAfterMenu(); return; }
      try {
        const result = await db.from("stories").delete().eq("id",storyBeingManaged.id).eq("user_id",currentUser.id);
        if (result.error) throw result.error;
        try { await db.storage.from(BUCKET).remove([storyBeingManaged.media_path]); } catch (storageError) { console.warn("Story media cleanup failed:",storageError); }
        signedUrlCache.delete(storyBeingManaged.id);
        closeViewer();
        await loadStories();
        say("Your story was deleted.");
      } catch (err) { say(err?.message || "Could not delete this story."); resumeStoryAfterMenu(); }
      return;
    }
    if (action === "mute") {
      if (storyBeingManaged.user_id === currentUser.id) { resumeStoryAfterMenu(); return; }
      try {
        const result = await db.from("story_mutes").insert({user_id:currentUser.id,muted_user_id:storyBeingManaged.user_id});
        if (result.error && result.error.code !== "23505") throw result.error;
        closeViewer(); await loadStories(); say("Stories from this person are now muted.");
      } catch (err) { say(err?.message || "Could not mute this person’s stories."); resumeStoryAfterMenu(); }
    } else if (action === "report") {
      if (storyBeingManaged.user_id === currentUser.id) { resumeStoryAfterMenu(); return; }
      const reason = window.prompt("Why are you reporting this story? Enter spam, harassment, nudity, violence, scam, or other.");
      if (!reason) { resumeStoryAfterMenu(); return; }
      const normalized = reason.trim().toLowerCase();
      if (!["spam","harassment","nudity","violence","scam","other"].includes(normalized)) { say("Choose spam, harassment, nudity, violence, scam, or other."); resumeStoryAfterMenu(); return; }
      const details = window.prompt("Add details (optional, up to 1000 characters).") || "";
      try {
        const result = await db.from("story_reports").insert({story_id:storyBeingManaged.id,reporter_id:currentUser.id,reason:normalized,details:details.slice(0,1000)});
        if (result.error) throw result.error;
        say("Report submitted. Thank you for helping keep Amora safe.");
      } catch (err) { say(err?.code === "23505" ? "You have already reported this story." : err?.message || "Could not report this story."); }
      resumeStoryAfterMenu();
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
