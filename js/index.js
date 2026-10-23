
/* =========================================================
   AMORA LANDING PAGE
   File: js/index.js
   ========================================================= */

"use strict";

document.documentElement.classList.add("js-ready");

/* ---------------------------------------------------------
   Mobile navigation
   --------------------------------------------------------- */

const menuToggle = document.getElementById("menu-toggle");
const navLinks = document.getElementById("nav-links");

function closeNavigation() {
  if (!menuToggle || !navLinks) return;

  menuToggle.classList.remove("is-open");
  navLinks.classList.remove("is-open");

  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation menu");
}

if (menuToggle && navLinks) {
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";

    menuToggle.classList.toggle("is-open", !isOpen);
    navLinks.classList.toggle("is-open", !isOpen);

    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    menuToggle.setAttribute(
      "aria-label",
      isOpen ? "Open navigation menu" : "Close navigation menu"
    );
  });

  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeNavigation);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeNavigation();
    }
  });

  document.addEventListener("click", (event) => {
    if (
      navLinks.classList.contains("is-open") &&
      !navLinks.contains(event.target) &&
      !menuToggle.contains(event.target)
    ) {
      closeNavigation();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) {
      closeNavigation();
    }
  });
}

/* ---------------------------------------------------------
   Scroll reveal animations
   --------------------------------------------------------- */

const revealGroups = [
  {
    selector: ".section-heading",
    delay: false
  },
  {
    selector: ".activity-card",
    delay: true
  },
  {
    selector: ".feature-card",
    delay: true
  },
  {
    selector: ".step-item",
    delay: true
  },
  {
    selector: ".privacy-visual, .privacy-content",
    delay: false
  },
  {
    selector: ".final-cta-inner > *",
    delay: false
  },
  {
    selector: ".footer-main > *",
    delay: false
  }
];

revealGroups.forEach(({ selector, delay }) => {
  const elements = document.querySelectorAll(selector);

  elements.forEach((element, index) => {
    element.classList.add("reveal");

    if (delay && index % 4 < 3) {
      element.classList.add(`reveal-delay-${(index % 3) + 1}`);
    }
  });
});

const revealElements = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.12,
      rootMargin: "0px 0px -35px 0px"
    }
  );

  revealElements.forEach((element) => {
    revealObserver.observe(element);
  });
} else {
  revealElements.forEach((element) => {
    element.classList.add("is-visible");
  });
}

/* ---------------------------------------------------------
   Automatic copyright year
   --------------------------------------------------------- */

const currentYear = document.getElementById("current-year");

if (currentYear) {
  currentYear.textContent = new Date().getFullYear();
}

/* ---------------------------------------------------------
   Close the mobile menu when navigating back to the top
   --------------------------------------------------------- */

window.addEventListener("pageshow", () => {
  closeNavigation();
});
