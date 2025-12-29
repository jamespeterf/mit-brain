// src/webapp/public/js/meetings.js

function setLoading(isLoading, msg) {
  const overlay = document.getElementById("loadingOverlay");
  const msgEl = document.getElementById("loadingMsg");
  if (!overlay) return;

  if (msgEl) msgEl.textContent = msg || "Working…";
  overlay.classList.toggle("hidden", !isLoading);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderBullets(arr) {
  const items = Array.isArray(arr) ? arr : [];
  if (!items.length) return `<div class="muted">(none)</div>`;
  return `<ul>${items.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
}

function renderActionItems(actionItems) {
  const groups = Array.isArray(actionItems) ? actionItems : [];
  if (!groups.length) return `<div class="muted">(none)</div>`;

  return groups.map(g => {
    const owner = escapeHtml(g?.owner || "Unknown owner");
    const items = Array.isArray(g?.items) ? g.items : [];
    return `
      <div class="action-group">
        <div class="action-owner">${owner}</div>
        ${renderBullets(items)}
      </div>
    `;
  }).join("");
}

function renderSummaryUI(parsed) {
  // If you have a dedicated container, use it; otherwise reuse outputPre.
  const outEl = document.getElementById("outputPre");
  if (!outEl) return;

  const html = `
    <div class="summary-wrap">
      <h3>Summary</h3>
      ${renderBullets(parsed?.summary_bullets)}

      <h3>Action Items</h3>
      ${renderActionItems(parsed?.action_items)}

      <h3>Decisions</h3>
      ${renderBullets(parsed?.decisions)}

      <h3>Risks / Blockers</h3>
      ${renderBullets(parsed?.risks_blockers)}

      <h3>Signals</h3>
      ${renderBullets(parsed?.signals)}

      <h3>Objections</h3>
      ${renderBullets(parsed?.objections)}

      <h3>Draft Follow-up Email</h3>
      <div class="email-block">
        <div><strong>Subject:</strong> ${escapeHtml(parsed?.email?.subject || "")}</div>
        <pre class="email-pre">${escapeHtml(parsed?.email?.body_markdown || "")}</pre>
      </div>
    </div>

    <!-- Optional: keep raw JSON handy for debugging -->
    <details style="margin-top:14px;">
      <summary>Raw JSON</summary>
      <pre>${escapeHtml(JSON.stringify(parsed, null, 2))}</pre>
    </details>
  `;

  // outputPre is a <pre> in your current UI; if so, swap it to an element that can render HTML,
  // or we set innerHTML and accept it as the container.
  outEl.innerHTML = html;
}
function setLoading(isLoading, msg) {
  const overlay = document.getElementById("loadingOverlay");
  const msgEl = document.getElementById("loadingMsg");
  if (!overlay) return;

  if (msgEl) msgEl.textContent = msg || "Working…";
  overlay.classList.toggle("hidden", !isLoading);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderBullets(arr) {
  const items = Array.isArray(arr) ? arr : [];
  if (!items.length) return `<div class="muted">(none)</div>`;
  return `<ul>${items.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
}

function renderActionItems(actionItems) {
  const groups = Array.isArray(actionItems) ? actionItems : [];
  if (!groups.length) return `<div class="muted">(none)</div>`;

  return groups.map(g => {
    const owner = escapeHtml(g?.owner || "Unknown owner");
    const items = Array.isArray(g?.items) ? g.items : [];
    return `
      <div class="action-group">
        <div class="action-owner">${owner}</div>
        ${renderBullets(items)}
      </div>
    `;
  }).join("");
}

function renderSummaryUI(parsed) {
  // If you have a dedicated container, use it; otherwise reuse outputPre.
  const outEl = document.getElementById("outputPre");
  if (!outEl) return;

  const html = `
    <div class="summary-wrap">
      <h3>Summary</h3>
      ${renderBullets(parsed?.summary_bullets)}

      <h3>Action Items</h3>
      ${renderActionItems(parsed?.action_items)}

      <h3>Decisions</h3>
      ${renderBullets(parsed?.decisions)}

      <h3>Risks / Blockers</h3>
      ${renderBullets(parsed?.risks_blockers)}

      <h3>Signals</h3>
      ${renderBullets(parsed?.signals)}

      <h3>Objections</h3>
      ${renderBullets(parsed?.objections)}

      <h3>Draft Follow-up Email</h3>
      <div class="email-block">
        <div><strong>Subject:</strong> ${escapeHtml(parsed?.email?.subject || "")}</div>
        <pre class="email-pre">${escapeHtml(parsed?.email?.body_markdown || "")}</pre>
      </div>
    </div>

    <!-- Optional: keep raw JSON handy for debugging -->
    <details style="margin-top:14px;">
      <summary>Raw JSON</summary>
      <pre>${escapeHtml(JSON.stringify(parsed, null, 2))}</pre>
    </details>
  `;

  // outputPre is a <pre> in your current UI; if so, swap it to an element that can render HTML,
  // or we set innerHTML and accept it as the container.
  outEl.innerHTML = html;
}


let current = {
  dropbox_path: null,
  filename: null,
  modified: null,
  content_hash: null,
  raw_text: null
};

function linesToArray(text) {
  return (text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function setStatus(msg) {
  const el = document.getElementById("saveStatus");
  if (el) el.textContent = msg || "";
}

// Extract transcript/meeting content from various API shapes.
// Supports:
//  - { ok:true, content:"..." }
//  - { ok:true, text:"..." }
//  - Older buggy: { ok:true, text:{ contents:{ type:"Buffer", data:[...] } } }
//  - { ok:true, ... , contents:{ type:"Buffer", data:[...] } }
function extractTranscriptContent(payload) {
  if (!payload || typeof payload !== "object") return "";

  // 1) Common/current string shapes
  if (typeof payload.content === "string") return payload.content;
  if (typeof payload.text === "string") return payload.text;

  // 2) Buffer wrapper might be in content or text or nested under .contents
  const maybeBuf =
    payload?.content?.contents ||
    payload?.text?.contents ||
    payload?.content ||
    payload?.text ||
    payload?.contents;

  // 3) Buffer-as-JSON: { type:"Buffer", data:[...] }
  if (
    maybeBuf &&
    typeof maybeBuf === "object" &&
    maybeBuf.type === "Buffer" &&
    Array.isArray(maybeBuf.data)
  ) {
    try {
      return new TextDecoder("utf-8").decode(new Uint8Array(maybeBuf.data));
    } catch {
      return String.fromCharCode(...maybeBuf.data);
    }
  }

  // 4) Some APIs return { content: { ok:true, content:"..." } } (double-wrapped)
  if (payload.content && typeof payload.content === "object") {
    if (typeof payload.content.content === "string") return payload.content.content;
    if (typeof payload.content.text === "string") return payload.content.text;
  }
  if (payload.text && typeof payload.text === "object") {
    if (typeof payload.text.content === "string") return payload.text.content;
    if (typeof payload.text.text === "string") return payload.text.text;
  }

  return "";
}


// Unwrap API list responses that might be:
// 1) { ok:true, items:[...] }
// 2) { ok:true, items:{ ok:true, items:[...] } }
function unwrapListResponse(data) {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Bad response JSON", items: [] };
  }

  // Nested shape
  if (data.items && typeof data.items === "object" && Array.isArray(data.items.items)) {
    return {
      ok: !!data.ok && !!data.items.ok,
      items: data.items.items,
      error: data.error || data.items.error
    };
  }

  // Flat shape
  if (Array.isArray(data.items)) {
    return { ok: !!data.ok, items: data.items, error: data.error };
  }

  return {
    ok: !!data.ok,
    items: [],
    error: data.error || "No items array returned"
  };
}

async function loadList() {
  const tbody =
    document.getElementById("meetingsTbody") ||
    document.getElementById("transcriptsTbody");

  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="3">Loading…</td></tr>`;

  let raw;
  try {
    const res = await fetch("/api/transcripts/list");
    raw = await res.json();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3">Error: failed to fetch list</td></tr>`;
    return;
  }

  const data = unwrapListResponse(raw);

  if (!data.ok) {
    tbody.innerHTML = `<tr><td colspan="3">Error: ${data.error || "Unknown error"}</td></tr>`;
    return;
  }

  const items = data.items || [];

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="3">(No meetings found)</td></tr>`;
    return;
  }

  tbody.innerHTML = items
    .map((i) => {
      const mod = i.modified ? new Date(i.modified).toLocaleString() : "";
      const size = i.size ? Math.round(i.size / 1024) + " KB" : "";
      return `
        <tr>
          <td>
            <a href="#"
               data-path="${encodeURIComponent(i.path)}"
               data-name="${encodeURIComponent(i.name)}"
               data-mod="${encodeURIComponent(i.modified || "")}"
               data-hash="${encodeURIComponent(i.content_hash || "")}">
              ${i.name}
            </a>
          </td>
          <td>${mod}</td>
          <td>${size}</td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();

      current.dropbox_path = decodeURIComponent(a.dataset.path);
      current.filename = decodeURIComponent(a.dataset.name);
      current.modified = decodeURIComponent(a.dataset.mod) || null;
      current.content_hash = decodeURIComponent(a.dataset.hash) || null;

      const srcEl = document.getElementById("currentSource");
      if (srcEl) {
        srcEl.textContent = `Source: ${current.filename} (${current.dropbox_path})`;
      }

      let data;
      try {
        const res = await fetch(
          `/api/transcripts/get?path=${encodeURIComponent(current.dropbox_path)}`
        );
        data = await res.json();
      } catch (err) {
        alert("Error loading meeting: failed to fetch /api/transcripts/get");
        return;
      }

      if (!data.ok) {
        alert("Error loading meeting: " + (data.error || "Unknown error"));
        return;
      }

      // Important: /get returns { ok:true, content:"..." } (current)
      // but we support other shapes too.
      const content = extractTranscriptContent(data);

      current.raw_text = content;

      const textEl = document.getElementById("transcriptText");
      if (textEl) textEl.value = content || "(empty transcript)";

      const outEl = document.getElementById("outputPre");
      if (outEl) outEl.textContent = "(nothing yet)";

      setStatus("");
    });
  });
}

