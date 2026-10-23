"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const composer = document.getElementById("composer");
  const textInput = document.getElementById("post-text");
  const imageInput = document.getElementById("post-image");
  const imagePreview = document.getElementById("image-preview");
  const hideIdentity = document.getElementById("hide-identity");
  const publishButton = document.getElementById("publish-post");
  const composerStatus = document.getElementById("composer-status");
  const feedList = document.getElementById("feed-list");
  const feedTabs = [...document.querySelectorAll("[data-feed]")];
  let selectedImage = null;
  let previewUrl = null;
  let activeFeed = "for-you";

  const supabase = window.amoraSupabase || null;

  document.querySelectorAll("[data-focus-composer]").forEach((button) => {
    button.addEventListener("click", () => {
      composer.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => textInput.focus(), 250);
    });
  });

  function updatePublishButton() {
    publishButton.disabled = !textInput.value.trim() && !selectedImage;
  }

  textInput.addEventListener("input", updatePublishButton);

  imageInput.addEventListener("change", () => {
    selectedImage = imageInput.files?.[0] || null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    imagePreview.replaceChildren();
    imagePreview.hidden = !selectedImage;

    if (selectedImage) {
      if (!selectedImage.type.startsWith("image/")) {
        selectedImage = null;
        imageInput.value = "";
        composerStatus.textContent = "Choose an image file.";
        imagePreview.hidden = true;
        updatePublishButton();
        return;
      }
      if (selectedImage.size > 8 * 1024 * 1024) {
        selectedImage = null;
        imageInput.value = "";
        composerStatus.textContent = "Images must be 8 MB or smaller.";
        imagePreview.hidden = true;
        updatePublishButton();
        return;
      }
      previewUrl = URL.createObjectURL(selectedImage);
      const img = document.createElement("img");
      img.src = previewUrl;
      img.alt = "Selected image preview";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-image";
      remove.setAttribute("aria-label", "Remove selected image");
      remove.textContent = "×";
      remove.addEventListener("click", clearImage);
      imagePreview.append(img, remove);
      composerStatus.textContent = "";
    }
    updatePublishButton();
  });

  function clearImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    selectedImage = null;
    imageInput.value = "";
    imagePreview.replaceChildren();
    imagePreview.hidden = true;
    updatePublishButton();
  }

  function setStatus(message, isError = false) {
    composerStatus.textContent = message;
    composerStatus.style.color = isError ? "#ff9aaa" : "";
  }

  feedTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeFeed = tab.dataset.feed;
      feedTabs.forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      if (activeFeed === "following") {
        showEmpty("Your Following feed will show posts from accounts you follow.");
      } else if (activeFeed === "public") {
        showEmpty("Public posts will appear here once the feed is connected to Amora's database.");
      } else {
        showEmpty("Share a thought, tell a story, or start a conversation. This space is yours to shape.");
      }
    });
  });

  function showEmpty(message) {
    feedList.replaceChildren();
    const card = document.createElement("div");
    card.className = "feed-empty card";
    const art = document.createElement("div");
    art.className = "empty-art";
    art.textContent = "♡";
    const heading = document.createElement("h2");
    heading.textContent = activeFeed === "following" ? "Your circle is growing" : activeFeed === "public" ? "The public feed is waiting" : "Your feed starts here";
    const copy = document.createElement("p");
    copy.textContent = message;
    card.append(art, heading, copy);
    feedList.append(card);
  }

  async function getCurrentUser() {
    if (!supabase) return { user: null, error: new Error("Supabase is not configured on this page.") };
    const { data, error } = await supabase.auth.getUser();
    return { user: data?.user || null, error };
  }

  publishButton.addEventListener("click", async () => {
    const body = textInput.value.trim();
    if (!body && !selectedImage) return;
    publishButton.disabled = true;
    setStatus("Checking your session…");

    try {
      const { user, error: authError } = await getCurrentUser();
      if (authError) throw authError;
      if (!user) {
        setStatus("Log in to publish a post. Your draft is still here.", true);
        window.location.href = "/pages/home.html?auth=login";
        return;
      }

      /*
       * Post persistence is intentionally not guessed here.
       * The existing project must have a verified posts schema and RLS
       * policies before this client writes user content to Supabase.
       */
      setStatus("The Home feed interface is ready, but publishing needs the verified posts table and privacy policies in Supabase.", true);
    } catch (error) {
      setStatus(error?.message || "Could not check your session.", true);
    } finally {
      updatePublishButton();
    }
  });

  // The page starts in an honest empty state until real database data is wired in.
  if (!supabase) {
    setStatus("Supabase did not load. Refresh the page and check the connection.");
  }
});
