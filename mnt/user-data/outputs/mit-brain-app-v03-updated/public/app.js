// public/app.js

console.log("✅ app.js loaded");

/** ------------ Backend calls ------------ **/

async function fetchMatches(phrase, minScore) {
  const params = new URLSearchParams();
  params.set("phrase", phrase);
  params.set("minScore", minScore);

  const url = `/api/matches?${params.toString()}`;
  console.log("➡️ fetchMatches:", url);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }

  const data = await res.json();

  // Support either shape: [ {...} ] OR { matches: [ {...} ] }
  let matches;
  if (Array.isArray(data)) {
    matches = data;
  } else if (data && Array.isArray(data.matches)) {
    matches = data.matches;
  } else {
    matches = [];
  }

  console.log("⬅️ fetchMatches result:", {
    raw: data,
    length: matches.length,
  });

  return matches;
}

async function fetchMembers() {
  console.log("➡️ fetchMembers");
  const res = await fetch("/api/members");
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }
  const data = await res.json();
  console.log("⬅️ fetchMembers result:", data?.length);
  return data;
}

async function fetchMembersForPerson(personId) {
  console.log("➡️ fetchMembersForPerson", personId);
  const res = await fetch(`/api/members?personId=${encodeURIComponent(personId)}`);
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }
  const data = await res.json();
  console.log("⬅️ fetchMembersForPerson result:", data?.length);
  return data;
}

async function fetchPeople() {
  console.log("➡️ fetchPeople");
  const res = await fetch("/api/people");
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }
  const data = await res.json();
  console.log("⬅️ fetchPeople result:", data?.length);
  return data;
}

async function fetchPersonData(personId) {
  console.log("➡️ fetchPersonData", personId);
  const res = await fetch(`/api/people/${encodeURIComponent(personId)}/data`);
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }
  const data = await res.json();
  console.log("⬅️ fetchPersonData result:", data);
  return data;
}

async function fetchMemberIntro(member, selectedArticles, tone, language) {
  console.log("➡️ fetchMemberIntro", { member, count: selectedArticles.length, tone, language });
  const res = await fetch("/api/member-intro", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member, selectedArticles, tone, language }),
  });
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }
  const data = await res.json();
  console.log("⬅️ fetchMemberIntro");
  return data.intro;
}

async function fetchMemberArticleSummaries(member, selectedArticles, tone, language) {
  console.log("➡️ fetchMemberArticleSummaries", {
    member,
    count: selectedArticles.length,
    tone,
    language,
  });
  const res = await fetch("/api/member-article-summaries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member, selectedArticles, tone, language }),
  });
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }
  const data = await res.json();
  console.log("⬅️ fetchMemberArticleSummaries");
  return data.text;
}

async function fetchTemplateText(personId, templateId, member, selectedArticles, tone, language, myVoice) {
  console.log("➡️ fetchTemplateText", {
    personId,
    templateId,
    member,
    count: selectedArticles.length,
    tone,
    language,
  });
  const res = await fetch("/api/generate-template-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId, templateId, member, selectedArticles, tone, language, myVoice }),
  });
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }
  const data = await res.json();
  console.log("⬅️ fetchTemplateText");
  return data.text;
}

/** ------------ UI state + helpers ------------ **/

let lastResults = [];
let currentPersonData = null; // { personId, myVoice, templates }
let currentMembers = []; // Members for current person

function showStatus(message) {
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = message;
}

function showProgress(message) {
  const overlay = document.getElementById("progressOverlay");
  const textEl = document.getElementById("progressText");
  if (overlay) overlay.style.display = "flex";
  if (textEl) textEl.textContent = message || "Working…";
}

function hideProgress() {
  const overlay = document.getElementById("progressOverlay");
  if (overlay) overlay.style.display = "none";
}

