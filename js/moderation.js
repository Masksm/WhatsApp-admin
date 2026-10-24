"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.amoraSupabase || null;
  const statusNode = document.getElementById("moderation-status");
  const contentNode = document.getElementById("moderation-content");
  const listNode = document.getElementById("report-list");
  const filterNode = document.getElementById("report-filter");
  const countNode = document.getElementById("report-count");
  const refreshButton = document.getElementById("refresh-reports");

  function status(message, error = false) {
    statusNode.textContent = message;
    statusNode.classList.toggle("is-error", error);
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function pretty(value) {
    return String(value || "pending").replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase());
  }

  if (!supabase) {
    status("Amora could not initialize its secure connection. Refresh the page and try again.", true);
    return;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session) {
    status("Sign in with your authorized moderator account to access this dashboard.", true);
    return;
  }
  const { data: tier, error: tierError } = await supabase.rpc("amora_moderator_tier");
  if (tierError || Number(tier || 0) < 2) {
    status("Access denied. This account does not have moderator privileges.", true);
    return;
  }
  status(Number(tier) >= 3 ? "Signed in · Senior moderator (Tier 3)" : "Signed in · Moderator (Tier 2)");
  contentNode.hidden = false;

  async function loadReports() {
    listNode.replaceChildren(element("p", "moderation-muted", "Loading reports…"));
    const selected = filterNode.value;
    let query = supabase.from("post_reports")
      .select("id, post_id, reporter_id, reason, created_at, status, admin_notes, reviewed_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (selected !== "all") query = query.eq("status", selected);
    const { data, error } = await query;
    if (error) {
      listNode.replaceChildren(element("p", "moderation-error", "Could not load reports. Confirm the moderator report-read policy is enabled."));
      countNode.textContent = "";
      return;
    }
    countNode.textContent = (data?.length || 0) + " report(s) shown · maximum 100 per load";
    const postIds = [...new Set((data || []).map(report => report.post_id).filter(Boolean))];
    const contextResult = postIds.length ? await supabase.rpc("moderator_get_report_post_context", { p_post_ids: postIds }) : { data: [], error: null };
    const postContexts = new Map((contextResult.data || []).map(post => [post.post_id, post]));
    listNode.replaceChildren();
    if (!data?.length) {
      listNode.append(element("p", "moderation-muted", "No reports in this filter."));
      return;
    }
    for (const report of data) {
      const card = element("article", "moderation-report");
      const heading = element("div", "moderation-report-heading");
      heading.append(element("strong", "", "Report " + report.id.slice(0, 8)));
      heading.append(element("span", "moderation-status-pill", pretty(report.status)));
      card.append(heading);
      const post = postContexts.get(report.post_id);
      const preview = element("section", "moderation-post-preview");
      preview.append(element("h3", "moderation-post-title", "Reported post"));
      if (contextResult.error) {
        preview.append(element("p", "moderation-error", "Post details could not be loaded. Check moderator post-context permissions."));
      } else if (!post) {
        preview.append(element("p", "moderation-muted", "The original post is unavailable. It may have been deleted."));
      } else {
        const author = post.is_anonymous ? "Anonymous post" : (post.author_display_name || "Amora user");
        preview.append(element("p", "moderation-post-author", author + " · " + (post.post_created_at ? new Date(post.post_created_at).toLocaleString() : "Date unknown")));
        preview.append(element("p", "moderation-post-content", post.post_content || "[This post contains no text.]"));
        if (post.post_visibility) preview.append(element("p", "moderation-muted", "Visibility: " + pretty(post.post_visibility)));
        (post.media_urls || []).forEach(url => {
          if (typeof url !== "string" || !/^https:\/\//i.test(url)) return;
          const mediaLink = element("a", "moderation-media-link", "Open attached media");
          mediaLink.href = url;
          mediaLink.target = "_blank";
          mediaLink.rel = "noopener noreferrer";
          preview.append(mediaLink);
        });
      }
      const postLink = element("a", "moderation-post-link", "Open Amora feed");
      postLink.href = "/pages/social-home.html";
      preview.append(postLink);
      card.append(preview);
      const details = element("dl", "moderation-details");
      for (const [label, value] of [
        ["Reason", report.reason],
        ["Post reference", report.post_id],
        ["Report submitted", report.created_at ? new Date(report.created_at).toLocaleString() : "Unknown"]
      ]) {
        details.append(element("dt", "", label), element("dd", "", String(value ?? "Not provided")));
      }
      card.append(details);
      const noteLabel = element("label", "moderation-label", "Decision notes");
      const notes = element("textarea", "moderation-notes");
      notes.rows = 2;
      notes.maxLength = 2000;
      notes.placeholder = "Optional internal note";
      notes.value = report.admin_notes || "";
      noteLabel.append(notes);
      card.append(noteLabel);
      const actions = element("div", "moderation-actions");
      for (const nextStatus of ["reviewed", "dismissed", "actioned"]) {
        const button = element("button", "moderation-action", pretty(nextStatus));
        button.type = "button";
        button.addEventListener("click", async () => {
          button.disabled = true;
          const { error: actionError } = await supabase.rpc("admin_update_post_report", {
            p_report_id: report.id,
            p_status: nextStatus,
            p_admin_notes: notes.value.trim() || null
          });
          button.disabled = false;
          if (actionError) {
            status("The report decision was not saved. Check your moderator permissions.", true);
            return;
          }
          status("Report decision saved: " + pretty(nextStatus) + ".");
          await loadReports();
        });
        actions.append(button);
      }
      card.append(actions);
      listNode.append(card);
    }
  }

  filterNode.addEventListener("change", loadReports);
  refreshButton.addEventListener("click", loadReports);
  await loadReports();
});