async function summarize() {
  const text = (document.getElementById("transcriptText")?.value) || "";
  if (!text.trim()) {
    alert("No transcript text loaded.");
    return;
  }

  const context = {
    company: document.getElementById("company")?.value?.trim() || "",
    meeting_type: document.getElementById("meetingType")?.value || "",
    goal: document.getElementById("goal")?.value || "",
    stage: document.getElementById("stage")?.value || "",
    desired_outcome: document.getElementById("desiredOutcome")?.value?.trim() || ""
  };

  try {
    setLoading(true, "Generating summary + action items…");

    const res = await fetch("/api/transcripts/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, context })
    });

    const data = await res.json();

    if (!data.ok) {
      alert("Error: " + data.error);
      return;
    }

    // Prefer parsed object
    if (data.parsed_ok && data.parsed) {
      // Render user-friendly UI
      renderSummaryUI(data.parsed);

      // Also hydrate signals/objections textareas if empty (nice UX)
      const signalsEl = document.getElementById("signals");
      const objectionsEl = document.getElementById("objections");

      if (signalsEl && !signalsEl.value.trim() && Array.isArray(data.parsed.signals)) {
        signalsEl.value = data.parsed.signals.join("\n");
      }
      if (objectionsEl && !objectionsEl.value.trim() && Array.isArray(data.parsed.objections)) {
        objectionsEl.value = data.parsed.objections.join("\n");
      }
    } else {
      // Fallback if server returned raw text
      const outEl = document.getElementById("outputPre");
      if (outEl) outEl.textContent = data.raw || "(no output)";
    }
  } finally {
    setLoading(false);
  }
}