function createArticleCard(article, index) {
  const card = document.createElement("div");
  card.className = "article-card";

  // Title with kind in parentheses (not hyperlinked)
  const titleDiv = document.createElement("div");
  titleDiv.className = "article-title";
  const link = document.createElement("a");
  link.href = article.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = article.title || "(No title)";
  titleDiv.appendChild(link);
  
  // Add kind in parentheses next to title (not hyperlinked)
  if (article.kind) {
    const kindSpan = document.createElement("span");
    kindSpan.textContent = ` (${article.kind})`;
    kindSpan.style.fontWeight = "normal";
    titleDiv.appendChild(kindSpan);
  }

  // Meta line with Published date and Score
  const metaDiv = document.createElement("div");
  metaDiv.className = "article-meta";
  const publishedDate = article.publishedAt || article.date || "";
  const score =
    typeof article.score === "number"
      ? article.score.toFixed(2)
      : article.score ?? "";
  
  const metaParts = [];
  if (publishedDate) {
    metaParts.push(`Published: ${publishedDate}`);
  }
  metaParts.push(`Score: ${score}`);
  
  metaDiv.textContent = metaParts.join(" · ");

  // ILP Summary (prioritize ilpSummary over summary)
  const summaryDiv = document.createElement("div");
  summaryDiv.className = "article-summary";
  summaryDiv.textContent = article.ilpSummary || article.summary || "";

  // ILP Keywords
  const keywordsDiv = document.createElement("div");
  keywordsDiv.className = "article-ilp-keywords";
  keywordsDiv.style.marginBottom = "6px";
  keywordsDiv.style.fontStyle = "italic";
  keywordsDiv.style.color = "#333";
  
  let keywordsText = "";
  if (Array.isArray(article.ilpKeywords)) {
    keywordsText = article.ilpKeywords.join(", ");
  } else if (typeof article.ilpKeywords === "string") {
    keywordsText = article.ilpKeywords;
  }
  
  if (keywordsText) {
    keywordsDiv.textContent = `🔑 ${keywordsText}`;
  }

  // Tags
  const tagsDiv = document.createElement("div");
  tagsDiv.className = "article-tags";
  const tagParts = [];
  if (article.keywords) tagParts.push(`Keywords: ${article.keywords}`);
  if (article.mitUnit) tagParts.push(`MIT Unit: ${article.mitUnit}`);
  if (article.industries) tagParts.push(`Industries: ${article.industries}`);
  if (article.techThemes) tagParts.push(`Tech: ${article.techThemes}`);
  if (article.ilpAudiences)
    tagParts.push(`Audience: ${article.ilpAudiences}`);
  tagsDiv.textContent = tagParts.join(" | ");

  // Checkbox
  const selectRow = document.createElement("div");
  selectRow.className = "article-select-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "article-select";
  checkbox.dataset.index = String(index);

  const label = document.createElement("span");
  label.textContent = " Include in email";

  selectRow.appendChild(checkbox);
  selectRow.appendChild(label);

  card.appendChild(selectRow);
  card.appendChild(titleDiv);
  card.appendChild(metaDiv);
  card.appendChild(summaryDiv);
  if (keywordsText) {
    card.appendChild(keywordsDiv);
  }
  card.appendChild(tagsDiv);

  return card;
}

function renderMatches(matches) {
  console.log("🧱 renderMatches", matches?.length);
  lastResults = Array.isArray(matches) ? matches : [];

  const container = document.getElementById("resultsContainer");
  if (!container) {
    console.warn("resultsContainer not found");
    return;
  }

  container.innerHTML = "";

  if (!lastResults.length) {
    container.textContent = "No matching articles found.";
    showStatus("No matching articles found.");
    return;
  }

  lastResults.forEach((article, index) => {
    const card = createArticleCard(article, index);
    container.appendChild(card);
  });

  showStatus(`Found ${lastResults.length} article(s).`);
}

function getSelectedArticles() {
  const container = document.getElementById("resultsContainer");
  if (!container) return [];

  const boxes = container.querySelectorAll("input.article-select");
  const selected = [];
  boxes.forEach((box) => {
    if (box.checked) {
      const idx = parseInt(box.dataset.index || "-1", 10);
      if (!Number.isNaN(idx) && lastResults[idx]) {
        selected.push(lastResults[idx]);
      }
    }
  });
  return selected;
}

