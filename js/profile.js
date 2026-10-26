"use strict";

document.addEventListener("DOMContentLoaded", () => {
  // If the user came directly from Home, the Home nav should return to that
  // preserved document instead of requesting social-home.html again.
  const homePath = "/pages/social-home.html";
  let previousPath = "";
  try { previousPath = new URL(document.referrer).pathname; } catch (_) {}
  document.querySelectorAll('a[href="/pages/social-home.html"]').forEach(link => {
    link.addEventListener("click", event => {
      if (previousPath === homePath && history.length > 1) {
        event.preventDefault();
        history.back();
      }
    });
  });
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

  const followListDialog = byId("follow-list-dialog");
  const followListItems = byId("follow-list-items");
  let followListMode = "followers";
  function closeFollowList() {
    if (followListDialog) followListDialog.hidden = true;
  }
  async function loadFollowList(mode) {
    if (!viewedProfile || !followListItems || !followListDialog) return;
    followListMode = mode;
    const isFollowingList = mode === "following";
    setText("follow-list-title", isFollowingList ? "Following" : "Followers");
    followListDialog.hidden = false;
    followListItems.replaceChildren(node("p", "follow-list-empty", "Loading accounts…"));
    try {
      const { data: ordered, error } = await supabase.rpc("get_public_follow_list", {
        p_profile_id: viewedProfile.id,
        p_mode: mode
      });
      if (error) throw error;
      const accounts = (ordered || []).filter(profile => profile && profile.username);
      if (!accounts.length) {
        followListItems.replaceChildren(node("p", "follow-list-empty", isFollowingList ? "This account is not following anyone yet." : "This account has no followers yet."));
        return;
      }
      followListItems.replaceChildren();
      for (const profile of accounts) {
        const item = node("div", "follow-list-item");
        const identity = node("a", "follow-list-identity");
        identity.href = "/pages/profile.html?username=" + encodeURIComponent(profile.username);
        const avatar = node("span", "follow-list-avatar", (profile.display_name || profile.username).trim().slice(0,1).toUpperCase() || "?");
        const copy = node("span", "follow-list-copy");
        copy.append(node("strong", "", profile.display_name || profile.username), node("small", "", "@" + profile.username));
        identity.append(avatar, copy);
        item.append(identity);
        const isSelf = profile.id === currentUserId;
        let isAdmin = Boolean(profile.is_official);
        try {
          const { data: tier, error: tierError } = await supabase.rpc("is_amora_moderator_profile", { p_username: profile.username });
          if (!tierError && Number(tier || 0) >= 2) isAdmin = true;
        } catch (_) {}
        if (user && !isSelf && !isAdmin) {
          const follow = node("button", "follow-list-action", "Follow");
          follow.type = "button";
          follow.disabled = true;
          try {
            const { data: existing, error } = await supabase.from("user_follows").select("followed_id")
              .eq("follower_id", user.id).eq("followed_id", profile.id).maybeSingle();
            if (error) throw error;
            const following = Boolean(existing);
            follow.textContent = following ? "Following" : "Follow";
            follow.classList.toggle("is-following", following);
            follow.setAttribute("aria-pressed", String(following));
            follow.disabled = false;
            follow.addEventListener("click", async () => {
              follow.disabled = true;
              try {
                if (follow.getAttribute("aria-pressed") === "true") {
                  const { error: deleteError } = await supabase.from("user_follows").delete().eq("follower_id", user.id).eq("followed_id", profile.id);
                  if (deleteError) throw deleteError;
                  follow.textContent = "Follow";
                  follow.classList.remove("is-following");
                  follow.setAttribute("aria-pressed", "false");
                } else {
                  const { error: insertError } = await supabase.from("user_follows").insert({ follower_id: user.id, followed_id: profile.id });
                  if (insertError) throw insertError;
                  follow.textContent = "Following";
                  follow.classList.add("is-following");
                  follow.setAttribute("aria-pressed", "true");
                }
                if (viewedProfile) setStats(await loadPublicSummary(viewedProfile.username));
              } catch (error) {
                console.error("[Amora follow list]", error?.message || error);
                follow.textContent = "Try again";
              } finally { follow.disabled = false; }
            });
          } catch (_) {
            follow.textContent = "Unavailable";
          }
          item.append(follow);
        }
        followListItems.append(item);
      }
    } catch (error) {
      console.error("[Amora follow list load]", error?.message || error);
      const message=String(error?.message||"");
      const privateMessage=message.includes("followers private")?"This account's followers are private.":message.includes("following list private")?"This account's following list is private.":"Could not load this list right now. Please refresh and try again.";
      followListItems.replaceChildren(node("p", "follow-list-empty", privateMessage));
    }
  }
  byId("following-stat")?.addEventListener("click", () => loadFollowList("following"));
  byId("follower-stat")?.addEventListener("click", () => loadFollowList("followers"));
  byId("follow-list-close")?.addEventListener("click", closeFollowList);
  followListDialog?.addEventListener("click", event => { if (event.target === followListDialog) closeFollowList(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeFollowList(); });

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
    const titleNode = byId("profile-title");
    const isModerator = Number(profile.moderator_tier || 0) >= 2;
    let moderatorBadge = byId("moderator-account-badge");
    if (isModerator) {
      if (!moderatorBadge && titleNode) {
        moderatorBadge = node("span", "moderator-account-badge", "⬟");
        moderatorBadge.id = "moderator-account-badge";
        moderatorBadge.setAttribute("role", "img");
        moderatorBadge.setAttribute("aria-label", Number(profile.moderator_tier) >= 3 ? "Senior Amora moderator" : "Amora moderator");
        moderatorBadge.title = Number(profile.moderator_tier) >= 3 ? "Senior Amora moderator" : "Amora moderator";
        titleNode.append(moderatorBadge);
      }
      if (moderatorBadge) { moderatorBadge.hidden = false; if (moderatorBadge.parentElement !== titleNode) titleNode?.append(moderatorBadge); }
    } else if (moderatorBadge) moderatorBadge.hidden = true;
    let badge = byId("official-account-badge");
    if (profile.is_official && !isModerator) {
      if (!badge && titleNode) {
        badge = node("span", "official-account-badge", "✓");
        badge.id = "official-account-badge";
        badge.setAttribute("role", "img");
        badge.setAttribute("aria-label", "Verified official Amora account");
        badge.title = "Verified official Amora account";
        titleNode.append(badge);
      }
      if (badge) {
        badge.hidden = false;
        if (badge.parentElement !== titleNode) titleNode?.append(badge);
      }
    } else if (badge) {
      badge.hidden = true;
    }
    setText("profile-handle", "@" + username);
    setText("profile-avatar", displayName.slice(0, 1).toUpperCase());
    setText("sidebar-avatar", displayName.slice(0, 1).toUpperCase());
    setText("sidebar-username", "@" + username);
    setText("profile-page-title", isOwner ? "Your profile" : displayName);
    setText("profile-eyebrow", isOwner ? "YOUR AMORA SPACE" : "AMORA COMMUNITY");
    byId("profile-action-row").hidden = isOwner;
    const followButton = byId("profile-follow-button");
    const blockButton = byId("profile-block-button");
    if (isModerator) {
      byId("profile-action-row").hidden = true;
      if (followButton) followButton.hidden = true;
      if (blockButton) blockButton.hidden = true;
      byId("profile-more-button")?.setAttribute("aria-label", "Moderator account");
    } else {
      byId("profile-action-row").hidden = isOwner;
      if (followButton) {
        followButton.disabled = false;
        followButton.title = "";
      }
      if (blockButton) blockButton.hidden = false;
    }
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
    let support = byId("official-support-email");
    if (profile.is_official) {
      if (!support) {
        support = node("p", "official-support-email");
        support.id = "official-support-email";
        const label = node("strong", "", "Official Amora support: ");
        const emailLink = node("a", "", profile.support_email || "Amora.support.team@gmail.com");
        emailLink.href = "mailto:" + (profile.support_email || "Amora.support.team@gmail.com");
        support.append(label, emailLink);
        const hero = document.querySelector(".profile-hero");
        if (hero) hero.insertAdjacentElement("afterend", support);
      } else {
        const link = support.querySelector("a");
        if (link) {
          link.textContent = profile.support_email || "Amora.support.team@gmail.com";
          link.href = "mailto:" + link.textContent;
        }
      }
      support.hidden = false;
    } else if (support) {
      support.hidden = true;
    }
    let registrationMetric = byId("official-registration-count");
    if (profile.is_official && isOwner) {
      if (!registrationMetric) {
        registrationMetric = node("section", "profile-section card official-registration-card");
        registrationMetric.id = "official-registration-count";
        registrationMetric.append(node("p", "eyebrow", "AMORA COMMUNITY"), node("h2", "", "Active registered accounts"));
        const value = node("strong", "official-registration-value", "Loading…");
        value.id = "official-registration-value";
        registrationMetric.append(value);
        byId("profile-hero").insertAdjacentElement("afterend", registrationMetric);
      }
      registrationMetric.hidden = false;
      supabase.rpc("get_active_registration_count").then(({ data, error }) => {
        const value = byId("official-registration-value");
        if (!value) return;
        value.textContent = error || data === null ? "Unavailable" : Number(data).toLocaleString();
      }).catch(() => {
        const value = byId("official-registration-value");
        if (value) value.textContent = "Unavailable";
      });
    } else if (registrationMetric) {
      registrationMetric.hidden = true;
    }
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

  async function loadProfileTraits(profile) {
    const display = byId("profile-traits-display");
    if (!display) return;
    display.replaceChildren(node("p", "profile-loading", "Loading shared traits…"));
    try {
      const { data, error } = await supabase.rpc("get_public_profile_traits", { p_username: profile.username });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      renderTraits(row?.public_traits || {}, profile.id === currentUserId);
    } catch (error) {
      console.error("[Amora profile traits]", error?.message || error);
      display.replaceChildren(node("p", "profile-empty", "Public traits could not be loaded right now."));
    }
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

  async function addComment(postId, input, sendButton) {
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

  let profilePostDialog = null;
  let profilePostReplyParentId = null;
  async function openProfilePost(post, card) {
    // Use the exact Home-feed post detail dialog instead of maintaining a second,
    // behaviorally different copy on the profile page. The post detail page opens
    // the same comments dialog used by the Home feed and resolves the post by ID.
    if (!post || !post.id) {
      showStatus("This post could not be opened.", true);
      return;
    }
    const target = new URL("/pages/post.html", window.location.origin);
    target.searchParams.set("id", post.id);
    window.location.href = target.pathname + target.search;
  }

  function syncProfilePostViewport(){if(!profilePostDialog)return;const v=window.visualViewport;profilePostDialog.style.setProperty("--comments-viewport-height",Math.max(280,v?v.height:window.innerHeight)+"px");profilePostDialog.style.setProperty("--comments-viewport-top",Math.max(0,v?v.offsetTop:0)+"px");}
  function setProfilePostStatus(message,bad=false){if(!profilePostDialog)return;const el=profilePostDialog.querySelector(".profile-dialog-status");if(el){el.textContent=message||"";el.classList.toggle("is-error",bad);}}
  async function toggleProfilePostAction(table,post,button,offText,onText){if(!requireSignedIn())return;button.disabled=true;try{const {data,error}=await supabase.from(table).select("post_id").eq("post_id",post.id).eq("user_id",user.id).maybeSingle();if(error)throw error;if(data){const r=await supabase.from(table).delete().eq("post_id",post.id).eq("user_id",user.id);if(r.error)throw r.error;button.textContent=offText;}else{const r=await supabase.from(table).insert({post_id:post.id,user_id:user.id});if(r.error)throw r.error;button.textContent=onText;}await refreshProfilePostCounts();}catch(e){setProfilePostStatus(e.message||"Could not update this post.",true);}finally{button.disabled=false;}}
  function closeProfilePostMoreMenu(){const menu=profilePostDialog?.querySelector(".profile-post-more-menu");if(menu)menu.hidden=true;profilePostDialog?.querySelector('[data-detail-action="more"]')?.setAttribute("aria-expanded","false");}
  function toggleProfilePostMoreMenu(post,trigger){
    const dialog=profilePostDialog;let menu=dialog.querySelector(".profile-post-more-menu");
    if(!menu){menu=document.createElement("div");menu.className="post-more-menu profile-post-more-menu";menu.setAttribute("role","dialog");menu.setAttribute("aria-label","Post options");const header=document.createElement("div");header.className="post-more-menu-header";const title=document.createElement("strong");title.textContent="Post options";const close=document.createElement("button");close.type="button";close.className="post-more-menu-close";close.textContent="×";close.setAttribute("aria-label","Close post options");close.onclick=closeProfilePostMoreMenu;header.append(title,close);menu.append(header);dialog.querySelector(".comments-dialog-panel").append(menu);}
    if(!menu.hidden){closeProfilePostMoreMenu();return;}menu.replaceChildren();const header=document.createElement("div");header.className="post-more-menu-header";const title=document.createElement("strong");title.textContent="Post options";const close=document.createElement("button");close.type="button";close.className="post-more-menu-close";close.textContent="×";close.setAttribute("aria-label","Close post options");close.onclick=closeProfilePostMoreMenu;header.append(title,close);menu.append(header);
    const action=(label,fn,cls="")=>{const b=document.createElement("button");b.type="button";b.className="post-more-menu-item"+(cls?" "+cls:"");b.textContent=label;b.onclick=async()=>{closeProfilePostMoreMenu();try{await fn();}catch(e){setProfilePostStatus(e.message||"That action could not be completed.",true);}};menu.append(b);};
    const isOwner=Boolean(user&&post.author_id===user.id);
    action("▢ Save post",async()=>{if(!requireSignedIn())return;const {data,error}=await supabase.from("post_bookmarks").select("post_id").eq("post_id",post.id).eq("user_id",user.id).maybeSingle();if(error)throw error;if(data){const r=await supabase.from("post_bookmarks").delete().eq("post_id",post.id).eq("user_id",user.id);if(r.error)throw r.error;setProfilePostStatus("Post removed from saved items.");}else{const r=await supabase.from("post_bookmarks").insert({post_id:post.id,user_id:user.id});if(r.error)throw r.error;setProfilePostStatus("Post saved.");}});
    action("↗ Share post",async()=>{const url=window.location.origin+"/pages/post.html?id="+encodeURIComponent(post.id);if(navigator.share){await navigator.share({title:"Amora post",text:post.content||"Check out this post on Amora",url});}else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);setProfilePostStatus("Post link copied.");}else{window.prompt("Copy this post link",url);}});
    if(isOwner){action("Delete post",async()=>{if(!window.confirm("Delete this post permanently? This cannot be undone."))return;const {error}=await supabase.from("posts").delete().eq("id",post.id).eq("author_id",user.id).eq("is_anonymous",false);if(error)throw error;closeProfilePost();const card=dialog._activeCard;card?.remove();setProfilePostStatus("Post deleted.");showStatus("Post deleted.");},"post-more-delete");}
    if(!isOwner&&post.author_id&&user){action("⚑ Report post",async()=>{if(!requireSignedIn())return;const reason=window.prompt("Why are you reporting this post? (1–1000 characters)");if(reason===null)return;const trimmed=reason.trim();if(!trimmed||trimmed.length>1000)throw new Error("Enter a report reason between 1 and 1000 characters.");const {error}=await supabase.from("post_reports").insert({post_id:post.id,reporter_id:user.id,reason:trimmed});if(error?.code==="23505"){setProfilePostStatus("You have already reported this post.");return;}if(error)throw error;setProfilePostStatus("Report submitted for review.");},"post-more-report");action("⊘ Block account",async()=>{if(!window.confirm("Block this account? Their posts will be hidden from your feed."))return;const {error}=await supabase.from("user_blocks").insert({blocker_id:user.id,blocked_id:post.author_id});if(error&&error.code!=="23505")throw error;setProfilePostStatus("Account blocked.");closeProfilePost();},"post-more-report");}
    menu.hidden=false;trigger.setAttribute("aria-expanded","true");
  }
  async function refreshProfilePostCounts(){const d=profilePostDialog;if(!d?._activePost)return;const post=d._activePost;const {data}=await supabase.rpc("get_post_interaction_counts",{p_post_ids:[post.id]});const x=Array.isArray(data)?data[0]:null;const likes=Number(x?.likes_count||0),comments=Number(x?.comments_count||0),reposts=Number(x?.reposts_count||0);d.querySelector(".comments-dialog-subtitle").textContent=likes+" likes · "+comments+" comments · "+reposts+" reposts";const n=d._activeCard?.querySelector(".profile-post-stats span");if(n)n.textContent=likes+(likes===1?" like":" likes");}
  async function refreshProfilePostComments(){const d=profilePostDialog;if(!d?._activePost)return;const post=d._activePost,list=d.querySelector(".comments-dialog-list");list.replaceChildren();const loading=document.createElement("p");loading.className="comments-dialog-empty";loading.textContent="Loading conversation…";list.append(loading);try{const {data:rows,error}=await supabase.from("post_comments").select("id,author_id,content,is_anonymous,parent_comment_id,created_at").eq("post_id",post.id).order("created_at",{ascending:true}).limit(200);if(error)throw error;list.replaceChildren();if(!rows?.length){const empty=document.createElement("p");empty.className="comments-dialog-empty";empty.textContent="No comments yet. Start the conversation.";list.append(empty);return;}const ids=[...new Set(rows.filter(x=>x.author_id&&!x.is_anonymous).map(x=>x.author_id))];let map=new Map();if(ids.length){const {data}=await supabase.from("profiles").select("id,username,display_name").in("id",ids);map=new Map((data||[]).map(x=>[x.id,x]));}const byParent=new Map();rows.forEach(x=>{const k=x.parent_comment_id||"root";if(!byParent.has(k))byParent.set(k,[]);byParent.get(k).push(x);});const add=(row,depth=0)=>{const item=document.createElement("article");item.className="post-comment"+(depth?" post-comment-reply":"");item.style.marginLeft=Math.min(depth,4)*14+"px";const profile=map.get(row.author_id),head=document.createElement("div");head.className="comment-author";head.textContent=row.is_anonymous?"Anonymous":(profile?.display_name||profile?.username||"Amora member");const body=document.createElement("p");body.className="comment-content";body.textContent=row.content;const reply=document.createElement("button");reply.type="button";reply.className="comment-reply-button";reply.textContent="Reply";reply.onclick=()=>{profilePostReplyParentId=row.id;const ctx=d.querySelector(".comments-reply-context");ctx.hidden=false;ctx.querySelector(".comments-reply-label").textContent="Replying to "+head.textContent;ctx.querySelector(".comments-reply-quote").textContent=row.content;const input=d.querySelector('[name="comment-content"]');input.placeholder="Write a reply…";d.querySelector('.comments-dialog-form button[type="submit"]').textContent="Reply";input.focus({preventScroll:true});};item.append(head,body,reply);list.append(item);(byParent.get(row.id)||[]).forEach(child=>add(child,depth+1));};(byParent.get("root")||[]).forEach(row=>add(row));}catch(e){list.replaceChildren();const empty=document.createElement("p");empty.className="comments-dialog-empty";empty.textContent="Couldn't load comments. Close and try again.";list.append(empty);setProfilePostStatus("Comments could not be loaded.",true);}}
  function closeProfilePost(){if(!profilePostDialog)return;closeProfilePostMoreMenu();profilePostDialog.classList.remove("is-open");document.body.classList.remove("comments-dialog-open");window.setTimeout(()=>{if(profilePostDialog)profilePostDialog.hidden=true;},200);}

  async function renderPosts(rows) {
    postsContainer.replaceChildren();
    if (!rows.length) { renderEmptyPosts(); return; }
    for (const post of rows) {
      const article = node("article", "profile-post profile-post-card");
      article.id = "profile-post-" + post.id;
      article.dataset.postId = post.id;
      article.tabIndex = 0;
      article.setAttribute("role", "button");
      article.setAttribute("aria-label", "Open post details");
      const meta = node("div", "profile-post-meta post-header");
      const identity = node("div", "post-author-info");
      const avatar = node("span", "post-avatar", (viewedProfile?.display_name || viewedProfile?.username || "A").slice(0,1).toUpperCase());
      const authorCopy = node("div", "post-author-copy");
      authorCopy.append(node("strong", "", viewedProfile?.display_name || viewedProfile?.username || "Amora member"),
        node("small", "", "@" + (viewedProfile?.username || "member") + " · " + relativeTime(post.created_at)));
      identity.append(avatar, authorCopy);
      meta.append(identity);
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
      const content = node("p", "profile-post-content post-content", post.content || "");
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
      const stats = node("div", "profile-post-stats post-stats");
      const likesText = node("span", "", (likeCount || 0) + ((likeCount || 0) === 1 ? " like" : " likes"));
      stats.append(likesText);
      const actions = node("div", "profile-post-actions post-actions");
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
        form.addEventListener("submit", (event) => { event.preventDefault(); addComment(post.id, input, send); });
        article.insertBefore(form, actions);
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
      article.append(stats, actions);
      postsContainer.append(article);
      article.addEventListener("click", event => { if (!event.target.closest("button,input,form,a")) openProfilePost(post, article); });
      article.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button,input,form,a")) { event.preventDefault(); openProfilePost(post, article); } });
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
    const { data: moderatorTier, error: moderatorTierError } = await supabase.rpc("is_amora_moderator_profile", { p_username: viewedProfile.username });
    if (moderatorTierError) console.warn("[Amora moderator badge] Could not load moderator tier.");
    viewedProfile.moderator_tier = Number(moderatorTier || 0);
    setProfileHeader(viewedProfile);
    setStats(viewedProfile);
    await refreshFollowState();
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
    const requestedHash = window.location.hash;
    if (requestedHash === "#profile-posts") {
      requestAnimationFrame(() => postsContainer?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } else if (requestedHash.startsWith("#post-") || requestedHash.startsWith("#profile-post-")) {
      const postId = requestedHash.replace(/^#(?:post-|profile-post-)/, "");
      requestAnimationFrame(() => {
        const target = byId("profile-post-" + postId);
        (target || postsContainer)?.scrollIntoView({ behavior: "smooth", block: target ? "center" : "start" });
        if (target) {
          target.classList.add("post-highlight");
          window.setTimeout(() => target.classList.remove("post-highlight"), 2600);
        }
      });
    }
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
  async function refreshFollowState() {
    const button = byId("profile-follow-button");
    if (!button || !viewedProfile || viewedProfile.id === currentUserId || Number(viewedProfile.moderator_tier || 0) >= 2) return;
    if (!user) {
      button.textContent = "Follow";
      button.disabled = false;
      button.setAttribute("aria-pressed", "false");
      return;
    }
    const { data, error } = await supabase.from("user_follows").select("followed_id")
      .eq("follower_id", user.id).eq("followed_id", viewedProfile.id).maybeSingle();
    if (error) throw error;
    const following = Boolean(data);
    button.textContent = following ? "Following" : "Follow";
    button.setAttribute("aria-pressed", String(following));
    button.classList.toggle("is-following", following);
  }
  byId("profile-follow-button")?.addEventListener("click", async () => {
    const button = byId("profile-follow-button");
    if (!viewedProfile || viewedProfile.id === currentUserId || Number(viewedProfile.moderator_tier || 0) >= 2) return;
    if (!user) {
      showStatus("Log in to follow this profile.");
      window.location.href = "/index.html?auth=login";
      return;
    }
    button.disabled = true;
    try {
      const { data: existing, error: lookupError } = await supabase.from("user_follows")
        .select("follower_id").eq("follower_id", user.id).eq("followed_id", viewedProfile.id).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) {
        const { error } = await supabase.from("user_follows").delete()
          .eq("follower_id", user.id).eq("followed_id", viewedProfile.id);
        if (error) throw error;
        showStatus("You unfollowed @" + viewedProfile.username + ".");
      } else {
        const { error } = await supabase.from("user_follows").insert({
          follower_id: user.id, followed_id: viewedProfile.id
        });
        if (error) throw error;
        showStatus("You are now following @" + viewedProfile.username + ".");
      }
      const summary = await loadPublicSummary(viewedProfile.username);
      setStats(summary);
      await refreshFollowState();
    } catch (error) {
      console.error("[Amora follow]", error?.message || error);
      showStatus(error.message || "Could not update follow status. Please try again.", true);
    } finally {
      button.disabled = false;
    }
  });
  byId("profile-report-button")?.addEventListener("click", () => {
    showStatus("Account reporting is not connected yet.");
    byId("profile-more-menu").hidden = true;
  });
  byId("profile-block-button")?.addEventListener("click", () => {
    showStatus("Account blocking is not connected yet.");
    byId("profile-more-menu").hidden = true;
  });

  byId("profile-message-button")?.addEventListener("click", async (event) => {
    event.preventDefault();
    const button = byId("profile-message-button");
    if (!user || !currentUserId) {
      window.location.href = "/index.html?auth=login";
      return;
    }
    if (!viewedProfile?.username || viewedProfile.id === currentUserId) return;
    button.disabled = true;
    button.textContent = "Opening chat…";
    showStatus("");
    try {
      const { data, error } = await supabase.rpc("open_direct_conversation", {
        p_username: viewedProfile.username
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.conversation_id) throw new Error("Could not open this conversation. Please try again.");
      window.location.href = "/pages/messages.html?conversation=" + encodeURIComponent(result.conversation_id);
    } catch (error) {
      showStatus(error.message || "Could not open this conversation. Please try again.", true);
      button.disabled = false;
      button.textContent = "Message";
    }
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