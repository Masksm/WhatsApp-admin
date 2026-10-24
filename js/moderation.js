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
      const details = element("dl", "moderation-details");
      for (const [label, value] of [
        ["Reason", report.reason],
        ["Post ID", report.post_id],
        ["Reporter ID", report.reporter_id],
        ["Submitted", report.created_at ? new Date(report.created_at).toLocaleString() : "Unknown"],
        ["Admin notes", report.admin_notes || "None"]
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