function selectAllArticles() {
  const container = document.getElementById("resultsContainer");
  if (!container) return;
  const boxes = container.querySelectorAll("input.article-select");
  boxes.forEach((b) => (b.checked = true));
}

function deselectAllArticles() {
  const container = document.getElementById("resultsContainer");
  if (!container) return;
  const boxes = container.querySelectorAll("input.article-select");
  boxes.forEach((b) => (b.checked = false));
}

/** ------------ Event handlers ------------ **/

async function handleSearchClick() {
  const phraseEl = document.getElementById("phraseInput");
  const minScoreEl = document.getElementById("minScoreInput");

  const phrase = (phraseEl?.value || "").trim();
  const minScore = Number(minScoreEl?.value || 1);

  if (!phrase) {
    showStatus("Please enter a search phrase.");
    return;
  }

  // Get selected content types
  const selectedKinds = [];
  const kindCheckboxes = {
    'video': document.getElementById('kindVideo'),
    'news': document.getElementById('kindNews'),
    'paper': document.getElementById('kindPaper'),
    'startup': document.getElementById('kindStartup'),
    'event': document.getElementById('kindEvent')
  };

  // Check which kinds are selected
  for (const [kind, checkbox] of Object.entries(kindCheckboxes)) {
    if (checkbox && checkbox.checked) {
      selectedKinds.push(kind);
    }
  }

  console.log("🔍 Search params:", { phrase, minScore, selectedKinds });

  showStatus("Searching...");
  showProgress("Searching for matches...");

  try {
    let matches = await fetchMatches(phrase, minScore);
    
    // Filter by selected kinds if any are selected
    if (selectedKinds.length > 0) {
      matches = matches.filter(article => {
        const articleKind = (article.kind || '').toLowerCase();
        return selectedKinds.includes(articleKind);
      });
      console.log(`🔍 Filtered to ${matches.length} articles with kinds:`, selectedKinds);
    }

    renderMatches(matches);
  } catch (err) {
    console.error("Search error:", err);
    showStatus("Search error: " + err.message);
  } finally {
    hideProgress();
  }
}

function handleResultsClick(e) {
  if (e.target.classList.contains("article-link")) {
    e.preventDefault();
    const url = e.target.dataset.url;
    if (url) window.open(url, "_blank");
  }
}

