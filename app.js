(() => {
  "use strict";

  // ============================================================
  // AMORA CORE HELPERS AND CONFIGURATION
  // ============================================================

  const $ = (selector) => document.querySelector(selector);
  const byId = (id) => document.getElementById(id);
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

  const supabase = window.amoraSupabase;

  const stages = [
    "#form-panel",
    "#queue-stage",
    "#verify-stage",
    "#reveal-stage"
  ];

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

  function safeText(value) {
    return String(value == null ? "" : value);
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2100);
  }

  function showStage(id) {
    stages.forEach((selector) => {
      const element = $(selector);
      if (element) element.hidden = selector !== id;
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function setStatus(element, message, isError = false) {
    if (!element) return;

    element.textContent = message;
    element.style.color = isError ? "#dc2626" : "#15803d";
  }

  function getErrorMessage(error, fallback) {
    const message = error?.message || "";

    if (/invalid or expired|already used|claim token/i.test(message)) {
      return "This message's claim link is invalid, expired, or has already been used.";
    }

    if (/cannot claim a message sent to your own account/i.test(message)) {
      return "This message was sent to your own account. Log in with the account that sent it to claim it.";
    }

    if (/contact information|messaging rules/i.test(message)) {
      return "Please remove contact details or off-platform contact requests and try again.";
    }

    return message || fallback;
  }

  // ============================================================
  // LANDING PAGE DEMO: STATS, ACTIVITY, TESTIMONIALS AND FAQ
  // ============================================================

  function renderStats() {
    const sent = $("#stat-sent");
    const online = $("#stat-online");
    const navOnline = $("#nav-online");
    const couplesElement = $("#stat-couples");

    if (sent) {
      sent.textContent = Number(stats.sentToday || 2184).toLocaleString();
    }

    if (online) {
      online.textContent = Number(stats.online || 1247).toLocaleString();
    }

    if (navOnline) {
      navOnline.textContent =
        `${Number(stats.online || 1247).toLocaleString()} online`;
    }

    if (couplesElement) {
      const couples = Number(stats.couples || 41300);

      couplesElement.textContent = couples >= 1000
        ? `${(couples / 1000).toFixed(1)}k`
        : couples.toLocaleString();
    }
  }

  function renderActivity() {
    const list = $("#activity-list");
    if (!list) return;

    list.replaceChildren();

    activity.slice(0, 4).forEach((item) => {
      const row = document.createElement("div");
      row.className = "activity-item";

      const avatar = document.createElement("div");
      avatar.className = "activity-avatar";
      avatar.textContent = item.avatar || "💗";

      const copy = document.createElement("div");
      copy.className = "activity-copy";

      const names = document.createElement("strong");
      names.textContent =
        `${safeText(item.from)} → ${safeText(item.to)}`;

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
    if (!target) return;

    target.replaceChildren();

    (config.testimonials || []).forEach((item) => {
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
    if (!target) return;

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

  // ============================================================
  // DEMO SURPRISE FLOW
  // ============================================================

  function validatePhone(value) {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
  }

  function runQueue() {
    if (!$("#queue-stage")) return;

    showStage("#queue-stage");

    queueStarted = Date.now();
    queuePosition = 47;

    const phases = [
      [
        "Connecting to secure preview…",
        "Preparing your demo experience."
      ],
      [
        "You're in the queue",
        "Getting your little surprise ready."
      ],
      [
        "Finding the sweetest words…",
        "Almost ready for the reveal."
      ],
      [
        "Preparing your surprise…",
        "A little moment of happiness is on its way."
      ]
    ];

    const duration = 11000;

    clearInterval(queueTimer);

    queueTimer = setInterval(() => {
      const elapsed = Date.now() - queueStarted;
      const progress = Math.min(100, elapsed / duration * 100);

      const progressFill = $("#progress-fill");
      const position = $("#queue-position");
      const title = $("#queue-title");
      const subtitle = $("#queue-subtitle");

      if (progressFill) {
        progressFill.style.width = `${progress}%`;
      }

      if (position) {
        position.textContent = Math.max(
          1,
          47 - Math.floor(progress / 100 * 46)
        );
      }

      const phaseIndex = Math.min(
        phases.length - 1,
        Math.floor(progress / 100 * phases.length)
      );

      if (title) title.textContent = phases[phaseIndex][0];
      if (subtitle) subtitle.textContent = phases[phaseIndex][1];

      if (elapsed >= duration) {
        clearInterval(queueTimer);
        showVerify();
      }
    }, 180);
  }

  function showVerify() {
    if (!$("#verify-stage")) return;

    showStage("#verify-stage");

    let seconds = 10;
    const countdown = $("#countdown");

    if (countdown) {
      countdown.textContent = "Demo preview continues in 0:10";
    }

    clearInterval(countdownTimer);

    countdownTimer = setInterval(() => {
      seconds -= 1;

      if (countdown) {
        countdown.textContent = seconds > 0
          ? `Demo preview continues in 0:${String(seconds).padStart(2, "0")}`
          : "Preview ready";
      }

      if (seconds <= 0) {
        clearInterval(countdownTimer);
      }
    }, 1000);
  }

  function playChime() {
    try {
      const AudioCtx =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioCtx) return;

      audioContext = audioContext || new AudioCtx();

      if (audioContext.state === "suspended") {
        audioContext.resume();
      }

      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = frequency;

        const start = audioContext.currentTime + index * 0.16;

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.09, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start(start);
        oscillator.stop(start + 0.3);
      });
    } catch (_) {
      // The reveal works without audio.
    }
  }

  function launchConfetti() {
    const target = $("#confetti");
    if (!target) return;

    target.replaceChildren();

    const pieces = ["💗", "✨", "💕", "✦", "🌸"];

    for (let index = 0; index < 24; index++) {
      const piece = document.createElement("span");

      piece.textContent =
        pieces[Math.floor(Math.random() * pieces.length)];

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

    if (!output || !cursor) return;

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

    const label = $("#letter-label");
    const signature = $("#signature");
    const photo = $("#letter-photo");

    if (label) label.textContent = `A note for ${config.to}`;
    if (signature) signature.textContent = `— from ${config.from}`;

    if (photo) {
      if (config.photo && /^https?:\/\//i.test(config.photo)) {
        photo.src = config.photo;
        photo.hidden = false;
      } else {
        photo.removeAttribute("src");
        photo.hidden = true;
      }
    }

    showStage("#reveal-stage");
    launchConfetti();
    playChime();
    typeLetter();
  }

  // ============================================================
  // ACCOUNT SIGNUP AND LOGIN
  // ============================================================

  const authForm = $("#auth-form");
  const authName = $("#auth-name");
  const authEmail = $("#auth-email");
  const authPassword = $("#auth-password");
  const authStatus = $("#auth-status");
  const authSubmit = authForm?.querySelector('button[type="submit"]');
  const loginButton = $("#login-button");

  const authPanel = $("#auth-panel");
  const dashboardPanel = $("#dashboard-panel");
  const dashboardEmail = $("#dashboard-email");
  const dashboardStatus = $("#dashboard-status");
  const logoutButton = $("#logout-button");

  let authMode = "signup";

  function setAuthStatus(message, isError = false) {
    setStatus(authStatus, message, isError);
  }

  function setAuthMode(mode) {
    authMode = mode === "login" ? "login" : "signup";

    const isSignup = authMode === "signup";

    if (authName) {
      authName.required = isSignup;
      authName.style.display = isSignup ? "" : "none";

      if (authName.previousElementSibling) {
        authName.previousElementSibling.style.display =
          isSignup ? "" : "none";
      }

      authName.placeholder = "What should we call you?";
      authName.autocomplete = "name";
    }

    if (authPassword) {
      authPassword.autocomplete = isSignup
        ? "new-password"
        : "current-password";
    }

    if (authSubmit) {
      authSubmit.textContent = isSignup
        ? "Create account 💗"
        : "Log in 💗";
    }

    if (loginButton) {
      loginButton.textContent = isSignup
        ? "I already have an account"
        : "Create a new account";
    }

    setAuthStatus("");
  }

  loginButton?.addEventListener("click", () => {
    setAuthMode(authMode === "signup" ? "login" : "signup");
  });

  // ============================================================
  // CLAIM PENDING ANONYMOUS MESSAGES
  // ============================================================

  const CLAIM_STORAGE_KEY = "amora_pending_claim_tokens";

  let claimProcessing = false;

  function getPendingClaimTokens() {
    try {
      const stored = sessionStorage.getItem(CLAIM_STORAGE_KEY);

      if (!stored) return [];

      const tokens = JSON.parse(stored);

      if (!Array.isArray(tokens)) return [];

      return [...new Set(
        tokens.filter((token) =>
          typeof token === "string" &&
          /^[a-f0-9]{64}$/.test(token)
        )
      )];
    } catch (error) {
      console.error("Could not read pending claim tokens:", error);
      return [];
    }
  }

  function savePendingClaimTokens(tokens) {
    try {
      if (tokens.length === 0) {
        sessionStorage.removeItem(CLAIM_STORAGE_KEY);
      } else {
        sessionStorage.setItem(
          CLAIM_STORAGE_KEY,
          JSON.stringify([...new Set(tokens)])
        );
      }
    } catch (error) {
      console.error("Could not save pending claim tokens:", error);
    }
  }

  async function processPendingClaims() {
    if (!supabase || claimProcessing) return;

    const tokens = getPendingClaimTokens();

    if (tokens.length === 0) return;

    claimProcessing = true;

    const remainingTokens = [...tokens];
    let claimedCount = 0;
    let lastError = "";

    try {
      for (const token of tokens) {
        try {
          const { data, error } = await supabase.rpc(
            "claim_anonymous_message",
            {
              p_token: token
            }
          );

          if (error) throw error;

          if (
            typeof data !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(data)
          ) {
            throw new Error(
              "The server did not return a valid conversation ID."
            );
          }

          const index = remainingTokens.indexOf(token);

          if (index !== -1) {
            remainingTokens.splice(index, 1);
          }

          claimedCount += 1;
        } catch (error) {
          console.error("Could not claim an anonymous message:", error);

          lastError = getErrorMessage(
            error,
            "An anonymous message could not be claimed."
          );

          // Keep the token so a temporary failure can be retried.
          // The database prevents successful tokens from being reused.
        }
      }

      savePendingClaimTokens(remainingTokens);

      if (claimedCount > 0) {
        setStatus(
          dashboardStatus,
          claimedCount === 1
            ? "Your anonymous message is now connected to a conversation! 💗"
            : `${claimedCount} anonymous messages are now connected to conversations! 💗`
        );
      } else if (lastError && remainingTokens.length > 0) {
        setStatus(
          dashboardStatus,
          `Your account is signed in, but a message could not be connected: ${lastError}`,
          true
        );
      }
    } finally {
      claimProcessing = false;
    }
  }

  // ============================================================
  // DASHBOARD AND SESSION MANAGEMENT
  // ============================================================

  function showDashboard(user) {
    if (user) {
      if (dashboardEmail) {
        dashboardEmail.textContent = user.email || "Email unavailable";
      }

      if (dashboardStatus && !dashboardStatus.textContent) {
        dashboardStatus.textContent =
          "You're signed in. Your Amora space is ready. 💗";
      }

      if (dashboardPanel) dashboardPanel.hidden = false;
      if (authPanel) authPanel.hidden = true;
    } else {
      if (dashboardPanel) dashboardPanel.hidden = true;

      // Do not force the authentication panel open on the public
      // anonymous-message page.
      if (authPanel && !params.has("anon")) {
        authPanel.hidden = false;
      }
    }
  }

  async function refreshAuthenticatedUser() {
    if (!supabase) return;

    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error("Could not restore session:", error.message);
      return;
    }

    const user = data.session?.user || null;

    showDashboard(user);

    if (user) {
      await loadAnonymousLink(user);
      await processPendingClaims();
    }
  }

  if (supabase) {
    refreshAuthenticatedUser();

    supabase.auth.onAuthStateChange((event, session) => {
      showDashboard(session?.user || null);

      // Avoid running additional Supabase requests directly inside
      // the auth callback.
      if (session?.user) {
        setTimeout(() => {
          loadAnonymousLink(session.user);
          processPendingClaims();
        }, 0);
      }
    });
  } else {
    console.error("Amora Supabase client is unavailable.");
  }

  if (authForm) {
    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!supabase) {
        setAuthStatus(
          "Connection unavailable. Please refresh and try again.",
          true
        );
        return;
      }

      const email = authEmail?.value.trim() || "";
      const password = authPassword?.value || "";
      const name = authName?.value.trim() || "";

      if (authSubmit) authSubmit.disabled = true;
      if (loginButton) loginButton.disabled = true;

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
                name
              }
            }
          });
        } else {
          result = await supabase.auth.signInWithPassword({
            email,
            password
          });
        }

        if (result.error) throw result.error;

        if (authMode === "signup") {
          if (result.data.session) {
            setAuthStatus(
              "Account created successfully. Welcome to Amora! 💗"
            );

            showDashboard(result.data.user);

            await loadAnonymousLink(result.data.user);
            await processPendingClaims();
          } else {
            setAuthStatus(
              "Account created. Check your email for the confirmation link. Your pending message will be connected after you confirm your email and log in."
            );
          }
        } else {
          setAuthStatus(
            "Login successful. Welcome back to Amora! 💗"
          );

          showDashboard(result.data.user);

          await loadAnonymousLink(result.data.user);
          await processPendingClaims();
        }
      } catch (error) {
        setAuthStatus(
          getErrorMessage(
            error,
            "Something went wrong. Please try again."
          ),
          true
        );
      } finally {
        if (authSubmit) authSubmit.disabled = false;
        if (loginButton) loginButton.disabled = false;
      }
    });
  }

  setAuthMode("signup");

  const requestedAuthMode = params.get("auth");

  if (requestedAuthMode === "signup" || requestedAuthMode === "login") {
    setAuthMode(requestedAuthMode);

    if (authPanel) {
      authPanel.hidden = false;

      authPanel.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  }

  logoutButton?.addEventListener("click", async () => {
    if (!supabase) return;

    logoutButton.disabled = true;

    setStatus(dashboardStatus, "Logging out...");

    try {
      const { error } = await supabase.auth.signOut();

      if (error) throw error;

      showDashboard(null);
      setAuthStatus("You've logged out successfully.");
    } catch (error) {
      setStatus(
        dashboardStatus,
        `Logout failed: ${error.message}`,
        true
      );
    } finally {
      logoutButton.disabled = false;
    }
  });

  // ============================================================
  // PERSONAL ANONYMOUS LINKS
  // ============================================================

  const createLinkButton = byId("create-anonymous-link");
  const copyLinkButton = byId("copy-anonymous-link");
  const linkResult = byId("anonymous-link-result");
  const linkUrlInput = byId("anonymous-link-url");
  const linkStatus = byId("anonymous-link-status");

  function displayAnonymousLink(slug) {
    if (!linkUrlInput || !linkResult) return;

    const link = new URL(window.location.href);

    link.search = "";
    link.hash = "";
    link.searchParams.set("anon", slug);

    linkUrlInput.value = link.toString();
    linkResult.hidden = false;
  }

  async function loadAnonymousLink(user) {
    if (!user || !createLinkButton || !supabase) return;

    setStatus(linkStatus, "Checking your personal link...");
    createLinkButton.disabled = true;

    try {
      const { data, error } = await supabase
        .from("anonymous_links")
        .select("slug, is_active")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data && data.is_active) {
        displayAnonymousLink(data.slug);
        setStatus(linkStatus, "Your personal link is ready.");
      } else {
        if (linkResult) linkResult.hidden = true;

        setStatus(
          linkStatus,
          "You haven't created an active link yet."
        );
      }
    } catch (error) {
      console.error("Could not load anonymous link:", error);

      setStatus(
        linkStatus,
        "Could not load your link. Please refresh and try again.",
        true
      );
    } finally {
      createLinkButton.disabled = false;
    }
  }

  createLinkButton?.addEventListener("click", async () => {
    if (!supabase) {
      setStatus(linkStatus, "Connection unavailable.", true);
      return;
    }

    createLinkButton.disabled = true;

    setStatus(linkStatus, "Creating your personal link...");

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const user = sessionData.session?.user;

      if (!user) {
        throw new Error("Please log in before creating a link.");
      }

      const { data: existing, error: lookupError } = await supabase
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
        setStatus(linkStatus, "Your existing link is ready.");
        return;
      }

      const slug =
        "m-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

      const { data, error } = await supabase
        .from("anonymous_links")
        .insert({
          owner_id: user.id,
          slug,
          is_active: true
        })
        .select("slug")
        .single();

      if (error) throw error;

      displayAnonymousLink(data.slug);

      setStatus(
        linkStatus,
        "Your personal link has been created successfully! 💗"
      );
    } catch (error) {
      console.error("Could not create anonymous link:", error);

      setStatus(
        linkStatus,
        error.message || "Could not create your link.",
        true
      );
    } finally {
      createLinkButton.disabled = false;
    }
  });

  copyLinkButton?.addEventListener("click", async () => {
    if (!linkUrlInput) return;

    try {
      await navigator.clipboard.writeText(linkUrlInput.value);

      setStatus(
        linkStatus,
        "Link copied! Share it with your friends."
      );
    } catch (_) {
      linkUrlInput.focus();
      linkUrlInput.select();

      setStatus(
        linkStatus,
        "Automatic copying failed. Copy the selected link manually."
      );
    }
  });

  // ============================================================
  // PUBLIC ANONYMOUS MESSAGE SUBMISSION
  // ============================================================

  const publicMessagePanel = byId("anonymous-message-panel");
  const publicMessageForm = byId("anonymous-message-form");
  const publicMessageText = byId("anonymous-message-text");
  const publicMessageStatus = byId("anonymous-message-status");
  const publicMessageButton = byId("send-anonymous-message");

  const publicAnonymousSlug = params.get("anon");

  if (publicAnonymousSlug && publicMessagePanel) {
    publicMessagePanel.hidden = false;

    [
      "auth-panel",
      "dashboard-panel",
      "form-panel"
    ].forEach((id) => {
      const element = byId(id);
      if (element) element.hidden = true;
    });

    document.body.classList.add("anonymous-message-page");

    document.querySelectorAll("body > *").forEach((element) => {
      if (
        element.id !== "anonymous-message-panel" &&
        element.tagName !== "SCRIPT"
      ) {
        element.hidden = true;
      }
    });

    publicMessagePanel.hidden = false;

    publicMessageForm?.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!supabase) {
        setStatus(
          publicMessageStatus,
          "Connection unavailable. Please try again later.",
          true
        );
        return;
      }

      const message = publicMessageText?.value.trim() || "";

      if (!message) {
        setStatus(
          publicMessageStatus,
          "Please write a message before sending.",
          true
        );
        return;
      }

      if (message.length > 2000) {
        setStatus(
          publicMessageStatus,
          "Your message cannot exceed 2,000 characters.",
          true
        );
        return;
      }

      if (publicMessageButton) {
        publicMessageButton.disabled = true;
      }

      setStatus(publicMessageStatus, "Sending your message...");

      try {
        const { data: claimToken, error } = await supabase.rpc(
          "submit_anonymous_message",
          {
            p_slug: publicAnonymousSlug,
            p_message: message
          }
        );

        if (error) throw error;

        if (
          typeof claimToken !== "string" ||
          !/^[a-f0-9]{64}$/.test(claimToken)
        ) {
          throw new Error(
            "The message was sent, but the claim token was not returned correctly."
          );
        }

        // Store the token locally so the sender can claim the message
        // after signing up or logging in. Never put it in a URL.
        const tokens = getPendingClaimTokens();

        tokens.push(claimToken);
        savePendingClaimTokens(tokens);

        if (publicMessageForm) publicMessageForm.reset();

        const success = document.createElement("div");
        success.className = "anonymous-success";

        const heading = document.createElement("h3");
        heading.textContent = "Message sent successfully! 💗";

        const description = document.createElement("p");
        description.textContent =
          "Your little note has been delivered anonymously.";

        const prompt = document.createElement("div");
        prompt.className = "anonymous-signup-prompt";

        const promptHeading = document.createElement("h4");
        promptHeading.textContent = "Enjoying Amora? 💌";

        const promptText = document.createElement("p");
        promptText.textContent =
          "Create an account to claim your message and continue the conversation.";

        const signupLink = document.createElement("a");
        signupLink.className = "primary-btn";
        signupLink.href = `${window.location.origin}/?auth=signup`;
        signupLink.textContent = "Create an account 💗";

        const loginText = document.createElement("p");
        loginText.textContent = "Already have an account? ";

        const loginLink = document.createElement("a");
        loginLink.className = "primary-btn";
        loginLink.href = `${window.location.origin}/?auth=login`;
        loginLink.textContent = "Log in";

        loginText.append(loginLink);

        prompt.append(
          promptHeading,
          promptText,
          signupLink,
          loginText
        );

        success.append(heading, description, prompt);

        if (publicMessageStatus) {
          publicMessageStatus.replaceChildren(success);
        }
      } catch (error) {
        console.error(
          "Anonymous message submission failed:",
          error
        );

        setStatus(
          publicMessageStatus,
          getErrorMessage(
            error,
            "We couldn't send your message. The link may be invalid or temporarily unavailable."
          ),
          true
        );
      } finally {
        if (publicMessageButton) {
          publicMessageButton.disabled = false;
        }
      }
    });
  }

  // ============================================================
  // EXISTING SURPRISE FORM AND DEMO CONTROLS
  // ============================================================

  $("#surprise-form")?.addEventListener("submit", (event) => {
    event.preventDefault();

    const number = $("#number")?.value.trim() || "";
    const theirNumber = $("#their-number")?.value.trim() || "";
    const error = $("#form-error");

    if (error) error.hidden = true;

    if (!validatePhone(number)) {
      if (error) {
        error.textContent =
          "Enter a valid phone number, including the country code if possible.";
        error.hidden = false;
      }

      $("#number")?.focus();
      return;
    }

    if (theirNumber && !validatePhone(theirNumber)) {
      if (error) {
        error.textContent =
          "The optional second number doesn't look valid. Check it or leave it blank.";
        error.hidden = false;
      }

      $("#their-number")?.focus();
      return;
    }

    // This remains a local-only demo, not a real delivery system.
    runQueue();
  });

  $("#copy-code")?.addEventListener("click", async () => {
    const code = $("#demo-code")?.textContent || "";
    const button = $("#copy-code");

    try {
      await navigator.clipboard.writeText(code);

      if (button) {
        button.textContent = "Copied ✓";

        setTimeout(() => {
          button.textContent = "Copy demo code";
        }, 1800);
      }

      showToast("Demo code copied");
    } catch (_) {
      showToast(`Demo code: ${code}`);
    }
  });

  $("#continue-reveal")?.addEventListener("click", reveal);
  $("#read-again")?.addEventListener("click", typeLetter);

  document.querySelectorAll("[data-footer]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();

      const topic = link.dataset.footer;

      showToast(
        topic === "privacy"
          ? "Demo only: no phone numbers or messages are submitted by this demo."
          : "Demo only: no real delivery or account linking occurs in this demo."
      );
    });
  });

  // ============================================================
  // SIMULATED LANDING PAGE ACTIVITY
  // ============================================================

  renderStats();
  renderActivity();
  renderTestimonials();
  renderFaq();

  setInterval(() => {
    stats.sentToday =
      Number(stats.sentToday || 2184) +
      Math.floor(Math.random() * 4);

    stats.online = Math.max(
      1200,
      Number(stats.online || 1247) +
        Math.floor(Math.random() * 7) - 3
    );

    stats.couples =
      Number(stats.couples || 41300) +
      (Math.random() > 0.6 ? 1 : 0);

    renderStats();
  }, 3000);

  const activityNames = [
    {
      from: "Nneka",
      to: "Dami",
      city: "Port Harcourt",
      avatar: "🌸"
    },
    {
      from: "Feyi",
      to: "Mira",
      city: "Lagos",
      avatar: "💌"
    },
    {
      from: "Ife",
      to: "Tolu",
      city: "Abuja",
      avatar: "✨"
    },
    {
      from: "Emeka",
      to: "Ada",
      city: "Enugu",
      avatar: "💗"
    }
  ];

  setInterval(() => {
    const next =
      activityNames[Math.floor(Math.random() * activityNames.length)];

    activity.unshift({
      ...next,
      time: "just now"
    });

    activity = activity.slice(0, 4);

    renderActivity();
  }, 5000);

  // ============================================================
  // REAL INBOX: SUPABASE CONVERSATIONS, MESSAGES, NOTIFICATIONS
  // ============================================================

  const chatStatus = document.getElementById("chat-status");
  const conversationList = document.getElementById("conversation-list");
  const notificationList = document.getElementById("notification-list");
  const messageList = document.getElementById("message-list");
  const conversationHeading = document.getElementById("active-conversation-heading");
  const chatMessageForm = document.getElementById("chat-message-form");
  const chatMessageText = document.getElementById("chat-message-text");
  const sendChatMessageButton = document.getElementById("send-chat-message");
  const refreshConversationsButton = document.getElementById("refresh-conversations");

  let activeChatConversationId = null;
  let chatRequestInProgress = false;

  function setChatStatus(message) {
    if (chatStatus) chatStatus.textContent = message;
  }

  function addChatText(parent, tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = content == null ? "" : String(content);
    parent.appendChild(element);
    return element;
  }

  function formatChatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
  }

  function clearChatElement(element, message) {
    if (!element) return;
    element.replaceChildren();
    if (message) addChatText(element, "p", "", message);
  }

  async function loadChatMessages(conversationId) {
    if (!supabase || !conversationId) return;

    activeChatConversationId = conversationId;
    chatMessageText.disabled = true;
    sendChatMessageButton.disabled = true;
    clearChatElement(messageList, "Loading messages...");

    const { data, error } = await supabase.rpc(
      "get_conversation_messages",
      { p_conversation_id: conversationId }
    );

    if (error) {
      clearChatElement(messageList, "Could not load messages.");
      setChatStatus(error.message);
      return;
    }

    if (activeChatConversationId !== conversationId) return;

    clearChatElement(
      messageList,
      data && data.length ? "" : "No messages in this conversation yet."
    );

    for (const message of data || []) {
      const bubble = document.createElement("div");
      bubble.className = "chat-message " +
        (message.sent_by_me ? "sent" : "received");

      addChatText(
        bubble,
        "div",
        "",
        message.message_text
      );

      addChatText(
        bubble,
        "small",
        "",
        (message.sender_anonymous_name || "Anonymous") +
          " · " + formatChatDate(message.sent_at)
      );

      messageList.appendChild(bubble);
    }

    if (data && data.length) {
      messageList.scrollTop = messageList.scrollHeight;
    }

    chatMessageText.disabled = false;
    sendChatMessageButton.disabled = false;

    const { error: readError } = await supabase.rpc(
      "mark_conversation_read",
      { p_conversation_id: conversationId }
    );

    if (readError) {
      setChatStatus("Messages loaded, but read status could not be updated.");
    }

    await loadChatNotifications();
    await loadChatConversations(false);
  }

  async function loadChatConversations(showLoading = true) {
    if (!supabase || !conversationList) return;

    if (showLoading) {
      clearChatElement(conversationList, "Loading inbox...");
    }

    const { data, error } = await supabase.rpc("get_my_conversations");

    if (error) {
      clearChatElement(conversationList, "Could not load your inbox.");
      setChatStatus(error.message);
      return;
    }

    clearChatElement(
      conversationList,
      data && data.length ? "" : "No conversations yet. Share your anonymous link to receive a message."
    );

    for (const conversation of data || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "conversation-item" +
        (conversation.conversation_id === activeChatConversationId
          ? " active"
          : "");

      const title = addChatText(
        button,
        "strong",
        "",
        conversation.other_anonymous_name || "Anonymous"
      );

      addChatText(
        button,
        "p",
        "",
        conversation.last_message_preview || "Start your conversation"
      );

      if (Number(conversation.unread_count) > 0) {
        addChatText(
          button,
          "p",
          "",
          "Unread messages: " + conversation.unread_count
        );
      }

      button.addEventListener("click", async () => {
        conversationHeading.textContent =
          conversation.other_anonymous_name || "Anonymous conversation";

        await loadChatMessages(conversation.conversation_id);

        for (const item of conversationList.querySelectorAll(".conversation-item")) {
          item.classList.remove("active");
        }
        button.classList.add("active");
      });

      conversationList.appendChild(button);
    }
  }

  async function loadChatNotifications() {
    if (!supabase || !notificationList) return;

    const { data, error } = await supabase.rpc("get_my_notifications");

    if (error) {
      clearChatElement(notificationList, "Could not load notifications.");
      return;
    }

    clearChatElement(
      notificationList,
      data && data.length ? "" : "No notifications yet."
    );

    for (const notification of data || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "notification-item";

      addChatText(
        button,
        "strong",
        "",
        notification.sender_anonymous_name || "Anonymous"
      );

      addChatText(
        button,
        "p",
        "",
        notification.message_preview || "You have a new notification."
      );

      addChatText(
        button,
        "p",
        "",
        formatChatDate(notification.created_at) +
          (notification.read_at ? "" : " · Unread")
      );

      button.addEventListener("click", async () => {
        if (!notification.conversation_id) return;

        conversationHeading.textContent =
          notification.sender_anonymous_name || "Anonymous conversation";

        await loadChatMessages(notification.conversation_id);
      });

      notificationList.appendChild(button);
    }
  }

  async function refreshAmoraInbox() {
    if (!supabase) {
      setChatStatus("Supabase is not available.");
      return;
    }

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError || !sessionData.session) {
      setChatStatus("Log in to view your conversations.");
      clearChatElement(conversationList, "Log in to access your inbox.");
      clearChatElement(notificationList, "Log in to access notifications.");
      return;
    }

    setChatStatus("");
    await loadChatConversations();
    await loadChatNotifications();
  }

  if (refreshConversationsButton) {
    refreshConversationsButton.addEventListener(
      "click",
      refreshAmoraInbox
    );
  }

  if (chatMessageForm) {
    chatMessageForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (chatRequestInProgress) return;

      const conversationId = activeChatConversationId;
      const message = chatMessageText.value.trim();

      if (!conversationId) {
        setChatStatus("Choose a conversation first.");
        return;
      }

      if (!message) {
        setChatStatus("Write a message first.");
        return;
      }

      if (message.length > 2000) {
        setChatStatus("Messages cannot exceed 2000 characters.");
        return;
      }

      chatRequestInProgress = true;
      sendChatMessageButton.disabled = true;
      setChatStatus("Sending message...");

      try {
        const { data, error } = await supabase.rpc(
          "send_chat_message",
          {
            p_conversation_id: conversationId,
            p_message: message
          }
        );

        if (error) {
          setChatStatus("Message could not be sent: " + error.message);
          return;
        }

        if (!data || data.status !== "approved") {
          setChatStatus(
            data && data.status === "blocked"
              ? "This message was blocked by the safety filter. Remove contact details or links and try again."
              : "The message was not accepted. Please try again."
          );
          return;
        }

        chatMessageText.value = "";
        setChatStatus("Message sent.");
        await loadChatMessages(conversationId);
      } catch (error) {
        setChatStatus("Something went wrong while sending the message.");
      } finally {
        chatRequestInProgress = false;
        sendChatMessageButton.disabled = !activeChatConversationId;
      }
    });
  }

  // Refresh the inbox when the user signs in or restores a session.
  if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
      if (session && session.user) {
        refreshAmoraInbox();
      } else {
        activeChatConversationId = null;
        chatMessageText.disabled = true;
        sendChatMessageButton.disabled = true;
        clearChatElement(conversationList, "Log in to access your inbox.");
        clearChatElement(notificationList, "Log in to access notifications.");
        clearChatElement(messageList, "Select a conversation to read messages.");
        conversationHeading.textContent = "Choose a conversation";
        setChatStatus("");
      }
    });

    refreshAmoraInbox();
  }

  async function loadChatNotifications() {
    if (!supabase || !notificationList) return;

    const { data: notifications, error: notificationError } =
      await supabase.rpc("get_my_notifications");

    const { data: anonymousMessages, error: anonymousError } =
      await supabase.rpc("get_my_anonymous_inbox");

    if (notificationError && anonymousError) {
      clearChatElement(
        notificationList,
        "Could not load notifications. Please refresh and try again."
      );
      setChatStatus("Could not retrieve notifications.");
      return;
    }

    clearChatElement(notificationList, "");
    let count = 0;

    for (const item of notifications || []) {
      const card = document.createElement("div");
      card.className = "notification-item";

      addChatText(card, "strong", "", item.sender_anonymous_name || "Anonymous");
      addChatText(card, "p", "", item.message_preview || "New message");
      addChatText(
        card,
        "p",
        "",
        formatChatDate(item.created_at) + (item.read_at ? "" : " · Unread")
      );

      if (item.conversation_id) {
        card.setAttribute("role", "button");
        card.tabIndex = 0;

        card.addEventListener("click", async () => {
          conversationHeading.textContent =
            item.sender_anonymous_name || "Anonymous conversation";
          await loadChatMessages(item.conversation_id);
        });
      }

      notificationList.appendChild(card);
      count++;
    }

    for (const item of anonymousMessages || []) {
      const card = document.createElement("div");
      card.className = "notification-item";

      addChatText(card, "strong", "", "New anonymous message");
      addChatText(card, "p", "", item.message_text);
      addChatText(
        card,
        "p",
        "",
        formatChatDate(item.created_at) + (item.is_read ? "" : " · New")
      );

      notificationList.appendChild(card);
      count++;
    }

    if (count === 0) {
      clearChatElement(
        notificationList,
        "No notifications or pending anonymous messages yet."
      );
    }

    if (anonymousError) {
      setChatStatus("Pending anonymous messages could not be loaded.");
    }
  }

})();
