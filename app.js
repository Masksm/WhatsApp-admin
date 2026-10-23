(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const base = window.AMORA || {};
  const params = new URLSearchParams(window.location.search);
  const config = {
    ...base,
    to: params.get("to") || base.to || "someone special",
    from: params.get("from") || base.from || "someone who cares",
    theirNumber: params.get("num") || base.theirNumber || "",
    message: params.get("msg") || base.message || "You make the world brighter. 💗",
    photo: params.get("img") || base.photo || ""
  };

  const stages = ["#form-panel", "#queue-stage", "#verify-stage", "#reveal-stage"];
  let queueTimer = null;
  let countdownTimer = null;
  let typingTimer = null;
  let toastTimer = null;
  let queueStarted = 0;
  let queuePosition = 47;
  let stats = { ...(config.stats || {}) };
  let activity = [...(config.activity || [])];
  let currentLetter = "";
  let audioContext = null;

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2100);
  }

  function showStage(id) {
    stages.forEach(selector => { $(selector).hidden = selector !== id; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function safeText(value) {
    return String(value == null ? "" : value);
  }

  function renderStats() {
    $("#stat-sent").textContent = Number(stats.sentToday || 2184).toLocaleString();
    $("#stat-online").textContent = Number(stats.online || 1247).toLocaleString();
    $("#nav-online").textContent = `${Number(stats.online || 1247).toLocaleString()} online`;
    const couples = Number(stats.couples || 41300);
    $("#stat-couples").textContent = couples >= 1000 ? `${(couples / 1000).toFixed(1)}k` : couples.toLocaleString();
  }

  function renderActivity() {
    const list = $("#activity-list");
    list.replaceChildren();
    activity.slice(0, 4).forEach(item => {
      const row = document.createElement("div");
      row.className = "activity-item";
      const avatar = document.createElement("div");
      avatar.className = "activity-avatar";
      avatar.textContent = item.avatar || "💗";
      const copy = document.createElement("div");
      copy.className = "activity-copy";
      const names = document.createElement("strong");
      names.textContent = `${safeText(item.from)} → ${safeText(item.to)}`;
      const city = document.createElement("small");
      city.textContent = `Demo activity · ${safeText(item.city)}`;
      copy.append(names, city);
      const time = document.createElement("span");
      time.className = "activity-time";
      time.textContent = safeText(item.time || "recently");
      row.append(avatar, copy, time);
      list.append(row);
    });
  }

  function renderTestimonials() {
    const target = $("#testimonials");
    target.replaceChildren();
    (config.testimonials || []).forEach(item => {
      const card = document.createElement("article");
      card.className = "testimonial-card";
      const head = document.createElement("div");
      head.className = "testimonial-head";
      const avatar = document.createElement("div");
      avatar.className = "testimonial-avatar";
      avatar.textContent = item.avatar || "💗";
      const person = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = safeText(item.name);
      const city = document.createElement("small");
      city.textContent = safeText(item.city);
      person.append(name, city);
      const stars = document.createElement("span");
      stars.className = "stars";
      stars.setAttribute("aria-label", "5 out of 5 stars");
      stars.textContent = "★★★★★";
      head.append(avatar, person, stars);
      const quote = document.createElement("blockquote");
      quote.textContent = `“${safeText(item.quote)}”`;
      card.append(head, quote);
      target.append(card);
    });
  }

  function renderFaq() {
    const target = $("#faq-list");
    target.replaceChildren();
    (config.faq || []).forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "faq-item";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "faq-question";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", `faq-answer-${index}`);
      const question = document.createElement("span");
      question.textContent = safeText(item.question);
      const plus = document.createElement("span");
      plus.setAttribute("aria-hidden", "true");
      plus.textContent = "+";
      button.append(question, plus);
      const answer = document.createElement("div");
      answer.className = "faq-answer";
      answer.id = `faq-answer-${index}`;
      answer.hidden = true;
      answer.textContent = safeText(item.answer);
      button.addEventListener("click", () => {
        const open = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", String(!open));
        answer.hidden = open;
      });
      card.append(button, answer);
      target.append(card);
    });
  }

  function validatePhone(value) {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
  }

  function runQueue() {
    showStage("#queue-stage");
    queueStarted = Date.now();
    queuePosition = 47;
    const phases = [
      ["Connecting to secure preview…", "Preparing your demo experience."],
      ["You're in the queue", "Getting your little surprise ready."],
      ["Finding the sweetest words…", "Almost ready for the reveal."],
      ["Preparing your surprise…", "A little moment of happiness is on its way."]
    ];
    const duration = 11000;
    clearInterval(queueTimer);
    queueTimer = setInterval(() => {
      const elapsed = Date.now() - queueStarted;
      const progress = Math.min(100, elapsed / duration * 100);
      $("#progress-fill").style.width = `${progress}%`;
      $("#queue-position").textContent = Math.max(1, 47 - Math.floor(progress / 100 * 46));
      const phaseIndex = Math.min(phases.length - 1, Math.floor(progress / 100 * phases.length));
      $("#queue-title").textContent = phases[phaseIndex][0];
      $("#queue-subtitle").textContent = phases[phaseIndex][1];
      if (elapsed >= duration) {
        clearInterval(queueTimer);
        showVerify();
      }
    }, 180);
  }

  function showVerify() {
    showStage("#verify-stage");
    let seconds = 10;
    $("#countdown").textContent = "Demo preview continues in 0:10";
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      seconds -= 1;
      $("#countdown").textContent = `Demo preview continues in 0:${String(Math.max(0, seconds)).padStart(2, "0")}`;
      if (seconds <= 0) {
        clearInterval(countdownTimer);
        $("#countdown").textContent = "Preview ready";
      }
    }, 1000);
  }

  function playChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioContext = audioContext || new AudioCtx();
      if (audioContext.state === "suspended") audioContext.resume();
      [523.25, 659.25, 783.99].forEach((frequency, i) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, audioContext.currentTime + i * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.09, audioContext.currentTime + i * 0.16 + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + i * 0.16 + 0.28);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(audioContext.currentTime + i * 0.16);
        oscillator.stop(audioContext.currentTime + i * 0.16 + 0.3);
      });
    } catch (_) {
      // Audio is an optional enhancement; the reveal still works without it.
    }
  }

  function launchConfetti() {
    const target = $("#confetti");
    target.replaceChildren();
    const pieces = ["💗", "✨", "💕", "✦", "🌸"];
    for (let i = 0; i < 24; i++) {
      const piece = document.createElement("span");
      piece.textContent = pieces[Math.floor(Math.random() * pieces.length)];
      piece.style.setProperty("--x", `${Math.random() * 100}%`);
      piece.style.setProperty("--fall-time", `${2.1 + Math.random() * 2.4}s`);
      piece.style.setProperty("--size", `${12 + Math.random() * 12}px`);
      piece.style.animationDelay = `${Math.random() * 1.1}s`;
      target.append(piece);
    }
    setTimeout(() => target.replaceChildren(), 6000);
  }

  function typeLetter() {
    clearInterval(typingTimer);
    const output = $("#letter-text");
    const cursor = $("#typing-cursor");
    output.textContent = "";
    cursor.hidden = false;
    let index = 0;
    typingTimer = setInterval(() => {
      output.textContent = currentLetter.slice(0, index);
      index += 2;
      if (index >= currentLetter.length) {
        output.textContent = currentLetter;
        clearInterval(typingTimer);
        cursor.hidden = true;
      }
    }, 27);
  }

  function reveal() {
    clearInterval(countdownTimer);
    clearInterval(queueTimer);
    currentLetter = safeText(config.message);
    $("#letter-label").textContent = `A note for ${config.to}`;
    $("#signature").textContent = `— from ${config.from}`;
    const photo = $("#letter-photo");
    if (config.photo && /^https?:\/\//i.test(config.photo)) {
      photo.src = config.photo;
      photo.hidden = false;
    } else {
      photo.removeAttribute("src");
      photo.hidden = true;
    }
    showStage("#reveal-stage");
    launchConfetti();
    playChime();
    typeLetter();
  }

  // ============================================================
  // AMORA ACCOUNT SIGNUP AND LOGIN
  // ============================================================

  const authForm = $("#auth-form");
  const authName = $("#auth-name");
  const authEmail = $("#auth-email");
  const authPassword = $("#auth-password");
  const authStatus = $("#auth-status");
  const authSubmit = authForm.querySelector('button[type="submit"]');
  const loginButton = $("#login-button");

  let authMode = "signup";

  function setAuthStatus(message, isError = false) {
    authStatus.textContent = message;
    authStatus.style.color = isError ? "#dc2626" : "#15803d";
  }

  function setAuthMode(mode) {
    authMode = mode;

    const isSignup = mode === "signup";

    authName.required = isSignup;
    authName.closest("label")?.setAttribute("aria-hidden", "false");

    authName.style.display = isSignup ? "" : "none";
    authName.previousElementSibling.style.display = isSignup ? "" : "none";

    authName.placeholder = "What should we call you?";
    authPassword.autocomplete = isSignup
      ? "new-password"
      : "current-password";

    authSubmit.textContent = isSignup
      ? "Create account 💗"
      : "Log in 💗";

    loginButton.textContent = isSignup
      ? "I already have an account"
      : "Create a new account";

    setAuthStatus("");
  }

  loginButton.addEventListener("click", () => {
    setAuthMode(authMode === "signup" ? "login" : "signup");
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const supabase = window.amoraSupabase;

    if (!supabase) {
      setAuthStatus(
        "Connection unavailable. Please refresh and try again.",
        true
      );
      return;
    }

    const email = authEmail.value.trim();
    const password = authPassword.value;
    const name = authName.value.trim();

    authSubmit.disabled = true;
    loginButton.disabled = true;
    setAuthStatus(
      authMode === "signup"
        ? "Creating your account..."
        : "Signing you in..."
    );

    try {
      let result;

      if (authMode === "signup") {
        result = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: name
            }
          }
        });
      } else {
        result = await supabase.auth.signInWithPassword({
          email,
          password
        });
      }

      if (result.error) {
        throw result.error;
      }

      if (authMode === "signup") {
        if (result.data.session) {
          setAuthStatus(
            "Account created successfully. Welcome to Amora! 💗"
          );
        } else {
          setAuthStatus(
            "Account created. Check your email for the confirmation link."
          );
        }
      } else {
        setAuthStatus(
          "Login successful. Welcome back to Amora! 💗"
        );
      }
    } catch (error) {
      setAuthStatus(
        error.message || "Something went wrong. Please try again.",
        true
      );
    } finally {
      authSubmit.disabled = false;
      loginButton.disabled = false;
    }
  });

  setAuthMode("signup");

