
import {
  $,
  config,
  safeText,
  showToast,
  showStage
} from "./core.js";

// ============================================================
// LANDING PAGE STATISTICS, ACTIVITY, TESTIMONIALS AND FAQ
// ============================================================

let stats = { ...(config.stats || {}) };
let activity = [...(config.activity || [])];

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
// SURPRISE DEMO
// ============================================================

let queueTimer = null;
let countdownTimer = null;
let typingTimer = null;
let queueStarted = 0;
let currentLetter = "";
let audioContext = null;

function validatePhone(value) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function runQueue() {
  if (!$("#queue-stage")) return;

  showStage("#queue-stage");

  queueStarted = Date.now();

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
// EVENT LISTENERS
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
// INITIAL RENDER AND SIMULATED ACTIVITY
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

