// public/app.js

console.log("✅ app.js loaded");

/** ------------ Helper Functions ------------ **/

// Helper function to parse and clean mitGroups field
// Handles nested JSON-encoded strings like: ["[\"[\\\"MIT ILP\\\"]\"]"]
function parseMitGroups(mitGroups) {
  if (!mitGroups) return '';
  
  let groups = mitGroups;
  
  // If it's a string, try to parse it as JSON
  if (typeof groups === 'string') {
    try {
      groups = JSON.parse(groups);
    } catch (e) {
      // If parsing fails, just use the string as-is
      return groups;
    }
  }
  
  // If it's an array, process it
  if (Array.isArray(groups)) {
    // Flatten and parse any nested JSON strings
    const flattened = [];
    
    for (let item of groups) {
      if (typeof item === 'string') {
        try {
          // Try to parse if it's a JSON string
          const parsed = JSON.parse(item);
          if (Array.isArray(parsed)) {
            // Recursively parse nested arrays
            const nested = parseMitGroups(parsed);
            if (nested) {
              flattened.push(...nested.split(', '));
            }
          } else {
            flattened.push(String(parsed));
          }
        } catch (e) {
          // Not JSON, just use the string
          flattened.push(item);
        }
      } else {
        flattened.push(String(item));
      }
    }
    
    // Remove duplicates and join
    return [...new Set(flattened.filter(Boolean))].join(', ');
  }
  
  return String(groups);
}

// Helper function to parse keywords (same logic as parseMitGroups)
function parseKeywords(keywords) {
  return parseMitGroups(keywords); // Reuse the same logic
}

// Helper function to strip XML/MathML tags from text
function stripXML(text) {
  if (!text || typeof text !== 'string') return text;
  
  // Remove XML/MathML tags (e.g., <mml:math>...</mml:math>)
  return text.replace(/<[^>]+>/g, '').trim();
}

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

async function fetchTemplateText(personId, templateId, member, selectedArticles, tone, language, myVoice, excludeItemType) {
  console.log("➡️ fetchTemplateText", {
    personId,
    templateId,
    member,
    count: selectedArticles.length,
    tone,
    language,
    excludeItemType,
  });
  const res = await fetch("/api/generate-template-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId, templateId, member, selectedArticles, tone, language, myVoice, excludeItemType }),
  });
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }
  const data = await res.json();
  console.log("⬅️ fetchTemplateText");
  return data; // Returns { text, subject }
}

async function fetchRegenerateSubject(member, emailText, language) {
  console.log("➡️ fetchRegenerateSubject");
  const res = await fetch("/api/regenerate-subject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member, emailText, language }),
  });
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }
  const data = await res.json();
  console.log("⬅️ fetchRegenerateSubject");
  return data.subject;
}

/** ------------ UI state + helpers ------------ **/

let lastResults = [];          // what is currently rendered (sorted + filtered)
let lastRawResults = [];       // raw results from the server (after kind filter)
let currentPersonData = null; // { personId, myVoice, templates }
let currentMembers = []; // Members for current person
let currentSubjectLine = ""; // Current subject line
let lastGenerationParams = null; // Store params for regenerating subject
let currentSort = "score-desc"; // Current sort order

// Date-range filter state (applies to whatever date field the current sort uses)
let currentDateRange = { from: "", to: "" }; // YYYY-MM-DD strings (or "")

function getActiveDateFieldForSort(sortOrder) {
  if (sortOrder === "date-asc") return "published";
  if (sortOrder === "event-asc") return "event";
  return null;
}

function normalizeToYMD(d) {
  // Returns YYYY-MM-DD or "" if invalid
  if (!d) return "";
  try {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function passesDateRange(article, activeField, fromYMD, toYMD) {
  if (!activeField) return true;

  // If no range is set, don't filter.
  if (!fromYMD && !toYMD) return true;

  // Choose which date we compare against
  let rawDate = "";
  if (activeField === "published") {
    rawDate = article.date || article.publishedAt || "";
  } else if (activeField === "event") {
    // Only events have event dates; non-events should not pass when filtering by event date.
    if (article.kind !== "future_event") return false;
    rawDate = article.futureEventDate || "";
  }

  const ymd = normalizeToYMD(rawDate);
  if (!ymd) return false;

  if (fromYMD && ymd < fromYMD) return false;
  if (toYMD && ymd > toYMD) return false;
  return true;
}

function applySortAndDateFilter(rawResults) {
  const activeField = getActiveDateFieldForSort(currentSort);
  const fromYMD = currentDateRange.from;
  const toYMD = currentDateRange.to;

  const filtered = Array.isArray(rawResults)
    ? rawResults.filter((a) => passesDateRange(a, activeField, fromYMD, toYMD))
    : [];

  const sorted = sortResults(filtered, currentSort);
  return sorted;
}

function updateDateRangeUI() {
  const controls = document.getElementById("dateRangeControls");
  const label = document.getElementById("dateRangeLabel");
  const fromEl = document.getElementById("dateFrom");
  const toEl = document.getElementById("dateTo");

  if (!controls || !label || !fromEl || !toEl) return;

  const activeField = getActiveDateFieldForSort(currentSort);
  if (!activeField) {
    controls.style.display = "none";
    // Reset range when date sorting is not active (keeps behavior simple/predictable)
    currentDateRange = { from: "", to: "" };
    fromEl.value = "";
    toEl.value = "";
    return;
  }

  controls.style.display = "flex";
  label.textContent = activeField === "event" ? "Event date:" : "Publish date:";
  // Keep inputs in sync with state
  fromEl.value = currentDateRange.from;
  toEl.value = currentDateRange.to;
}

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

function showSmartMatchDialog(matches) {
  const overlay = document.getElementById("smartMatchOverlay");
  const listContainer = document.getElementById("smartMatchList");
  const closeButton = document.getElementById("smartMatchCloseButton");
  
  if (!overlay || !listContainer || !closeButton) {
    console.error("Smart Match dialog elements not found");
    return;
  }
  
  // Clear previous content
  listContainer.innerHTML = "";
  
  // Create list of matched items with checkboxes
  matches.forEach((match, idx) => {
    const item = document.createElement("div");
    item.className = "match-item";
    
    // Add checkbox
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "match-item-checkbox";
    checkbox.checked = true; // Default to checked
    checkbox.dataset.url = match.url; // Store URL for later
    
    // Container for title and reason
    const content = document.createElement("div");
    content.className = "match-item-content";
    
    const title = document.createElement("div");
    title.className = "match-item-title";
    title.textContent = `${idx + 1}. ${match.title}`;
    
    const reason = document.createElement("div");
    reason.className = "match-item-reason";
    reason.textContent = match.reason;
    
    content.appendChild(title);
    content.appendChild(reason);
    
    item.appendChild(checkbox);
    item.appendChild(content);
    listContainer.appendChild(item);
  });
  
  // Show the dialog
  overlay.style.display = "flex";
  
  // Set up close handler (one-time)
  const handleClose = () => {
    // Hide dialog
    overlay.style.display = "none";
    
    // Get only the checked items
    const checkboxes = listContainer.querySelectorAll(".match-item-checkbox");
    const selectedMatches = [];
    checkboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        // Find the original match by URL
        const match = matches.find(m => m.url === checkbox.dataset.url);
        if (match) selectedMatches.push(match);
      }
    });
    
    // Check boxes for selected items only
    checkMatchedBoxes(selectedMatches);
    
    // Remove this handler
    closeButton.removeEventListener("click", handleClose);
  };
  
  closeButton.addEventListener("click", handleClose);
  
  // Also allow clicking overlay background to close
  const handleOverlayClick = (e) => {
    if (e.target === overlay) {
      handleClose();
      overlay.removeEventListener("click", handleOverlayClick);
    }
  };
  
  overlay.addEventListener("click", handleOverlayClick);
}

