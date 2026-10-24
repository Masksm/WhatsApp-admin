"use strict";
document.addEventListener("DOMContentLoaded", () => {
  const db = window.amoraSupabase;
  const row = document.getElementById("stories-row");
  const status = document.getElementById("stories-status");
  const createButton = document.getElementById("story-create-button");
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
  if (!db || !row || !createButton || !fileInput || !viewer) return;

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
  async function getSignedUrl(story) {
    if (signedUrlCache.has(story.id)) return signedUrlCache.get(story.id);
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(story.media_path, 300);
    if (error) throw error;
    signedUrlCache.set(story.id, data.signedUrl);
    return data.signedUrl;
  }
  async function loadStories() {
    row.innerHTML = '<p class="stories-loading">Loading stories…</p>';
    const auth = await db.auth.getUser();
    currentUser = auth.data?.user || null;
    createButton.disabled = !currentUser;
    createButton.title = currentUser ? "Share a story" : "Sign in to share a story";
    if (!currentUser) {
      row.innerHTML = '<p class="stories-empty">Sign in to view and share stories.</p>';
      return;
    }
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
    const stories = data || [];
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
    create.addEventListener("click", () => own ? openViewer(storyGroups.indexOf(own), 0) : fileInput.click());
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
  createButton.addEventListener("click", () => {
    if (!currentUser) { say("Please sign in before sharing a story."); return; }
    fileInput.click();
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = "";
    if (!currentUser) { say("Please sign in before sharing a story."); return; }
    const allowed = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"];
    if (!allowed.includes(file.type)) { say("Choose a JPG, PNG, WebP, GIF, MP4, WebM, or MOV file."); return; }
    if (file.size > MAX_FILE_BYTES) { say("Stories media must be 50 MB or smaller."); return; }
    createButton.disabled = true;
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
      createButton.disabled = !currentUser;
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
    stopViewerTimers(); viewer.hidden = true; viewerMedia.innerHTML = ""; document.body.style.overflow = "";
  }
  closeButton.addEventListener("click", closeViewer);
  nextButton.addEventListener("click", nextStory);
  prevButton.addEventListener("click", previousStory);
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
