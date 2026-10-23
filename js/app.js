/**
 * Amora application entry point.
 *
 * Feature modules are loaded separately so the application
 * remains organized as new features are added.
 */

import "./home.js";

import { initAuth } from "./auth.js";
import { initAnonymousLinks } from "./anonymous-links.js";
import { initAnonymousMessages } from "./anonymous-messages.js";
import { initMessages } from "./messages.js";
import { initNotifications } from "./notifications.js";

function startAmora() {
  initAuth();
  initAnonymousLinks();
  initAnonymousMessages();
  initMessages();
  initNotifications();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startAmora, {
    once: true
  });
} else {
  startAmora();
}
