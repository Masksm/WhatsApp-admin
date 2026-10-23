import { initAuth } from "./auth.js";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuth, { once: true });
} else {
  initAuth();
}