async function saveAll() {
  if (!current.dropbox_path) {
    alert("Select a meeting first.");
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(document.getElementById("outputPre")?.textContent || "");
  } catch {}

  const payload = {
    source: {
      dropbox_path: current.dropbox_path,
      filename: current.filename,
      modified: current.modified,
      content_hash: current.content_hash
    },
    raw_text: current.raw_text,
    clean_text: document.getElementById("transcriptText")?.value || "",

    company: document.getElementById("company")?.value?.trim() || "",
    meeting_type: document.getElementById("meetingType")?.value || "",
    goal: document.getElementById("goal")?.value || "",
    stage: document.getElementById("stage")?.value || "",
    desired_outcome: document.getElementById("desiredOutcome")?.value?.trim() || "",
    signals: linesToArray(document.getElementById("signals")?.value || ""),
    objections: linesToArray(document.getElementById("objections")?.value || ""),

    summary_bullets: parsed?.summary_bullets || [],
    action_items: parsed?.action_items || [],
    decisions: parsed?.decisions || [],
    risks_blockers: parsed?.risks_blockers || [],
    email: parsed?.email || { subject: "", body_markdown: "" }
  };

  let data;
  try {
    const res = await fetch("/api/transcripts/case/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    data = await res.json();
  } catch {
    alert("Error saving: failed to fetch /api/transcripts/case/save");
    return;
  }

  if (!data.ok) {
    alert("Error saving: " + (data.error || "Unknown error"));
    return;
  }

  setStatus(`Saved case_id = ${data.case_id}`);
}

// Wire up buttons if present
document.getElementById("summarizeBtn")?.addEventListener("click", summarize);
document.getElementById("saveAllBtn")?.addEventListener("click", saveAll);
// Back-compat if HTML still uses the old id
document.getElementById("saveCaseBtn")?.addEventListener("click", saveAll);

loadList();