function checkMatchedBoxes(matches) {
  const container = document.getElementById("resultsContainer");
  if (!container) {
    console.error("Results container not found");
    return;
  }

  // Normalize URL for comparison (trim whitespace, handle encoding)
  const normalizeUrl = (url) => {
    if (!url) return "";
    return url.trim();
  };

  // Extract URLs from matches and create a Set for fast lookup
  const matchedUrls = matches.map(m => normalizeUrl(m.url));
  const matchedUrlSet = new Set(matchedUrls);
  console.log("🔍 checkMatchedBoxes - matchedUrls:", matchedUrls.length, "items");

  let checkedCount = 0;
  const boxes = container.querySelectorAll("input.article-select");
  console.log("🔍 Total checkboxes in results:", boxes.length);

  // Build a map of normalized box URLs for reverse lookup
  const boxUrlMap = new Map();
  boxes.forEach((box) => {
    const normalizedUrl = normalizeUrl(box.dataset.url);
    boxUrlMap.set(normalizedUrl, box);
  });

  // FIRST: Deselect all boxes
  boxes.forEach((box) => {
    box.checked = false;
  });

  // THEN: Select boxes that match
  const unmatchedUrls = [];
  matchedUrls.forEach((url) => {
    const box = boxUrlMap.get(url);
    if (box) {
      box.checked = true;
      checkedCount++;
    } else {
      unmatchedUrls.push(url);
    }
  });

  // Log unmatched URLs for debugging
  if (unmatchedUrls.length > 0) {
    console.warn(`⚠️ ${unmatchedUrls.length} URLs from Smart Match not found in results:`);
    unmatchedUrls.forEach(url => console.warn("   Missing:", url));
  }

  showStatus(`Smart Match complete: ${checkedCount} items selected.`);
  console.log(`✅ Checked ${checkedCount} of ${matchedUrls.length} matched boxes`);
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

  // For person kind, prepend first and last name
  if (article.kind === 'person' && (article.firstName || article.lastName)) {
    const firstName = article.firstName || '';
    const lastName = article.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim();
    const title = stripXML(article.title) || "(No title)";
    link.textContent = fullName ? `${fullName}, ${title}` : title;
  } else {
    link.textContent = stripXML(article.title) || "(No title)";
  }

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
  summaryDiv.textContent = stripXML(article.ilpSummary || article.summary || "");

  // ILP Keywords
  const keywordsDiv = document.createElement("div");
  keywordsDiv.className = "article-ilp-keywords";
  keywordsDiv.style.marginBottom = "6px";
  keywordsDiv.style.fontStyle = "italic";
  keywordsDiv.style.color = "#333";
  
  const keywordsText = parseKeywords(article.ilpKeywords);
  
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
  checkbox.dataset.url = article.url || "";  // Store URL instead of index

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
  
  // Add event details for future_event items
  if (article.kind === 'future_event') {
    const eventDetailsDiv = document.createElement("div");
    eventDetailsDiv.className = "article-event-details";
    eventDetailsDiv.style.marginTop = "8px";
    eventDetailsDiv.style.padding = "8px";
    eventDetailsDiv.style.background = "#f0f8ff";
    eventDetailsDiv.style.borderLeft = "3px solid #0065a4";
    eventDetailsDiv.style.fontSize = "0.9rem";

    const eventParts = [];

    // Format date properly
    if (article.futureEventDate) {
      let dateStr = article.futureEventDate;
      // Handle if it's already a formatted string (YYYY-MM-DD)
      if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        eventParts.push(`Event Date: ${dateStr}`);
      } else {
        // Try to parse and format the date
        try {
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            const formatted = date.toISOString().split('T')[0];
            eventParts.push(`Event Date: ${formatted}`);
          }
        } catch (e) {
          // If parsing fails, just use the raw value
          eventParts.push(`Event Date: ${dateStr}`);
        }
      }
    }

    // MIT Groups
    if (article.mitGroups) {
      const mitGroupsStr = parseMitGroups(article.mitGroups);
      if (mitGroupsStr) {
        eventParts.push(`MIT Groups: ${mitGroupsStr}`);
      }
    }

    if (article.location) {
      eventParts.push(`Location: ${article.location}`);
    }
    if (article.eventType) {
      eventParts.push(`Event Type: ${article.eventType}`);
    }

    if (eventParts.length > 0) {
      eventDetailsDiv.textContent = eventParts.join(' | ');
      card.appendChild(eventDetailsDiv);
    }
  }

  // Add person details for person items
  if (article.kind === 'person') {
    const personDetailsDiv = document.createElement("div");
    personDetailsDiv.className = "article-person-details";
    personDetailsDiv.style.marginTop = "8px";
    personDetailsDiv.style.padding = "8px";
    personDetailsDiv.style.background = "#f9f3ff";
    personDetailsDiv.style.borderLeft = "3px solid #9b59b6";
    personDetailsDiv.style.fontSize = "0.9rem";

    const personParts = [];

    if (article.dlc) {
      personParts.push(`DLC: ${article.dlc}`);
    }
    if (article.mitPeopleCategory) {
      personParts.push(`Role: ${article.mitPeopleCategory}`);
    }
    if (article.email) {
      personParts.push(`Email: ${article.email}`);
    }

    if (personParts.length > 0) {
      personDetailsDiv.textContent = personParts.join(' | ');
      card.appendChild(personDetailsDiv);
    }
  }

  return card;
}

