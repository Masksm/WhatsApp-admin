
"use strict";

/* =========================================================
   AMORA AUTHENTICATION UI
   Browser-side presentation only.
   Does not connect to or modify Supabase.
   ========================================================= */

(() => {
  const nameInput = document.getElementById("auth-name");
  const nameRow = document.getElementById("auth-username-row");
  const randomButton = document.getElementById("auth-random-name");
  const authForm = document.getElementById("auth-form");

  if (!nameInput || !nameRow || !randomButton || !authForm) {
    return;
  }

  const adjectives = [
    "Velvet", "Cosmic", "Hidden", "Lovely", "Misty",
    "Golden", "Midnight", "Quiet", "Dreamy", "Lucky",
    "Secret", "Moonlit", "Gentle", "Wild", "Blushing",
    "Starry", "Rosy", "Silver", "Playful", "Mystic"
  ];

  const nouns = [
    "Moon", "Fox", "Rose", "Comet", "Cloud",
    "Phoenix", "Whisper", "Starlight", "Raven", "Petal",
    "Dreamer", "Sparrow", "Shadow", "Orchid", "Cupid",
    "Butterfly", "Echo", "Nova", "Firefly", "Wanderer"
  ];

  let previousName = "";

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function generateUsername() {
    let username = "";

    for (let attempt = 0; attempt < 10; attempt += 1) {
      username = `${randomItem(adjectives)}${randomItem(nouns)}`;

      if (username !== previousName) {
        break;
      }
    }

    previousName = username;
    nameInput.value = username;
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    nameInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  randomButton.addEventListener("click", () => {
    generateUsername();
    nameInput.focus();
  });

  /*
   * The existing auth.js controls whether the username input
   * is visible. Mirror that state on the entire username row
   * so the random button disappears during login.
   */

  function syncUsernameRow() {
    const isHidden =
      nameInput.hidden ||
      window.getComputedStyle(nameInput).display === "none";

    nameRow.hidden = isHidden;
  }

  const observer = new MutationObserver(syncUsernameRow);

  observer.observe(nameInput, {
    attributes: true,
    attributeFilter: ["style", "hidden", "required"]
  });

  syncUsernameRow();

  /*
   * Generate a suggested anonymous name when the user opens
   * the registration form and its name field is empty.
   */

  if (!nameInput.value.trim() && nameInput.required) {
    generateUsername();
  }

  /*
   * Keep the row synchronized after the existing auth UI
   * switches between login and signup.
   */

  authForm.addEventListener("click", () => {
    requestAnimationFrame(syncUsernameRow);
  });

  authForm.addEventListener("input", syncUsernameRow);
})();