async function handleGenerateEmailClick() {
  const selectedArticles = getSelectedArticles();
  const emailOutput = document.getElementById("emailOutput");
  const toneSelect = document.getElementById("toneSelect");
  const memberSelect = document.getElementById("memberSelect");
  const languageSelect = document.getElementById("languageSelect");
  const personSelect = document.getElementById("personSelect");
  const templateSelect = document.getElementById("templateSelect");

  const tone = toneSelect?.value || "familiar";
  const language = languageSelect?.value || "english";
  const personId = personSelect?.value || null;
  const templateId = templateSelect?.value || null;

  console.log("\n========================================");
  console.log("🔍 DEBUGGING handleGenerateEmailClick");
  console.log("========================================");
  console.log("1️⃣ Selected articles:", selectedArticles.length);
  console.log("2️⃣ Person:", personId);
  console.log("3️⃣ Template:", templateId);
  console.log("4️⃣ Tone:", tone);
  console.log("5️⃣ Language:", language);
  console.log("========================================\n");

  if (!selectedArticles.length) {
    if (emailOutput)
      emailOutput.innerHTML = "<p style='color: #999;'>Please select at least one article.</p>";
    return;
  }

  if (!personId) {
    if (emailOutput)
      emailOutput.innerHTML = "<p style='color: #999;'>Please select a program director first.</p>";
    return;
  }

  // Get selected member and their data
  let member = null;
  if (memberSelect && memberSelect.value && currentMembers.length > 0) {
    const selectedMemberName = memberSelect.value;
    const memberRecord = currentMembers.find(
      m => m.memberName === selectedMemberName || 
           m.commonName1 === selectedMemberName || 
           m.commonName2 === selectedMemberName
    );
    if (memberRecord) {
      member = memberRecord;
    } else {
      member = { memberName: selectedMemberName };
    }
  }

  showProgress("Asking AI to draft your text...");
  try {
    // Get myVoice text if tone is myvoice
    const myVoice = (tone === "myvoice" && currentPersonData?.myVoice) ? currentPersonData.myVoice : null;

    // Use new template-based endpoint
    const text = await fetchTemplateText(
      personId,
      templateId,
      member,
      selectedArticles,
      tone,
      language,
      myVoice
    );

    // Display the generated text
    // Convert line breaks to HTML
    const htmlText = text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
    
    let html = `<div style="font-family: Arial, sans-serif; line-height: 1.6;">`;
    html += `<p>${htmlText}</p>`;
    html += `</div>`;

    if (emailOutput) {
      emailOutput.innerHTML = html;
    }

    hideProgress();
  } catch (err) {
    hideProgress();
    console.error("Error generating text:", err);
    if (emailOutput) {
      emailOutput.innerHTML = `<p style="color: #d32f2f;">Error: ${err.message}</p>`;
    }
  }
}

    if (emailOutput) {
      emailOutput.innerHTML = html;
      console.log("\n✅ Email HTML set to emailOutput.innerHTML");
      console.log("   emailOutput element:", emailOutput);
      console.log("   Links in DOM:", emailOutput.querySelectorAll('a').length);
    }
  } catch (err) {
    console.error("Error generating email:", err);
    if (emailOutput) emailOutput.innerHTML = "<p style='color: #c00;'>Error generating email text.</p>";
  } finally {
    hideProgress();
  }
}

function handleCopyEmailClick() {
  const emailOutput = document.getElementById("emailOutput");
  if (!emailOutput) return;

  // Create a range and select the content
  const range = document.createRange();
  range.selectNodeContents(emailOutput);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  try {
    const ok = document.execCommand("copy");
    if (ok) {
      showStatus("Email copied to clipboard (with formatting).");
    } else {
      showStatus("Unable to copy email.");
    }
  } catch (err) {
    console.error("Copy failed:", err);
    showStatus("Copy failed.");
  }

  sel.removeAllRanges();
}

function handleClearFormClick() {
  const phraseEl = document.getElementById("phraseInput");
  const minScoreEl = document.getElementById("minScoreInput");
  const resultsContainer = document.getElementById("resultsContainer");
  const emailOutput = document.getElementById("emailOutput");

  if (phraseEl) phraseEl.value = "";
  if (minScoreEl) minScoreEl.value = "";
  if (resultsContainer) resultsContainer.innerHTML = "";
  if (emailOutput) emailOutput.innerHTML = "";
  lastResults = [];
  showStatus("Cleared.");
}

// ---------- Kind filter handlers ----------

function handleSelectAllKinds() {
  const checkboxes = [
    'kindVideo',
    'kindNews', 
    'kindPaper',
    'kindStartup',
    'kindEvent'
  ];
  
  checkboxes.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.checked = true;
    }
  });
  
  console.log("✅ All kinds selected");
}

function handleDeselectAllKinds() {
  const checkboxes = [
    'kindVideo',
    'kindNews',
    'kindPaper', 
    'kindStartup',
    'kindEvent'
  ];
  
  checkboxes.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.checked = false;
    }
  });
  
  console.log("❌ All kinds deselected");
}

// ---------- Person and template handlers ----------

