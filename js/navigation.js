
(() => {
  "use strict";

  const validPages = [
    "home",
    "discover",
    "messages",
    "profile",
    "login"
  ];

  function getPageFromHash() {
    const requestedPage = window.location.hash.slice(1);

    return validPages.includes(requestedPage)
      ? requestedPage
      : "home";
  }

  function showPage(pageName) {
    const page = validPages.includes(pageName)
      ? pageName
      : "home";

    document.querySelectorAll("[data-section]").forEach((section) => {
      section.hidden = section.dataset.section !== page;
    });

    document.querySelectorAll("[data-page]").forEach((link) => {
      const isActive = link.dataset.page === page;

      link.classList.toggle("active", isActive);

      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function initializeNavigation() {
    showPage(getPageFromHash());

    window.addEventListener("hashchange", () => {
      showPage(getPageFromHash());
    });

    document.querySelectorAll("[data-page]").forEach((link) => {
      link.addEventListener("click", (event) => {
        const page = link.dataset.page;

        if (!validPages.includes(page)) {
          return;
        }

        event.preventDefault();

        if (window.location.hash === `#${page}`) {
          showPage(page);
        } else {
          window.location.hash = page;
        }
      });
    });

    document.querySelectorAll('a[href="#login"]').forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();

        if (window.location.hash === "#login") {
          showPage("login");
        } else {
          window.location.hash = "login";
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeNavigation
    );
  } else {
    initializeNavigation();
  }
})();
