// src/webapp/public/js/transcripts.js
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
  document.getElementById("saveStatus").textContent = msg || "";
}

async function loadList() {
  const res = await fetch("/api/transcripts/list");
  const data = await res.json();
  const tbody = document.getElementById("transcriptsTbody");

  if (!data.ok) {
    tbody.innerHTML = `<tr><td colspan="3">Error: ${data.error}</td></tr>`;
    return;
  }

  tbody.innerHTML = data.items
    .map((i) => {
      const mod = i.modified ? new Date(i.modified).toLocaleString() : "";
      const size = i.size ? Math.round(i.size / 1024) + " KB" : "";
      return `
        <tr>
          <td><a href="#" data-path="${encodeURIComponent(i.path)}"
                       data-name="${encodeURIComponent(i.name)}"
                       data-mod="${encodeURIComponent(i.modified || "")}"
                       data-hash="${encodeURIComponent(i.content_hash || "")}">${i.name}</a></td>
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

      document.getElementById("currentSource").textContent =
        `Source: ${current.filename} (${current.dropbox_path})`;

      const res = await fetch(`/api/transcripts/get?path=${encodeURIComponent(current.dropbox_path)}`);
      const data = await res.json();
      if (!data.ok) {
        alert("Error loading transcript: " + data.error);
        return;
      }

      current.raw_text = data.text;
      document.getElementById("transcriptText").value = data.text;
      document.getElementById("outputPre").textContent = "(nothing yet)";
      setStatus("");
    });
  });
}

async function summarize() {
  const text = document.getElementById("transcriptText").value;

  const context = {
    company: document.getElementById("company").value.trim(),
    meeting_type: document.getElementById("meetingType").value,
    goal: document.getElementById("goal").value,
    stage: document.getElementById("stage").value,
    desired_outcome: document.getElementById("desiredOutcome").value.trim()
  };

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

  // Show parsed nicely if possible
  if (data.parsed_ok && data.parsed) {
    document.getElementById("outputPre").textContent = JSON.stringify(data.parsed, null, 2);

    // Also hydrate signals/objections fields if empty (nice UX)
    const signalsEl = document.getElementById("signals");
    const objectionsEl = document.getElementById("objections");

    if (!signalsEl.value.trim() && Array.isArray(data.parsed.signals)) {
      signalsEl.value = data.parsed.signals.join("\n");
    }
    if (!objectionsEl.value.trim() && Array.isArray(data.parsed.objections)) {
      objectionsEl.value = data.parsed.objections.join("\n");
    }
  } else {
    document.getElementById("outputPre").textContent = data.raw;
  }
}

async function saveCase() {
  if (!current.dropbox_path) {
    alert("Select a transcript first.");
    return;
  }

  // Try to reuse parsed output if present
  let parsed = null;
  try {
    parsed = JSON.parse(document.getElementById("outputPre").textContent);
  } catch {}

  const payload = {
    source: {
      dropbox_path: current.dropbox_path,
      filename: current.filename,
      modified: current.modified,
      content_hash: current.content_hash
    },
    raw_text: current.raw_text,
    clean_text: document.getElementById("transcriptText").value,

    company: document.getElementById("company").value.trim(),
    meeting_type: document.getElementById("meetingType").value,
    goal: document.getElementById("goal").value,
    stage: document.getElementById("stage").value,
    desired_outcome: document.getElementById("desiredOutcome").value.trim(),
    signals: linesToArray(document.getElementById("signals").value),
    objections: linesToArray(document.getElementById("objections").value),

    // Optional output bundle
    summary_bullets: parsed?.summary_bullets || [],
    action_items: parsed?.action_items || [],
    decisions: parsed?.decisions || [],
    risks_blockers: parsed?.risks_blockers || [],
    email: parsed?.email || { subject: "", body_markdown: "" }
  };

  const res = await fetch("/api/transcripts/case/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!data.ok) {
    alert("Error saving case: " + data.error);
    return;
  }

  setStatus(`Saved case_id = ${data.case_id}`);
}

async function saveRecommendation() {
  const status = document.getElementById("saveStatus").textContent || "";
  const caseIdMatch = status.match(/case_id = ([a-f0-9]{16})/);
  const caseId = caseIdMatch ? caseIdMatch[1] : null;

  if (!caseId) {
    alert("Save Case first (so we have a case_id).");
    return;
  }

  const payload = {
    case_id: caseId,
    pd: "Jim Flynn",
    insights: linesToArray(document.getElementById("insights").value),
    recommended_moves: linesToArray(document.getElementById("moves").value),
    email_angle: document.getElementById("emailAngle").value.trim(),
    confidence: document.getElementById("confidence").value
  };

  const res = await fetch("/api/transcripts/recommendation/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!data.ok) {
    alert("Error saving recommendation: " + data.error);
    return;
  }

  setStatus(`Saved PD recommendation (case_id = ${caseId})`);
}

document.getElementById("summarizeBtn").addEventListener("click", summarize);
document.getElementById("saveCaseBtn").addEventListener("click", saveCase);
document.getElementById("saveRecBtn").addEventListener("click", saveRecommendation);

loadList();