async function handlePersonSelect() {
  const personSelect = document.getElementById("personSelect");
  const templateSelect = document.getElementById("templateSelect");
  const memberSelect = document.getElementById("memberSelect");
  const personOptions = document.getElementById("personOptions");
  
  const personId = personSelect?.value;
  
  if (!personId) {
    // Hide options if no person selected
    if (personOptions) personOptions.style.display = "none";
    currentPersonData = null;
    currentMembers = [];
    return;
  }
  
  try {
    showProgress("Loading person data...");
    
    // Fetch person data and members in parallel
    const [personData, members] = await Promise.all([
      fetchPersonData(personId),
      fetchMembersForPerson(personId)
    ]);
    
    currentPersonData = personData;
    currentMembers = members;
    
    // Populate templates
    if (templateSelect && personData.templates) {
      templateSelect.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Select a template...";
      templateSelect.appendChild(opt);
      
      personData.templates.forEach(template => {
        const o = document.createElement("option");
        o.value = template.id;
        o.textContent = template.name;
        templateSelect.appendChild(o);
      });
    }
    
    // Populate members
    if (memberSelect) {
      memberSelect.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(Optional: tailor to member)";
      memberSelect.appendChild(opt);
      
      members.forEach(m => {
        const o = document.createElement("option");
        o.value = m.memberName || m.commonName1 || m.commonName2 || "";
        o.textContent = m.commonName1 || m.commonName2 || m.memberName || "Unnamed member";
        memberSelect.appendChild(o);
      });
    }
    
    // Show the person options section
    if (personOptions) personOptions.style.display = "block";
    
    hideProgress();
    console.log(`✅ Loaded data for ${personData.personId}`);
    console.log(`   Templates: ${personData.templates.length}`);
    console.log(`   Members: ${members.length}`);
  } catch (err) {
    hideProgress();
    console.error("Error loading person data:", err);
    alert(`Error loading data for ${personId}: ${err.message}`);
  }
}

/** ------------ Init ------------ **/

async function init() {
  console.log("🚀 init() running");

  const searchButton = document.getElementById("searchButton");
  const resultsPanel = document.getElementById("resultsPanel");
  const generateEmailButton = document.getElementById("generateEmailButton");
  const copyEmailButton = document.getElementById("copyEmailButton");
  const selectAllButton = document.getElementById("selectAllButton");
  const deselectAllButton = document.getElementById("deselectAllButton");
  const clearFormButton = document.getElementById("clearFormButton");
  const memberSelect = document.getElementById("memberSelect");
  const selectAllKindsButton = document.getElementById("selectAllKinds");
  const deselectAllKindsButton = document.getElementById("deselectAllKinds");

  if (searchButton) {
    searchButton.addEventListener("click", handleSearchClick);
  } else {
    console.warn("searchButton not found");
  }

  if (resultsPanel) {
    resultsPanel.addEventListener("click", handleResultsClick);
  }

  if (generateEmailButton) {
    generateEmailButton.addEventListener("click", handleGenerateEmailClick);
  }

  if (copyEmailButton) {
    copyEmailButton.addEventListener("click", handleCopyEmailClick);
  }

  if (selectAllButton) {
    selectAllButton.addEventListener("click", selectAllArticles);
  }

  if (deselectAllButton) {
    deselectAllButton.addEventListener("click", deselectAllArticles);
  }

  if (clearFormButton) {
    clearFormButton.addEventListener("click", handleClearFormClick);
  }

  if (selectAllKindsButton) {
    selectAllKindsButton.addEventListener("click", handleSelectAllKinds);
  }

  if (deselectAllKindsButton) {
    deselectAllKindsButton.addEventListener("click", handleDeselectAllKinds);
  }

  // Load people into dropdown
  const personSelect = document.getElementById("personSelect");
  if (personSelect) {
    personSelect.addEventListener("change", handlePersonSelect);
    
    try {
      const people = await fetchPeople();
      personSelect.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Select a person...";
      personSelect.appendChild(opt);

      (people || []).forEach((person) => {
        const o = document.createElement("option");
        o.value = person.id;
        o.textContent = person.name;
        personSelect.appendChild(o);
      });
      
      console.log(`✅ Loaded ${people.length} people`);
    } catch (err) {
      console.error("Error loading people:", err);
    }
  }

  showStatus("Ready.");
}

document.addEventListener("DOMContentLoaded", init);