function sortResults(results, sortOrder) {
  const sorted = [...results]; // Create a copy to avoid mutating original
  
  switch (sortOrder) {
    case "score-desc":
      // Sort by score descending (highest first)
      sorted.sort((a, b) => (b.score || 0) - (a.score || 0));
      break;
      
    case "date-asc":
      // Sort by publish date ascending (oldest first)
      sorted.sort((a, b) => {
        const dateA = new Date(a.date || a.publishedAt || 0);
        const dateB = new Date(b.date || b.publishedAt || 0);
        return dateA - dateB;
      });
      break;
      
    case "event-asc":
      // Sort by event date ascending (soonest first)
      // Put non-events at the end
      sorted.sort((a, b) => {
        const isEventA = a.kind === 'future_event';
        const isEventB = b.kind === 'future_event';
        
        // Non-events go to the end
        if (!isEventA && isEventB) return 1;
        if (isEventA && !isEventB) return -1;
        if (!isEventA && !isEventB) return 0;
        
        // Both are events - sort by futureEventDate
        const dateA = new Date(a.futureEventDate || '9999-12-31');
        const dateB = new Date(b.futureEventDate || '9999-12-31');
        return dateA - dateB;
      });
      break;
      
    default:
      console.warn("Unknown sort order:", sortOrder);
  }
  
  return sorted;
}

function renderMatches(matches) {
  console.log("🧱 renderMatches", matches?.length);
  // Keep a raw copy so we can re-render on sort/date-range changes without refetching.
  lastRawResults = Array.isArray(matches) ? matches : [];

  const container = document.getElementById("resultsContainer");
  if (!container) {
    console.warn("resultsContainer not found");
    return;
  }

  container.innerHTML = "";

  if (!lastRawResults.length) {
    container.textContent = "No matching items found.";
    showStatus("No matching items found.");
    return;
  }

  // Apply date range filter (if active) + sort
  const displayResults = applySortAndDateFilter(lastRawResults);
  console.log(`📊 Sorted by: ${currentSort} (date-filter field: ${getActiveDateFieldForSort(currentSort) || 'none'})`);

  // What we render is also the authoritative ordering for selection.
  lastResults = displayResults;

  displayResults.forEach((article, index) => {
    const card = createArticleCard(article, index);
    container.appendChild(card);
  });

  // If a date range is active, make that clear in the status line.
  const activeField = getActiveDateFieldForSort(currentSort);
  const hasRange = !!(currentDateRange.from || currentDateRange.to);
  if (activeField && hasRange) {
    showStatus(`Found ${lastResults.length} item(s) (filtered by ${activeField} date).`);
  } else {
    showStatus(`Found ${lastResults.length} item(s).`);
  }
}