const requestedAuthMode = new URLSearchParams(
  window.location.search
).get("auth");

if (
  requestedAuthMode === "signup" ||
  requestedAuthMode === "login"
) {
  setAuthMode(requestedAuthMode);

  const authPanel = document.getElementById("auth-panel");

  if (authPanel) {
    authPanel.hidden = false;
    authPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

  // ============================================================
  // AMORA DASHBOARD AND SESSION MANAGEMENT
  // ============================================================

  const dashboardPanel = $("#dashboard-panel");
  const dashboardEmail = $("#dashboard-email");
  const dashboardStatus = $("#dashboard-status");
  const logoutButton = $("#logout-button");
  const authPanel = $("#auth-panel");

  function showDashboard(user) {
    if (user) {
      dashboardEmail.textContent = user.email || "Email unavailable";
      dashboardStatus.textContent =
        "You're signed in. Your Amora space is ready. 💗";

      dashboardPanel.hidden = false;
      authPanel.hidden = true;
    } else {
      dashboardPanel.hidden = true;
      authPanel.hidden = false;
    }
  }

  // Restore the dashboard when an existing session is found.
  window.amoraSupabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      console.error("Could not restore session:", error.message);
      return;
    }

    showDashboard(data.session?.user || null);
  });

  // Keep the page in sync when the user signs in or out.
  window.amoraSupabase.auth.onAuthStateChange((event, session) => {
    showDashboard(session?.user || null);
  });

  // Log out securely through Supabase.
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    dashboardStatus.textContent = "Logging out...";

    const { error } = await window.amoraSupabase.auth.signOut();

    if (error) {
      dashboardStatus.textContent =
        "Logout failed: " + error.message;
      logoutButton.disabled = false;
      return;
    }

    showDashboard(null);
    setAuthStatus("You've logged out successfully.");
    logoutButton.disabled = false;
  });

  $("#surprise-form").addEventListener("submit", event => {
    event.preventDefault();
    const number = $("#number").value.trim();
    const theirNumber = $("#their-number").value.trim();
    const error = $("#form-error");
    error.hidden = true;
    if (!validatePhone(number)) {
      error.textContent = "Enter a valid phone number, including the country code if possible.";
      error.hidden = false;
      $("#number").focus();
      return;
    }
    if (theirNumber && !validatePhone(theirNumber)) {
      error.textContent = "The optional second number doesn't look valid. Check it or leave it blank.";
      error.hidden = false;
      $("#their-number").focus();
      return;
    }
    // Deliberately local-only: this safe preview never calls /api/pair or /api/status.
    runQueue();
  });

  $("#copy-code").addEventListener("click", async () => {
    const code = $("#demo-code").textContent;
    try {
      await navigator.clipboard.writeText(code);
      $("#copy-code").textContent = "Copied ✓";
      showToast("Demo code copied");
      setTimeout(() => { $("#copy-code").textContent = "Copy demo code"; }, 1800);
    } catch (_) {
      showToast(`Demo code: ${code}`);
    }
  });

  $("#continue-reveal").addEventListener("click", reveal);
  $("#read-again").addEventListener("click", typeLetter);

  document.querySelectorAll("[data-footer]").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      const topic = link.dataset.footer;
      showToast(topic === "privacy"
        ? "Demo only: no phone numbers or messages are submitted."
        : "Demo only: no real delivery or account linking occurs.");
    });
  });

  // Gentle simulated counters, clearly identified as illustrative demo content.
  renderStats();
  renderActivity();
  renderTestimonials();
  renderFaq();
  setInterval(() => {
    stats.sentToday = Number(stats.sentToday || 2184) + Math.floor(Math.random() * 4);
    stats.online = Math.max(1200, Number(stats.online || 1247) + Math.floor(Math.random() * 7) - 3);
    stats.couples = Number(stats.couples || 41300) + (Math.random() > 0.6 ? 1 : 0);
    renderStats();
  }, 3000);

  const activityNames = [
    { from: "Nneka", to: "Dami", city: "Port Harcourt", avatar: "🌸" },
    { from: "Feyi", to: "Mira", city: "Lagos", avatar: "💌" },
    { from: "Ife", to: "Tolu", city: "Abuja", avatar: "✨" },
    { from: "Emeka", to: "Ada", city: "Enugu", avatar: "💗" }
  ];
  setInterval(() => {
    const next = activityNames[Math.floor(Math.random() * activityNames.length)];
    activity.unshift({ ...next, time: "just now" });
    activity = activity.slice(0, 4);
    renderActivity();
  }, 5000);
})();

  // ============================================================
  // AMORA PERSONAL ANONYMOUS LINKS
  // ============================================================

  const createLinkButton = document.getElementById(
    "create-anonymous-link"
  );
  const copyLinkButton = document.getElementById(
    "copy-anonymous-link"
  );
  const linkResult = document.getElementById(
    "anonymous-link-result"
  );
  const linkUrlInput = document.getElementById(
    "anonymous-link-url"
  );
  const linkStatus = document.getElementById(
    "anonymous-link-status"
  );

  function displayAnonymousLink(slug) {
    const link = new URL(window.location.href);
    link.search = "";
    link.hash = "";
    link.searchParams.set("anon", slug);

    linkUrlInput.value = link.toString();
    linkResult.hidden = false;
  }

  async function loadAnonymousLink(user) {
    if (!user || !createLinkButton) return;

    linkStatus.textContent = "Checking your personal link...";
    createLinkButton.disabled = true;

    try {
      const { data, error } = await window.amoraSupabase
        .from("anonymous_links")
        .select("slug, is_active")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data && data.is_active) {
        displayAnonymousLink(data.slug);
        linkStatus.textContent = "Your personal link is ready.";
      } else {
        linkResult.hidden = true;
        linkStatus.textContent =
          "You haven't created an active link yet.";
      }
    } catch (error) {
      console.error("Could not load anonymous link:", error);
      linkStatus.textContent =
        "Could not load your link. Please refresh and try again.";
    } finally {
      createLinkButton.disabled = false;
    }
  }

  createLinkButton.addEventListener("click", async () => {
    createLinkButton.disabled = true;
    linkStatus.textContent = "Creating your personal link...";

    try {
      const { data: sessionData, error: sessionError } =
        await window.amoraSupabase.auth.getSession();

      if (sessionError) throw sessionError;

      const user = sessionData.session?.user;

      if (!user) {
        throw new Error("Please log in before creating a link.");
      }

      // Reuse an existing active link instead of creating duplicates.
      const { data: existing, error: lookupError } =
        await window.amoraSupabase
          .from("anonymous_links")
          .select("slug, is_active")
          .eq("owner_id", user.id)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

      if (lookupError) throw lookupError;

      if (existing) {
        displayAnonymousLink(existing.slug);
        linkStatus.textContent = "Your existing link is ready.";
        return;
      }

      const slug =
        "m-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

      const { data, error } = await window.amoraSupabase
        .from("anonymous_links")
        .insert({
          owner_id: user.id,
          slug: slug,
          is_active: true
        })
        .select("slug")
        .single();

      if (error) throw error;

      displayAnonymousLink(data.slug);
      linkStatus.textContent =
        "Your personal link has been created successfully! 💗";
    } catch (error) {
      console.error("Could not create anonymous link:", error);
      linkStatus.textContent =
        error.message || "Could not create your link.";
    } finally {
      createLinkButton.disabled = false;
    }
  });

  copyLinkButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(linkUrlInput.value);
      linkStatus.textContent = "Link copied! Share it with your friends.";
    } catch (error) {
      linkUrlInput.focus();
      linkUrlInput.select();
      linkStatus.textContent =
        "Automatic copying failed. Copy the selected link manually.";
    }
  });

  // Load the user's link whenever a valid session is found.
  window.amoraSupabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      console.error("Session lookup failed:", error.message);
      return;
    }

    if (data.session?.user) {
      loadAnonymousLink(data.session.user);
    }
  });

  window.amoraSupabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      loadAnonymousLink(session.user);
    } else if (linkResult) {
      linkResult.hidden = true;
      linkStatus.textContent = "";
    }
  });

  // ============================================================
  // AMORA PUBLIC ANONYMOUS MESSAGE SUBMISSION
  // ============================================================

  const publicMessagePanel = document.getElementById(
    "anonymous-message-panel"
  );
  const publicMessageForm = document.getElementById(
    "anonymous-message-form"
  );
  const publicMessageText = document.getElementById(
    "anonymous-message-text"
  );
  const publicMessageStatus = document.getElementById(
    "anonymous-message-status"
  );
  const publicMessageButton = document.getElementById(
    "send-anonymous-message"
  );

  const anonymousPageUrl = new URL(window.location.href);
  const publicAnonymousSlug = anonymousPageUrl.searchParams.get("anon");

  if (publicAnonymousSlug && publicMessagePanel) {
    // Show the public message page instead of the owner's dashboard.
    publicMessagePanel.hidden = false;

    
const elementsToHide = [
  "auth-panel",
  "dashboard-panel",
  "form-panel"
];

elementsToHide.forEach((id) => {
  const element = document.getElementById(id);
  if (element) element.hidden = true;
});

// Hide the rest of the homepage for anonymous message links.
document.body.classList.add("anonymous-message-page");

document.querySelectorAll("body > *").forEach((element) => {
  if (
    element.id !== "anonymous-message-panel" &&
    element.tagName !== "SCRIPT"
  ) {
    element.hidden = true;
  }
});

// Keep the anonymous message panel visible.
publicMessagePanel.hidden = false;


    publicMessageForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const message = publicMessageText.value.trim();

      if (!message) {
        publicMessageStatus.textContent =
          "Please write a message before sending.";
        return;
      }

      if (message.length > 2000) {
        publicMessageStatus.textContent =
          "Your message cannot exceed 2,000 characters.";
        return;
      }

      publicMessageButton.disabled = true;
      publicMessageStatus.textContent = "Sending your message...";

      try {
        const { error } = await window.amoraSupabase.rpc(
          "submit_anonymous_message",
          {
            p_slug: publicAnonymousSlug,
            p_message: message
          }
        );

        if (error) throw error;

        
publicMessageForm.reset();

publicMessageStatus.innerHTML = `
  <div class="anonymous-success">
    <h3>Message sent successfully! 💗</h3>
    <p>Your little note has been delivered anonymously.</p>

    <div class="anonymous-signup-prompt">
      <h4>Enjoying Amora? 💌</h4>
      <p>
        Create your own account to get your personal anonymous
        message link, or log in if you already have an account.
      </p>

      <a class="primary-btn" href="${window.location.origin}/">
        Create an account 💗
      </a>

      <p>
        Already have an account?
        <a class="primary-btn" href="${window.location.origin}/">Log in</a>
      </p>
    </div>
  </div>
`;

      } catch (error) {
        console.error("Anonymous message submission failed:", error);

        publicMessageStatus.textContent =
          "We couldn't send your message. The link may be invalid or temporarily unavailable.";
      } finally {
        publicMessageButton.disabled = false;
      }
    });
  }