function getSelectedArticles() {
  const container = document.getElementById("resultsContainer");
  if (!container) return [];

  // Get all checked checkboxes
  const boxes = container.querySelectorAll("input.article-select:checked");
  
  // Build a set of selected URLs for fast lookup
  const selectedUrls = new Set();
  boxes.forEach((box) => {
    const url = box.dataset.url;
    if (url) selectedUrls.add(url);
  });
  
  // Filter lastResults (which is already sorted correctly)
  // The filter preserves order, so selected articles will be in display order
  const selectedArticles = lastResults.filter(article => 
    selectedUrls.has(article.url)
  );
  
  console.log(`📋 Selected ${selectedArticles.length} articles in ${currentSort} order`);
  
  return selectedArticles;
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
  const dateFromEl = document.getElementById("dateFrom");
  const dateToEl = document.getElementById("dateTo");

  let phrase = (phraseEl?.value || "").trim();
  let minScore = Number(minScoreEl?.value || 1);
  const dateFrom = dateFromEl?.value || "";
  const dateTo = dateToEl?.value || "";

  if (!phrase) {
    showStatus("Please enter a search phrase.");
    return;
  }

  // Handle "*" as wildcard (search for everything)
  if (phrase === "*") {
    console.log("🌟 Wildcard search detected - will return all content");
    minScore = 0; // Set minScore to 0 to get all results
    // Keep phrase as "*" - server handles it properly
  }

  // Get selected content types
  const selectedKinds = [];
  const kindCheckboxes = {
    'video': document.getElementById('kindVideo'),
    'article': document.getElementById('kindNews'),
    'paper': document.getElementById('kindPaper'),
    'startup': document.getElementById('kindStartup'),
    'event': document.getElementById('kindEvent'),
    'person': document.getElementById('kindPerson')
  };

  // Check which kinds are selected
  for (const [kind, checkbox] of Object.entries(kindCheckboxes)) {
    if (checkbox && checkbox.checked) {
      selectedKinds.push(kind);
    }
  }

  console.log("🔍 Search params:", { phrase, minScore, dateFrom, dateTo, selectedKinds });

  showStatus("Searching...");
  showProgress("Searching for matches...");

  try {
    // Build the query URL with selected filters
    let url = `/api/matches?phrase=${encodeURIComponent(phrase)}&minScore=${minScore}`;
    
    // Add date range if specified
    if (dateFrom) {
      url += `&dateFrom=${encodeURIComponent(dateFrom)}`;
    }
    if (dateTo) {
      url += `&dateTo=${encodeURIComponent(dateTo)}`;
    }

    console.log("➡️ Fetching:", url);
    const res = await fetch(url);
    
    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    let matches = await res.json();
    console.log("⬅️ Received:", matches?.length, "matches");
    
    // Filter by selected kinds if any are selected
    if (selectedKinds.length > 0) {
      matches = matches.filter(article => {
        const articleKind = (article.kind || '').toLowerCase();
        
        // Special handling: "event" checkbox maps to "future_event" kind
        for (const selectedKind of selectedKinds) {
          if (selectedKind === 'event' && articleKind === 'future_event') {
            return true;
          }
          if (selectedKind === articleKind) {
            return true;
          }
        }
        
        return false;
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
  const excludeItemTypeCheckbox = document.getElementById("excludeItemTypeCheckbox");

  const tone = toneSelect?.value || "familiar";
  const language = languageSelect?.value || "english";
  const personId = personSelect?.value || null;
  const templateId = templateSelect?.value || null;
  const excludeItemType = excludeItemTypeCheckbox?.checked || false;

  console.log("\n========================================");
  console.log("🔍 DEBUGGING handleGenerateEmailClick");
  console.log("========================================");
  console.log("1️⃣ Selected articles:", selectedArticles.length);
  console.log("2️⃣ Person:", personId);
  console.log("3️⃣ Template:", templateId);
  console.log("4️⃣ Tone:", tone);
  console.log("5️⃣ Language:", language);
  console.log("6️⃣ Exclude item type:", excludeItemType);
  console.log("========================================\n");

  if (!selectedArticles.length) {
    if (emailOutput)
      emailOutput.innerHTML = "<p style='color: #999;'>Please select at least one item.</p>";
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
    const result = await fetchTemplateText(
      personId,
      templateId,
      member,
      selectedArticles,
      tone,
      language,
      myVoice,
      excludeItemType
    );
    
    const text = result.text;
    const subject = result.subject;
    
    // Store for regeneration
    currentSubjectLine = subject;
    lastGenerationParams = {
      member,
      language,
      emailText: text
    };

    // Display the subject line
    const subjectInput = document.getElementById("subjectLine");
    const subjectSection = document.getElementById("subjectSection");
    if (subjectInput) {
      subjectInput.value = subject;
    }
    if (subjectSection) {
      subjectSection.style.display = "block";
    }

    // Display the generated text
    // Simplified HTML for Outlook compatibility - avoid <div>, <p>, complex styles
    
    let html = '';
    
    // Split text into sections (intro, articles, closing)
    const sections = text.split('\n\n');
    
    sections.forEach((section, idx) => {
      // Check if this section looks like an article (has a title matching our selected articles)
      let matchedArticle = null;
      for (const article of selectedArticles) {
        if (section.includes(article.title)) {
          matchedArticle = article;
          break;
        }
      }
      
      if (matchedArticle) {
        // This is an article section - format with clickable title
        const lines = section.split('\n');
        const titleLine = lines[0];
        const summaryLines = lines.slice(1).join('\n');
        
        // Bold link for title (Outlook-friendly)
        html += `<strong><a href="${matchedArticle.url}">${titleLine}</a></strong><br>`;
        // Summary with line breaks
        html += summaryLines.replace(/\n/g, '<br>');
        // Double line break for paragraph spacing
        html += '<br><br>';
      } else {
        // Regular text section (intro or closing)
        html += section.replace(/\n/g, '<br>');
        // Double line break for paragraph spacing
        html += '<br><br>';
      }
    });
    
    // Remove trailing breaks
    html = html.replace(/(<br>)+$/, '');

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

async function handleRegenerateSubject() {
  if (!lastGenerationParams) {
    showStatus("Please generate text first.");
    return;
  }

  const subjectInput = document.getElementById("subjectLine");
  
  showProgress("Regenerating subject line...");
  try {
    const newSubject = await fetchRegenerateSubject(
      lastGenerationParams.member,
      lastGenerationParams.emailText,
      lastGenerationParams.language
    );
    
    currentSubjectLine = newSubject;
    if (subjectInput) {
      subjectInput.value = newSubject;
    }
    
    hideProgress();
    showStatus("Subject line regenerated.");
  } catch (err) {
    hideProgress();
    console.error("Error regenerating subject:", err);
    showStatus("Error regenerating subject line.");
  }
}

function handleCopySubject() {
  const subjectInput = document.getElementById("subjectLine");
  if (!subjectInput || !subjectInput.value) {
    showStatus("No subject line to copy.");
    return;
  }

  // Select and copy the text
  subjectInput.select();
  subjectInput.setSelectionRange(0, 99999); // For mobile devices

  try {
    const ok = document.execCommand("copy");
    if (ok) {
      showStatus("Subject line copied to clipboard.");
    } else {
      // Fallback to navigator.clipboard
      navigator.clipboard.writeText(subjectInput.value).then(() => {
        showStatus("Subject line copied to clipboard.");
      }).catch(err => {
        console.error("Copy failed:", err);
        showStatus("Unable to copy subject line.");
      });
    }
  } catch (err) {
    console.error("Copy failed:", err);
    showStatus("Copy failed.");
  }

  // Remove selection
  window.getSelection().removeAllRanges();
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
      showStatus("HTML copied to clipboard.");
    } else {
      showStatus("Unable to copy.");
    }
  } catch (err) {
    console.error("Copy failed:", err);
    showStatus("Copy failed.");
  }

  sel.removeAllRanges();
}

function handleCopyPlainTextClick() {
  const emailOutput = document.getElementById("emailOutput");
  if (!emailOutput) return;

  // Extract plain text from HTML
  let plainText = emailOutput.innerHTML;
  
  // Convert <br> and <br/> to newlines
  plainText = plainText.replace(/<br\s*\/?>/gi, '\n');
  
  // Remove <strong> tags but keep content
  plainText = plainText.replace(/<\/?strong>/gi, '');
  
  // Convert links: <a href="url">text</a> becomes "text (url)"
  plainText = plainText.replace(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, '$2 ($1)');
  
  // Remove any remaining HTML tags
  plainText = plainText.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  const textarea = document.createElement('textarea');
  textarea.innerHTML = plainText;
  plainText = textarea.value;
  
  // Clean up excessive newlines (more than 2 in a row)
  plainText = plainText.replace(/\n{3,}/g, '\n\n');
  
  // Trim leading/trailing whitespace
  plainText = plainText.trim();

  // Copy to clipboard
  try {
    navigator.clipboard.writeText(plainText).then(() => {
      showStatus("Plain text copied to clipboard.");
    }).catch(err => {
      // Fallback for older browsers
      const tempTextarea = document.createElement('textarea');
      tempTextarea.value = plainText;
      tempTextarea.style.position = 'fixed';
      tempTextarea.style.opacity = '0';
      document.body.appendChild(tempTextarea);
      tempTextarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(tempTextarea);
      if (ok) {
        showStatus("Plain text copied to clipboard.");
      } else {
        showStatus("Unable to copy plain text.");
      }
    });
  } catch (err) {
    console.error("Copy failed:", err);
    showStatus("Copy failed.");
  }
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
    'kindEvent',
    'kindPerson'
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
    'kindEvent',
    'kindPerson'
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

async function handleSmartMatch() {
  console.log("\n========================================");
  console.log("🤖 SMART MATCH INITIATED");
  console.log("========================================");

  const memberSelect = document.getElementById("memberSelect");
  const personSelect = document.getElementById("personSelect");
  
  const memberName = memberSelect?.value || "";
  const personId = personSelect?.value || "";

  // Validation
  if (!memberName) {
    showStatus("Please select an ILP member first.");
    alert("Please select an ILP member to use Smart Match.");
    return;
  }

  if (!personId) {
    showStatus("Please select a program director first.");
    alert("Please select a program director first.");
    return;
  }

  if (lastResults.length === 0) {
    showStatus("No search results to match.");
    alert("Please perform a search first to get results to match.");
    return;
  }

  console.log("📊 Smart Match Params:");
  console.log("   Member:", memberName);
  console.log("   Person:", personId);
  console.log("   Results to analyze:", lastResults.length);

  showProgress("🤖 AI is analyzing matches...");

  try {
    // Get member profile
    const memberRecord = currentMembers.find(
      (m) =>
        m.memberName === memberName ||
        m.commonName1 === memberName ||
        m.commonName2 === memberName
    );

    if (!memberRecord) {
      throw new Error("Member profile not found");
    }

    const phrases = memberRecord.phrases || [];
    console.log("   Member phrases:", phrases);
    
    // NEW: Extract additional profile fields
    const memberProfile = {
      mainIndustry: memberRecord.mainIndustry || "",
      description: memberRecord.description || "",
      geographicConsiderations: memberRecord.geographicConsiderations || ""
    };
    console.log("   Member profile:", memberProfile);

    // Prepare articles for matching (include location for geographic matching)
    const articlesForMatching = lastResults.map(a => ({
      url: a.url,
      title: a.title,
      kind: a.kind,
      summary: a.ilpSummary || a.summary || "",
      keywords: a.ilpKeywords || a.keywords || "",
      industries: a.industries || "",
      techThemes: a.techThemes || "",
      mitGroups: a.mitGroups || [],
      location: a.location || ""  // For events
    }));

    // Call API
    const response = await fetch("/api/smart-match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        memberName,
        memberPhrases: phrases,
        memberProfile: memberProfile,  // NEW: Send member profile
        articles: articlesForMatching,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const matches = data.matches || [];

    console.log("✅ AI returned", matches.length, "matches");
    console.log("Match details:", matches);

    hideProgress();

    if (matches.length === 0) {
      showStatus("Smart Match found no relevant items.");
      alert("No relevant matches found. Try a different search or member.");
      return;
    }

    // Show dialog with match details
    showSmartMatchDialog(matches);
    
    console.log("========================================\n");

  } catch (err) {
    hideProgress();
    console.error("Smart Match error:", err);
    showStatus("Smart Match failed: " + err.message);
    alert("Smart Match failed: " + err.message);
  }
}



/** ------------ Alert Handlers ------------ **/

async function handleCreateAlert() {
  console.log("📬 Create Alert clicked");
  
  const memberSelect = document.getElementById("memberSelect");
  const personSelect = document.getElementById("personSelect");
  const phraseEl = document.getElementById("phraseInput");
  const minScoreEl = document.getElementById("minScoreInput");
  const dateFromEl = document.getElementById("dateFrom");
  const dateToEl = document.getElementById("dateTo");
  
  const memberName = memberSelect?.value || "";
  const personId = personSelect?.value || "";
  const phrase = phraseEl?.value || "";
  const minScore = minScoreEl?.value || "1";
  const dateFrom = dateFromEl?.value || "";
  const dateTo = dateToEl?.value || "";
  
  // Validation
  if (!memberName) {
    alert("Please select an ILP member first.");
    return;
  }
  
  if (!personId) {
    alert("Please select a program director first.");
    return;
  }
  
  if (!phrase) {
    alert("Please enter a search phrase first.");
    return;
  }
  
  // Get selected content types
  const selectedKinds = [];
  const kindCheckboxes = {
    'video': document.getElementById('kindVideo'),
    'article': document.getElementById('kindNews'),
    'paper': document.getElementById('kindPaper'),
    'startup': document.getElementById('kindStartup'),
    'event': document.getElementById('kindEvent'),
    'person': document.getElementById('kindPerson')
  };
  
  for (const [kind, checkbox] of Object.entries(kindCheckboxes)) {
    if (checkbox && checkbox.checked) {
      selectedKinds.push(kind);
    }
  }
  
  // Get member profile
  const memberRecord = currentMembers.find(
    (m) =>
      m.memberName === memberName ||
      m.Member === memberName ||
      m.commonName1 === memberName ||
      m.commonName2 === memberName
  );
  
  if (!memberRecord) {
    alert("Member profile not found.");
    return;
  }
  
  // Populate dialog with current settings
  document.getElementById("alertName").value = `${memberName} - ${phrase.substring(0, 30)}`;
  
  // Show current search config
  const searchConfigHTML = `
    <div><strong>Phrase:</strong> ${phrase}</div>
    <div><strong>Min Score:</strong> ${minScore}</div>
    ${dateFrom ? `<div><strong>Date From:</strong> ${dateFrom}</div>` : ''}
    ${dateTo ? `<div><strong>Date To:</strong> ${dateTo}</div>` : ''}
    <div><strong>Content Types:</strong> ${selectedKinds.length > 0 ? selectedKinds.join(', ') : 'All'}</div>
  `;
  document.getElementById("alertCurrentSearch").innerHTML = searchConfigHTML;
  
  // Show member profile
  const memberProfileHTML = `
    <div><strong>Member:</strong> ${memberName}</div>
    ${memberRecord.phrases ? `<div><strong>Key Interests:</strong> ${memberRecord.phrases.join(', ')}</div>` : ''}
    ${memberRecord.mainIndustry ? `<div><strong>Industry:</strong> ${memberRecord.mainIndustry}</div>` : ''}
    ${memberRecord.description ? `<div><strong>Description:</strong> ${memberRecord.description.substring(0, 100)}...</div>` : ''}
  `;
  document.getElementById("alertMemberProfile").innerHTML = memberProfileHTML;
  
  // Store alert config temporarily
  window.pendingAlertConfig = {
    personId,
    memberName,
    memberProfile: {
      phrases: memberRecord.phrases || [],
      mainIndustry: memberRecord.mainIndustry || "",
      description: memberRecord.description || "",
      geographicConsiderations: memberRecord.geographicConsiderations || ""
    },
    searchParams: {
      phrase,
      minScore: Number(minScore),
      dateFrom,
      dateTo,
      contentTypes: selectedKinds
    }
  };
  
  // Show dialog
  document.getElementById("createAlertOverlay").style.display = "flex";
}

async function handleSaveAlert() {
  const alertName = document.getElementById("alertName").value.trim();
  const alertEmail = document.getElementById("alertEmail").value.trim();
  const alertFrequency = document.getElementById("alertFrequency").value;
  const alertSendTime = document.getElementById("alertSendTime").value;
  const useSmartMatch = document.getElementById("alertUseSmartMatch").checked;
  const relevanceThreshold = Number(document.getElementById("alertRelevanceThreshold")?.value || 7);
  
  if (!alertName) {
    alert("Please enter an alert name.");
    return;
  }
  
  if (!alertEmail) {
    alert("Please enter an email address.");
    return;
  }
  
  // Email validation
  const emailRegex = /^[^s@]+@[^s@]+.[^s@]+$/;
  if (!emailRegex.test(alertEmail)) {
    alert("Please enter a valid email address.");
    return;
  }
  
  if (!window.pendingAlertConfig) {
    alert("Alert configuration missing. Please try again.");
    return;
  }
  
  const alertConfig = {
    ...window.pendingAlertConfig,
    alertName,
    emailSettings: {
      recipientEmail: alertEmail,
      frequency: alertFrequency,
      sendTime: alertSendTime
    },
    useSmartMatch,
    relevanceThreshold,
    active: true
  };
  
  console.log("💾 Saving alert:", alertConfig);
  
  showProgress("Creating alert...");
  
  try {
    const response = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alertConfig)
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    
    const result = await response.json();
    console.log("✅ Alert created:", result);
    
    // Close dialog
    document.getElementById("createAlertOverlay").style.display = "none";
    
    // Show success message
    showStatus(`✓ Alert "${alertName}" created successfully!`);
    alert(`Alert "${alertName}" created successfully!\n\nYou will receive email notifications at ${alertEmail} when new matches are found.`);
    
    // Refresh alerts list
    await loadAlerts();
    
    // Show alerts panel
    document.getElementById("alertsPanel").style.display = "block";
    
  } catch (err) {
    console.error("Error creating alert:", err);
    showStatus("Error creating alert: " + err.message);
    alert("Error creating alert: " + err.message);
  } finally {
    hideProgress();
  }
}

async function loadAlerts() {
  const personSelect = document.getElementById("personSelect");
  const personId = personSelect?.value || "";
  
  if (!personId) {
    return;
  }
  
  console.log("📋 Loading alerts for:", personId);
  
  try {
    const response = await fetch(`/api/alerts?personId=${encodeURIComponent(personId)}`);
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    
    const data = await response.json();
    const alerts = data.alerts || [];
    
    console.log("✅ Loaded", alerts.length, "alerts");
    
    renderAlerts(alerts);
    
  } catch (err) {
    console.error("Error loading alerts:", err);
    document.getElementById("alertsList").innerHTML = `
      <p style="color: #e74c3c;">Error loading alerts: ${err.message}</p>
    `;
  }
}

function renderAlerts(alerts) {
  const alertsList = document.getElementById("alertsList");
  
  if (alerts.length === 0) {
    alertsList.innerHTML = `
      <p style="color: #666; font-style: italic;">No alerts created yet. Create one to get started!</p>
    `;
    return;
  }
  
  alertsList.innerHTML = alerts.map(alert => `
    <div class="alert-card" style="border: 1px solid #ddd; border-radius: 5px; padding: 15px; margin-bottom: 15px; background: ${alert.active ? '#fff' : '#f5f5f5'};">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
        <div>
          <h4 style="margin: 0 0 5px 0; color: #e67e22;">${alert.alertName}</h4>
          <div style="font-size: 0.85em; color: #666;">
            <div>Member: <strong>${alert.memberName}</strong></div>
            <div>Search: "${alert.searchParams.phrase}"</div>
            <div>Email: ${alert.emailSettings.recipientEmail}</div>
            <div>Frequency: ${alert.emailSettings.frequency} at ${alert.emailSettings.sendTime}</div>
          </div>
        </div>
        <div>
          <span style="display: inline-block; padding: 4px 8px; background: ${alert.active ? '#27ae60' : '#95a5a6'}; color: white; border-radius: 3px; font-size: 0.8em;">
            ${alert.active ? '✓ Active' : '⏸ Paused'}
          </span>
        </div>
      </div>
      
      ${alert.metadata?.lastRunAt ? `
        <div style="font-size: 0.85em; color: #666; padding: 10px; background: #f9f9f9; border-radius: 3px; margin-bottom: 10px;">
          <div>Last run: ${new Date(alert.metadata.lastRunAt).toLocaleString()}</div>
          <div>Last matches: ${alert.metadata.lastMatchCount || 0}</div>
        </div>
      ` : ''}
      
      <div style="display: flex; gap: 8px;">
        <button onclick="runAlertNow('${alert.alertId}')" style="padding: 6px 12px; background: #3498db; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.85em;">
          ▶ Run Now
        </button>
        <button onclick="toggleAlertStatus('${alert.alertId}', ${!alert.active})" style="padding: 6px 12px; background: ${alert.active ? '#f39c12' : '#27ae60'}; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.85em;">
          ${alert.active ? '⏸ Pause' : '▶ Resume'}
        </button>
        <button onclick="deleteAlert('${alert.alertId}')" style="padding: 6px 12px; background: #e74c3c; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.85em;">
          🗑 Delete
        </button>
      </div>
    </div>
  `).join('');
}

async function runAlertNow(alertId) {
  const personSelect = document.getElementById("personSelect");
  const personId = personSelect?.value || "";
  
  if (!personId) {
    alert("Please select a program director.");
    return;
  }
  
  console.log("▶ Running alert:", alertId);
  
  showProgress("Running alert...");
  
  try {
    const response = await fetch(`/api/alerts/${alertId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId })
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    
    const result = await response.json();
    
    hideProgress();
    
    if (result.matches.length === 0) {
      showStatus("No new matches found.");
      alert("No new matches found for this alert.");
    } else {
      showStatus(`Found ${result.matches.length} new matches!`);
      alert(`Found ${result.matches.length} new matches!\n\n${result.emailSent ? 'Email notification sent.' : 'Check server logs for details.'}`);
    }
    
    // Refresh alerts to show updated lastRun info
    await loadAlerts();
    
  } catch (err) {
    hideProgress();
    console.error("Error running alert:", err);
    showStatus("Error running alert: " + err.message);
    alert("Error running alert: " + err.message);
  }
}

async function toggleAlertStatus(alertId, newStatus) {
  const personSelect = document.getElementById("personSelect");
  const personId = personSelect?.value || "";
  
  if (!personId) {
    alert("Please select a program director.");
    return;
  }
  
  console.log(`${newStatus ? '▶' : '⏸'} Toggling alert:`, alertId);
  
  try {
    const response = await fetch(`/api/alerts/${alertId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId, active: newStatus })
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    
    showStatus(`Alert ${newStatus ? 'resumed' : 'paused'}`);
    
    // Refresh alerts list
    await loadAlerts();
    
  } catch (err) {
    console.error("Error toggling alert:", err);
    alert("Error toggling alert: " + err.message);
  }
}

async function deleteAlert(alertId) {
  if (!confirm("Are you sure you want to delete this alert?")) {
    return;
  }
  
  const personSelect = document.getElementById("personSelect");
  const personId = personSelect?.value || "";
  
  if (!personId) {
    alert("Please select a program director.");
    return;
  }
  
  console.log("🗑 Deleting alert:", alertId);
  
  try {
    const response = await fetch(`/api/alerts/${alertId}?personId=${encodeURIComponent(personId)}`, {
      method: "DELETE"
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    
    showStatus("Alert deleted");
    
    // Refresh alerts list
    await loadAlerts();
    
  } catch (err) {
    console.error("Error deleting alert:", err);
    alert("Error deleting alert: " + err.message);
  }
}



function getScoreColor(score) {
  if (score >= 9) return '#27ae60'; // Green - exceptional
  if (score >= 7) return '#2ecc71'; // Light green - highly relevant
  if (score >= 5) return '#f39c12'; // Orange - moderately relevant
  if (score >= 3) return '#e67e22'; // Dark orange - somewhat relevant
  return '#95a5a6'; // Gray - weakly relevant
}



async function testEmailConfiguration() {
  const alertEmail = document.getElementById("alertEmail")?.value;
  
  if (!alertEmail) {
    alert("Please enter an email address in the alert dialog first.");
    return;
  }
  
  const emailRegex = /^[^s@]+@[^s@]+.[^s@]+$/;
  if (!emailRegex.test(alertEmail)) {
    alert("Please enter a valid email address.");
    return;
  }
  
  console.log("📧 Testing email configuration...");
  showProgress("Sending test email...");
  
  try {
    const response = await fetch("/api/test-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientEmail: alertEmail })
    });
    
    const result = await response.json();
    
    hideProgress();
    
    if (response.ok) {
      showStatus("✓ Test email sent successfully!");
      alert(`✅ Test email sent successfully to ${alertEmail}!\n\nCheck your inbox (and spam folder) to confirm email delivery.`);
    } else {
      showStatus("Error: " + result.error);
      alert(`❌ Error sending test email:\n\n${result.error}\n\n${result.details || ''}`);
    }
    
  } catch (err) {
    hideProgress();
    console.error("Error testing email:", err);
    showStatus("Error testing email");
    alert("Error testing email: " + err.message);
  }
}

/** ------------ Init ------------ **/

async function init() {
  console.log("🚀 init() running");

  const searchButton = document.getElementById("searchButton");
  const resultsPanel = document.getElementById("resultsPanel");
  const generateEmailButton = document.getElementById("generateEmailButton");
  const copyEmailButton = document.getElementById("copyEmailButton");
  const copyPlainTextButton = document.getElementById("copyPlainTextButton");
  const selectAllButton = document.getElementById("selectAllButton");
  const deselectAllButton = document.getElementById("deselectAllButton");
  const clearFormButton = document.getElementById("clearFormButton");
  const memberSelect = document.getElementById("memberSelect");
  const selectAllKindsButton = document.getElementById("selectAllKinds");
  const deselectAllKindsButton = document.getElementById("deselectAllKinds");
  const regenerateSubjectButton = document.getElementById("regenerateSubjectButton");
  const copySubjectButton = document.getElementById("copySubjectButton");

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

  if (copyPlainTextButton) {
    copyPlainTextButton.addEventListener("click", handleCopyPlainTextClick);
  }

  if (selectAllButton) {
    selectAllButton.addEventListener("click", selectAllArticles);
  }

  if (deselectAllButton) {
    deselectAllButton.addEventListener("click", deselectAllArticles);
  }

  // Sort dropdown handler
  const sortSelect = document.getElementById("sortSelect");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      currentSort = e.target.value;
      console.log(`🔄 Sort changed to: ${currentSort}`);
      // Re-render from the raw results so we don't "double filter".
      if (lastRawResults.length > 0) {
        renderMatches(lastRawResults);
      }
    });
  }

  // Date range controls
  const dateFromEl = document.getElementById("dateFrom");
  const dateToEl = document.getElementById("dateTo");
  const clearDateRangeButton = document.getElementById("clearDateRangeButton");

  const handleDateRangeChange = () => {
    currentDateRange = {
      from: (dateFromEl?.value || "").trim(),
      to: (dateToEl?.value || "").trim(),
    };
    console.log("📅 Date range changed:", currentDateRange);
    if (lastRawResults.length > 0) renderMatches(lastRawResults);
  };

  if (dateFromEl) dateFromEl.addEventListener("change", handleDateRangeChange);
  if (dateToEl) dateToEl.addEventListener("change", handleDateRangeChange);
  if (clearDateRangeButton) {
    clearDateRangeButton.addEventListener("click", () => {
      if (dateFromEl) dateFromEl.value = "";
      if (dateToEl) dateToEl.value = "";
      currentDateRange = { from: "", to: "" };
      console.log("📅 Date range cleared");
      if (lastRawResults.length > 0) renderMatches(lastRawResults);
      updateDateRangeUI();
    });
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

  if (regenerateSubjectButton) {
    regenerateSubjectButton.addEventListener("click", handleRegenerateSubject);
  }

  if (copySubjectButton) {
    copySubjectButton.addEventListener("click", handleCopySubject);
  }

  // Smart Match button
  const smartMatchButton = document.getElementById("smartMatchButton");
  if (smartMatchButton) {
    smartMatchButton.addEventListener("click", handleSmartMatch);
  }

  // Create Alert button
  const createAlertButton = document.getElementById("createAlertButton");
  if (createAlertButton) {
    createAlertButton.addEventListener("click", handleCreateAlert);
  }

  // Alert dialog buttons
  const cancelAlertButton = document.getElementById("cancelAlertButton");
  if (cancelAlertButton) {
    cancelAlertButton.addEventListener("click", () => {
      document.getElementById("createAlertOverlay").style.display = "none";
    });
  }

  const saveAlertButton = document.getElementById("saveAlertButton");
  if (saveAlertButton) {
    saveAlertButton.addEventListener("click", handleSaveAlert);
  }

  // Test email button
  const testEmailButton = document.getElementById("testEmailButton");
  if (testEmailButton) {
    testEmailButton.addEventListener("click", testEmailConfiguration);
  }

  // Refresh alerts button
  const refreshAlertsButton = document.getElementById("refreshAlertsButton");
  if (refreshAlertsButton) {
    refreshAlertsButton.addEventListener("click", loadAlerts);
  }

  // Close alert dialog when clicking outside
  const createAlertOverlay = document.getElementById("createAlertOverlay");
  if (createAlertOverlay) {
    createAlertOverlay.addEventListener("click", (e) => {
      if (e.target === createAlertOverlay) {
        createAlertOverlay.style.display = "none";
      }
    });
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