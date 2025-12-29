// server.js
//
// Backend for MIT News Monitor
// - Serves front-end from /public
// - /api/matches                  → phrase-based article search
// - /api/members                  → list of ILP members from member-profiles.csv
// - /api/member-intro             → OpenAI-generated intro tailored to chosen member & tone
// - /api/member-article-summaries → OpenAI-generated 2-sentence summaries per item
// - /api/generate-template-text   → template wrapper + per-item blurbs (2–4 sentences) + optional translation
// - /api/smart-match              → AI selects top 10 relevant non-ILP/STEX items (auto-includes ILP/STEX)

import express from "express";
import path from "path";
import fs from "fs/promises";
import * as fsSync from "fs";  // Synchronous fs for alerts
import { fileURLToPath } from "url";
import OpenAI from "openai";
import dotenv from "dotenv";

const { default: transcriptsRouter } = await import("./routes/transcripts.routes.js");

// Setup __dirname for ES modules (must be before dotenv.config)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from brain root (shared with scrapers/enrichers)
dotenv.config({ path: path.join(__dirname, "../..", ".env") });

// ============================================================
// Email Configuration
// ============================================================
import nodemailer from "nodemailer";
import cron from "node-cron";

// Email configuration from environment variables or defaults
const EMAIL_CONFIG = {
  service: process.env.EMAIL_SERVICE || "gmail",
  user: process.env.EMAIL_USER || "",
  password: process.env.EMAIL_PASSWORD || "",
  from: process.env.EMAIL_FROM || "MIT Brain Alerts <mitbrain@mit.edu>",
};

// Create email transporter
let emailTransporter = null;
if (EMAIL_CONFIG.user && EMAIL_CONFIG.password) {
  emailTransporter = nodemailer.createTransport({
    service: EMAIL_CONFIG.service,
    auth: {
      user: EMAIL_CONFIG.user,
      pass: EMAIL_CONFIG.password,
    },
  });
  console.log("✉️  Email transporter configured");
} else {
  console.log("⚠️  Email not configured (set EMAIL_USER and EMAIL_PASSWORD in .env)");
}

console.log("dotenv loaded, DROPBOX_REFRESH_TOKEN?", !!process.env.DROPBOX_REFRESH_TOKEN);
console.log("dotenv loaded, DROPBOX_ACCESS_TOKEN?", !!process.env.DROPBOX_ACCESS_TOKEN);
console.log("cwd:", process.cwd());

// ---------- Load MIT Brain JSONL data ----------
// JSONL data file - configurable via environment variable
const JSONL_FILENAME = process.env.MIT_BRAIN_JSONL || "mit_brain_test17.jsonl";
const jsonlPath = path.join(__dirname, "../../brain", JSONL_FILENAME);
let articles = [];
let articlesByKind = {}; // Track article counts by kind
const serverStartTime = new Date().toISOString(); // Track when server started

// ---------- Temp Prospect Profiles (in-memory storage) ----------
let tempProspects = {}; // personId -> array of temp profiles

// Helper function to calculate article counts by kind
function calculateArticlesByKind(articles) {
  const counts = {};
  for (const article of articles) {
    const kind = article.kind || 'unknown';
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

async function loadArticles() {
  try {
    console.log(`📂 Loading articles from: ${jsonlPath}`);
    const content = await fs.readFile(jsonlPath, "utf8");
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

    articles = lines
      .map((line, idx) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          console.warn(`⚠️ Failed to parse line ${idx + 1}:`, err.message);
          return null;
        }
      })
      .filter(Boolean);

    // Calculate article counts by kind
    articlesByKind = calculateArticlesByKind(articles);

    console.log(`✅ Loaded ${articles.length} articles from JSONL`);
    console.log(`📊 Articles by kind:`, articlesByKind);
    return articles;
  } catch (err) {
    console.error("❌ Error loading mit_brain_test17.jsonl:", err.message);
    console.error("   Path:", jsonlPath);
    console.error("   Make sure the file exists and is readable");
    articles = [];
    articlesByKind = {};
    return articles;
  }
}

// Helper function to parse and clean mitGroups field
// Handles nested JSON-encoded strings like: ["[\"[\\\"MIT ILP\\\"]\"]"]
function parseMitGroups(mitGroups) {
  if (!mitGroups) return "";

  let groups = mitGroups;

  if (typeof groups === "string") {
    try {
      groups = JSON.parse(groups);
    } catch (e) {
      return groups;
    }
  }

  if (Array.isArray(groups)) {
    const flattened = [];
    for (let item of groups) {
      if (typeof item === "string") {
        try {
          const parsed = JSON.parse(item);
          if (Array.isArray(parsed)) {
            const nested = parseMitGroups(parsed);
            if (nested) flattened.push(...nested.split(", "));
          } else {
            flattened.push(String(parsed));
          }
        } catch (e) {
          flattened.push(item);
        }
      } else {
        flattened.push(String(item));
      }
    }
    return [...new Set(flattened.filter(Boolean))].join(", ");
  }

  return String(groups);
}

function parseKeywords(keywords) {
  return parseMitGroups(keywords);
}

function stripXML(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/<[^>]+>/g, "").trim();
}
// ============================================================
// NEW: Template Processing Helper Functions
// ============================================================

/**
 * Filter articles by kind
 */
function filterArticlesByKind(articles, kind) {
  return articles.filter(article => article.kind === kind);
}

/**
 * Format a list of articles (for a specific kind or all)
 */
function formatArticleList(articles, excludeItemType = false) {
  if (articles.length === 0) return '';
  
  return articles.map(item => {
    const kind = excludeItemType || !item.kind ? "" : ` (${item.kind})`;
    
    // Create hyperlinked title if URL exists
    let titleWithLink = item.title;
    if (item.url) {
      titleWithLink = `<a href="${item.url}" target="_blank">${item.title}</a>`;
    }
    
    let result = `${titleWithLink}${kind}`;
    if (item.blurb) {
      result += `\n${item.blurb}`;
    }
    return result;
  }).join('\n\n');
}

/**
 * Apply text styling to template output
 * Supports: **bold**, __underline__
 */
function applyTextStyling(text) {
  // Convert markdown-style formatting to HTML
  // **text** -> <strong>text</strong>
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  
  // __text__ -> <u>text</u>
  text = text.replace(/__(.+?)__/g, '<u>$1</u>');
  
  return text;
}

/**
 * Process all template tags
 */
function processTemplateTags(templateContent, replacements) {
  let result = templateContent;
  
  Object.keys(replacements).forEach(key => {
    const value = replacements[key] || '';
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(pattern, value);
  });
  
  return result;
}


// ---------- Search (AND/OR support) ----------
function parseSearchQuery(query) {
  const qRaw = (query ?? "").toString().trim();
  // Treat "*" (or empty) as a wildcard that returns everything.
  if (qRaw === "*" || qRaw === "") {
    return { operator: "WILDCARD", terms: [] };
  }

  const queryUpper = qRaw.toUpperCase();

  if (queryUpper.includes(" AND ")) {
    const terms = qRaw.split(/ AND /i).map((t) => t.trim()).filter(Boolean);
    return { operator: "AND", terms };
  }

  if (queryUpper.includes(" OR ")) {
    const terms = qRaw.split(/ OR /i).map((t) => t.trim()).filter(Boolean);
    return { operator: "OR", terms };
  }

  return { operator: "SIMPLE", terms: [qRaw] };
}

function scoreArticleForTerm(article, term) {
  let score = 0;
  let matchedIn = [];
  const termLower = term.toLowerCase();

  const summary = (article.ilpSummary || "").toLowerCase();
  if (summary.includes(termLower)) {
    score += 1.0;
    matchedIn.push("ilpSummary");
  }

  let keywordsStr = "";
  if (Array.isArray(article.ilpKeywords)) keywordsStr = article.ilpKeywords.join(" ").toLowerCase();
  else if (typeof article.ilpKeywords === "string") keywordsStr = article.ilpKeywords.toLowerCase();

  if (keywordsStr.includes(termLower)) {
    score += 0.8;
    matchedIn.push("ilpKeywords");
  }

  const fullText = (article.fullText || "").toLowerCase();
  if (fullText.includes(termLower)) {
    score += 0.7;
    matchedIn.push("fullText");
  }

  let tagsStr = "";
  if (Array.isArray(article.tags)) tagsStr = article.tags.join(" ").toLowerCase();
  else if (typeof article.tags === "string") tagsStr = article.tags.toLowerCase();

  if (tagsStr.includes(termLower)) {
    score += 0.6;
    matchedIn.push("tags");
  }

  let authorsStr = "";
  if (Array.isArray(article.authors)) authorsStr = article.authors.join(" ").toLowerCase();
  else if (typeof article.authors === "string") authorsStr = article.authors.toLowerCase();

  if (authorsStr.includes(termLower)) {
    score += 0.5;
    matchedIn.push("authors");
  }

  const title = (article.title || "").toLowerCase();
  if (title.includes(termLower)) {
    score += 0.5;
    matchedIn.push("title");
  }

  const summaryField = (article.summary || "").toLowerCase();
  if (summaryField.includes(termLower)) {
    score += 0.5;
    matchedIn.push("summary");
  }

  return { score, matchedIn };
}

function searchArticlesByPhrase(phrase, options = {}) {
  const minScore = options.minScore || 0;
  const dateFrom = options.dateFrom || null;
  const dateTo = options.dateTo || null;
  const parsed = parseSearchQuery(phrase);

  // Helper: Check if article is within date range
  function isWithinDateRange(article) {
    if (!dateFrom && !dateTo) return true; // No date filter
    
    // Use event date for events, publish date for everything else
    let articleDate = null;
    if (article.kind === 'future_event' || article.kind === 'event') {
      articleDate = article.eventDate || article.event_date || article.date;
    } else {
      articleDate = article.date || article.publishedAt || article.published;
    }
    
    if (!articleDate) return !dateFrom && !dateTo; // No date on article
    
    const artDate = new Date(articleDate);
    if (isNaN(artDate.getTime())) return !dateFrom && !dateTo;
    
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      if (artDate < fromDate) return false;
    }
    
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999); // Include entire "to" day
      if (artDate > toDate) return false;
    }
    
    return true;
  }

  if (parsed.operator === "WILDCARD") {
    // Ensure wildcard results are not accidentally filtered out by minScore.
    const wildcardScore = Math.max(1, minScore || 0);
    console.log(`🔍 Wildcard search: returning all ${articles.length} articles (score=${wildcardScore})`);
    
    let results = articles.map((a) => ({ ...a, score: wildcardScore, matchedIn: "wildcard" }));
    
    // Apply date filter if specified
    if (dateFrom || dateTo) {
      const beforeFilter = results.length;
      results = results.filter(isWithinDateRange);
      console.log(`   📅 Date filter: ${beforeFilter} → ${results.length} articles`);
    }
    
    return results;
  }

  console.log(`🔍 Searching ${articles.length} articles`);
  console.log(`   Query: "${phrase}"`);
  console.log(`   Operator: ${parsed.operator}`);
  console.log(`   Terms: ${parsed.terms.join(", ")}`);
  console.log(`   Min score: ${minScore}`);

  const matches = articles
    .map((article) => {
      let totalScore = 0;
      let allMatchedIn = [];

      if (parsed.operator === "AND") {
        const termResults = parsed.terms.map((term) => scoreArticleForTerm(article, term));
        const allTermsMatched = termResults.every((r) => r.score > 0);
        if (!allTermsMatched) return null;

        totalScore = termResults.reduce((sum, r) => sum + r.score, 0);
        allMatchedIn = termResults.flatMap((r) => r.matchedIn);
      } else if (parsed.operator === "OR") {
        const termResults = parsed.terms.map((term) => scoreArticleForTerm(article, term));
        const anyTermMatched = termResults.some((r) => r.score > 0);
        if (!anyTermMatched) return null;

        totalScore = Math.max(...termResults.map((r) => r.score));
        allMatchedIn = termResults.filter((r) => r.score > 0).flatMap((r) => r.matchedIn);
      } else {
        const result = scoreArticleForTerm(article, parsed.terms[0]);
        totalScore = result.score;
        allMatchedIn = result.matchedIn;
      }

      if (totalScore > 0) {
        const uniqueMatchedIn = [...new Set(allMatchedIn)];
        return { ...article, score: totalScore, matchedIn: uniqueMatchedIn.join(", ") };
      }

      return null;
    })
    .filter(Boolean)
    .filter((a) => a.score >= minScore)
    .sort((a, b) => b.score - a.score);

  console.log(`   Found ${matches.length} matching articles`);
  
  // Apply date filter if specified
  if (dateFrom || dateTo) {
    const beforeFilter = matches.length;
    const filtered = matches.filter(isWithinDateRange);
    console.log(`   📅 Date filter: ${beforeFilter} → ${filtered.length} articles`);
    return filtered;
  }
  
  return matches;
}

// Load articles on startup
await loadArticles();

// Debug: Count articles by kind
const kindCounts = {};
articles.forEach(a => {
  const kind = a.kind || 'unknown';
  kindCounts[kind] = (kindCounts[kind] || 0) + 1;
});
console.log('📊 Loaded articles by kind:', kindCounts);

// Debug: Show first event if any exist
const firstEvent = articles.find(a => a.kind === 'future_event' || a.kind === 'event');
if (firstEvent) {
  console.log('📅 Sample event:', {
    title: firstEvent.title?.substring(0, 50),
    kind: firstEvent.kind,
    eventDate: firstEvent.eventDate,
    date: firstEvent.date,
    hasIlpSummary: !!firstEvent.ilpSummary,
    hasFullText: !!firstEvent.fullText
  });
} else {
  console.log('⚠️  No events found with kind="future_event" or kind="event"');
}

// ============================================================
// PROMPTS + QUALITY CONTROLS (UPDATED)
// ============================================================

/**
 * Core institutional constraints.
 * These are the guardrails that prevent the "Humana pitch deck" failure mode.
 */
const MIT_CORE_GUARDRAILS = `
You are writing for MIT's Industrial Liaison Program.

IMPORTANT:
- Article TITLES are fixed and must NOT be edited.
- Your descriptions must be factual, restrained, and non-salesy.

Hard rules:
1) No hype / marketing / consulting tone.
2) No recommendations, no "adopt/implement/integrate", no "competitive edge/positioning".
3) No "Company could benefit/stands to gain/offers Company...".
4) Avoid second-person persuasion ("your focus/your strategy/your operations").
5) Keep relevance domain-level. Let the reader make the connection.

If a title is enthusiastic, the description should counterbalance it (stay neutral).
`;

/**
 * Universal MIT ILP constraints (kept, but tightened).
 */
const UNIVERSAL_MIT_PROMPT = `
${MIT_CORE_GUARDRAILS}

## MIT INSTITUTIONAL TONE (UNIVERSAL - NON-NEGOTIABLE)

- Concise, factual, and direct.
- Use ONLY provided article data.
- Do NOT invent names, labs, numbers, timelines, or claims.
- Maximum 2 sentences per item.

BANNED (examples):
"game changer", "revolutionary", "breakthrough", "transformative",
"cutting-edge", "groundbreaking", "incredible", "amazing", "remarkable".

Prefer concrete mechanisms, constraints, or process changes over generic claims
about "efficiency", "value", or "impact".

## CRITICAL RULES

### 1) Sentence 2 must earn its keep
- Sentence 2 MUST add concrete, article-supported relevance (a specific operational or technical touchpoint).
- If removing a phrase does not change meaning, DELETE it.

### 2) Ban vague “relevance padding”
Do NOT use (or paraphrase) any of the following:
- “may be relevant”
- “may be relevant for organizations”
- “including those focused on”
- “connected to”
- “areas relevant to”
- “seeking insights”
- “this development may be relevant”
- “could be useful” / “could help” / “can support” (unless tied to a specific mechanism in the data)

### 3) Use ONE touchpoint (not a sector-cloud)
Anchor relevance to ONE specific touchpoint the article actually supports, e.g.:
- quality control turnaround time
- assay speed / throughput
- yield / purity
- materials verification
- solvent selection
- formulation stability
- controlled release profiles
- bioreactor uptime / fouling
- waste reduction tied to a named process step
- process monitoring / inline measurement
- screening / prediction accuracy (only if stated in the data)

Avoid “laundry lists” of industries or themes.

### 4) If the data doesn’t support a touchpoint, stay modest
- Keep Sentence 2 narrowly scoped and factual.
- Do NOT widen it with sector name-dropping (e.g., “telehealth”, “healthcare spending”, “sustainability”, “innovation”) unless the item is directly about that topic.

### 5) No forced thematic repetition
- Do NOT restate the member’s priorities in every item.
- Do NOT append generic endings about “efficiency”, “value”, or “impact” unless explicitly tied to a mechanism stated in the article data.

### 6) “MIT voice” check (hard stop)
Before finalizing, remove or rewrite any sentence that sounds like:
- aspirational marketing (“promise”, “unlock”, “position”, “drive”, “enable” without specifics)
- future-casting without evidence (“will reshape”, “is set to”)
- implied persuasion (anything that reads like advice)

If it sounds like a pitch, rewrite or delete.

## NO FORCED THEMES

- Do NOT restate member priorities in every item.
- Do NOT repeatedly mention themes like "telehealth", "healthcare spending",
  "sustainability", or "innovation" unless the article is directly about them.
- Manufacturing, chemistry, QC, and materials stories should stay in their lane.

## MIT VOICE CHECK

- No aspirational language.
- No implied persuasion.
- No future-casting without evidence.
- If a sentence sounds like marketing copy, rewrite it or remove it.
`;


/**
 * Strong anti-pitch / anti-consulting phrase lint (used for warnings).
 */
const PITCH_LINT_TERMS = [
  "strategic",
  "strategically",
  "aligns with",
  "alignment",
  "leverage",
  "leveraging",
  "unlock",
  "drive outcomes",
  "drive results",
  "enable",
  "enabling",
  "catalyst",
  "transformative",
  "game-changing",
  "cutting-edge",
  "best-in-class",
  "world-class",
  "robust",
  "synergy",
  "synergistic",
  "ecosystem",
  "thought leadership",
  "roadmap",
  "at scale",
  "scalable",
  "mission-critical",
  "next-generation",
  "holistic",
  "end-to-end",
  "competitive edge",
  "competitive advantage",
  "positioning",
  "stands to gain",
  "could benefit",
  "benefit from",
  "offers .* an opportunity",
  "adopt",
  "adopting",
  "implement",
  "implementing",
  "integrate",
  "integrating",
  "embrace",
  "embracing",
];

function lintForPitch(text, label = "output") {
  const t = (text || "").toLowerCase();
  const hits = [];
  for (const term of PITCH_LINT_TERMS) {
    try {
      const re = term.includes(".*") ? new RegExp(term, "i") : null;
      const matched = re ? re.test(text) : t.includes(term);
      if (matched) hits.push(term);
    } catch {
      // ignore regex errors
    }
  }
  if (hits.length) {
    console.warn(`\n⚠️ Pitch lint hits in ${label}: ${hits.slice(0, 12).join(", ")}${hits.length > 12 ? "..." : ""}\n`);
  }
  return hits;
}

/**
 * Company reference rotation (UPDATED):
 * Avoid "your team/your organization" (second-person persuasion cue).
 */
function getCompanyReference(memberName, commonName1, itemIndex) {
  const full = memberName || "";
  const shortName = commonName1 || memberName || "";

  const variations = [
    shortName || full || "the company",
    "the company",
    "the organization",
    shortName || full || "the company",
    "the firm",
    "the company",
  ];

  return variations[itemIndex % variations.length];
}

/**
 * Load user's personal writing preferences (My Voice)
 */
async function loadMyVoice(personId) {
  if (!personId) return null;
  try {
    const voicePath = path.join(__dirname, "../../people", personId, "my-voice.txt");
    const content = await fs.readFile(voicePath, "utf8");
    return content.trim();
  } catch {
    console.log(`ℹ️  No personal voice file for ${personId} - using MIT tone only`);
    return null;
  }
}

function checkForAIGiveaways(emailText) {
  const warnings = [];
  const textLower = (emailText || "").toLowerCase();
  const commonGiveaways = [
    "i hope this email finds you well",
    "i hope this finds you well",
    "i hope you're doing well",
    "i hope you are doing well",
  ];
  for (const phrase of commonGiveaways) {
    if (textLower.includes(phrase)) warnings.push(`Common AI phrase: "${phrase}"`);
  }
  if ((emailText || "").includes("—")) warnings.push("Contains em-dash (—)");
  if (warnings.length) {
    console.warn("\n⚠️  AI Giveaway Warnings:");
    warnings.forEach((w) => console.warn(`   - ${w}`));
    console.warn("");
  }
  return warnings;
}

function detectHallucinations(generatedText, articleData) {
  const warnings = [];
  const summary = articleData.ilpSummary || articleData.summary || "";

  if (!articleData.authors || articleData.authors.length === 0) {
    const professorPattern = /Professor [A-Z][a-z]+ [A-Z][a-z]+/g;
    const matches = generatedText.match(professorPattern);
    if (matches) warnings.push(`Possibly invented professor name: ${matches.join(", ")} (no authors in data)`);
  }

  const percentMatches = generatedText.match(/\d+%/g) || [];
  percentMatches.forEach((pct) => {
    if (!summary.includes(pct)) warnings.push(`Number ${pct} not found in source data`);
  });

  const labMatches = generatedText.match(/\b[A-Z][a-z]+ (?:Lab|Laboratory)\b/g) || [];
  labMatches.forEach((lab) => {
    if (!summary.includes(lab)) warnings.push(`Lab name "${lab}" not found in source data`);
  });

  if (warnings.length) {
    console.warn(`\n⚠️  Possible hallucinations in "${articleData.title}":`);
    warnings.forEach((w) => console.warn(`   - ${w}`));
    console.warn("");
  }
  return warnings;
}

// ============================================================
// EXPRESS APP
// ============================================================

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use("/api/transcripts", transcriptsRouter({ openai, webappDir: __dirname }));

// ============================================================
// CSV PARSER + MEMBER LOADER
// ============================================================

const membersCsvPath = path.join(__dirname, "member-profiles.csv");
let cachedMembersByPerson = {};

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return { header: [], rows: [] };

  const header = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = (cols[i] ?? "").trim()));
    return row;
  });

  return { header, rows };
}

async function loadMembers(personId = null) {
  const cacheKey = personId || "default";
  if (cachedMembersByPerson[cacheKey]) return cachedMembersByPerson[cacheKey];

  let csvPath = personId
    ? path.join(__dirname, "../../people", personId, "member-profiles.csv")
    : membersCsvPath;

  try {
    const content = await fs.readFile(csvPath, "utf8");
    const { rows } = parseCsv(content);

    const members = rows
      .map((row) => {
        const memberName = (row["Member"] || "").trim();
        if (!memberName) return null;

        const commonName1 = (row["Common Name 1"] || "").trim();
        const commonName2 = (row["Common Name 2"] || "").trim();
        const pointOfContact = (row["PocFirstName"] || row["Point-of-Contact"] || "").trim();

        const mainIndustry = (row["Main Industry"] || "").trim();
        const description = (row["Description"] || "").trim();
        const geographicConsiderations = (row["Geographic considerations"] || "").trim();

        const phrases = [];
        for (let i = 1; i <= 10; i++) {
          const v = (row[`Key Phrase ${i}`] || "").trim();
          if (v) phrases.push(v);
        }

        return {
          memberName,
          commonName1,
          commonName2,
          pointOfContact,
          phrases,
          mainIndustry,
          description,
          geographicConsiderations,
        };
      })
      .filter(Boolean);

    // Add temp prospects for this person (they appear first in the list)
    const temps = tempProspects[cacheKey] || [];
    const allMembers = [...temps, ...members];
    
    console.log(`✅ Loaded ${members.length} members + ${temps.length} temp prospects = ${allMembers.length} total`);
    
    cachedMembersByPerson[cacheKey] = allMembers;
    return allMembers;
  } catch (err) {
    console.error(`❌ Error loading member-profiles.csv for ${cacheKey}:`, err.message);
    cachedMembersByPerson[cacheKey] = [];
    return [];
  }
}

// ============================================================
// API: list all people
// ============================================================

app.get("/api/people", async (req, res) => {
  try {
    const peopleDir = path.join(__dirname, "../../people");
    await fs.access(peopleDir);
    const entries = await fs.readdir(peopleDir, { withFileTypes: true });
    const people = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ id: e.name, name: e.name.replace(/-/g, " ") }));
    res.json(people);
  } catch (err) {
    res.status(500).json({ error: "People directory not found", details: err.message });
  }
});

// ============================================================
// API: get person's my-voice and templates
// ============================================================

app.get("/api/people/:personId/data", async (req, res) => {
  try {
    const { personId } = req.params;

    const personDir = path.join(__dirname, "../../people", personId);
    const myVoicePath = path.join(personDir, "my-voice.txt");
    const templatesDir = path.join(personDir, "templates");

    let myVoice = "";
    try {
      myVoice = await fs.readFile(myVoicePath, "utf8");
    } catch {}

    let templates = [];
    try {
      const templateFiles = await fs.readdir(templatesDir);
      templates = templateFiles
        .filter((f) => f.endsWith(".txt"))
        .map((f) => ({
          id: f.replace(".txt", ""),
          name: f
            .replace(".txt", "")
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
          filename: f,
        }));
    } catch {}

    res.json({ personId, myVoice, templates });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/people/:personId/templates/:templateId", async (req, res) => {
  try {
    const { personId, templateId } = req.params;
    const templatePath = path.join(__dirname, "../../people", personId, "templates", `${templateId}.txt`);
    const content = await fs.readFile(templatePath, "utf8");
    res.json({ content });
  } catch {
    res.status(404).json({ error: "Template not found" });
  }
});


// ============================================================
// Alert Management Functions
// ============================================================

function ensureAlertsDirectory(personId) {
  const alertsDir = path.join(__dirname, "../../people", personId, "alerts");
  if (!fsSync.existsSync(alertsDir)) {
    fsSync.mkdirSync(alertsDir, { recursive: true });
  }
  return alertsDir;
}

function saveAlert(personId, alert) {
  const alertsDir = ensureAlertsDirectory(personId);
  const alertPath = path.join(alertsDir, `${alert.alertId}.json`);
  fsSync.writeFileSync(alertPath, JSON.stringify(alert, null, 2), 'utf8');
  
  // Update index
  const indexPath = path.join(alertsDir, 'alerts.json');
  let index = { alerts: [] };
  if (fsSync.existsSync(indexPath)) {
    const indexContent = fsSync.readFileSync(indexPath, 'utf8');
    index = JSON.parse(indexContent);
  }
  
  if (!index.alerts.includes(alert.alertId)) {
    index.alerts.push(alert.alertId);
    fsSync.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  }
  
  console.log(`💾 Saved alert: ${alert.alertId}`);
}

function loadAlertsForPerson(personId) {
  const alertsDir = path.join(__dirname, "../../people", personId, "alerts");
  
  if (!fsSync.existsSync(alertsDir)) {
    return [];
  }
  
  const indexPath = path.join(alertsDir, 'alerts.json');
  if (!fsSync.existsSync(indexPath)) {
    return [];
  }
  
  const indexContent = fsSync.readFileSync(indexPath, 'utf8');
  const index = JSON.parse(indexContent);
  const alerts = [];
  
  for (const alertId of index.alerts || []) {
    const alertPath = path.join(alertsDir, `${alertId}.json`);
    if (fsSync.existsSync(alertPath)) {
      const alertContent = fsSync.readFileSync(alertPath, 'utf8');
      const alert = JSON.parse(alertContent);
      alerts.push(alert);
    }
  }
  
  return alerts;
}

function deleteAlert(personId, alertId) {
  const alertsDir = path.join(__dirname, "../../people", personId, "alerts");
  const alertPath = path.join(alertsDir, `${alertId}.json`);
  
  if (fsSync.existsSync(alertPath)) {
    fsSync.unlinkSync(alertPath);
  }
  
  // Update index
  const indexPath = path.join(alertsDir, 'alerts.json');
  if (fsSync.existsSync(indexPath)) {
    const indexContent = fsSync.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(indexContent);
    index.alerts = (index.alerts || []).filter(id => id !== alertId);
    fsSync.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  }
  
  console.log(`🗑 Deleted alert: ${alertId}`);
}

async function processAlert(alert, personId) {
  console.log(`\n🔔 Processing alert: ${alert.alertName}`);
  
  try {
    // 1. Run search with alert's search params
    
    // Get today's date for filtering by dateAddedToBrain
    const today = new Date().toISOString().split('T')[0];
    
    console.log(`   📅 Filtering by dateAddedToBrain: ${today} (items added today)`);
    
    // Search without publish date filter (we'll filter by dateAddedToBrain instead)
    const allResults = searchArticlesByPhrase(
      alert.searchParams.phrase,
      {
        minScore: alert.searchParams.minScore
      }
    );
    
    // Filter to only items added to brain TODAY
    const todayResults = allResults.filter(article => {
      return article.dateAddedToBrain === today;
    });
    
    console.log(`   🔍 Found ${allResults.length} total matches`);
    console.log(`   ✅ ${todayResults.length} were added to brain today`);
    
    // 2. Filter by content types
    let filteredResults = todayResults;
    if (alert.searchParams.contentTypes && alert.searchParams.contentTypes.length > 0) {
      filteredResults = todayResults.filter(a => {
        const kind = (a.kind || '').toLowerCase();
        // Handle event -> future_event mapping
        return alert.searchParams.contentTypes.some(selectedKind => {
          if (selectedKind === 'event' && kind === 'future_event') return true;
          return selectedKind === kind;
        });
      });
      console.log(`   Filtered to ${filteredResults.length} by content types`);
    }
    
    // 3. Filter NEW articles (not seen before)
    const seenIds = alert.metadata?.seenArticleIds || [];
    const newArticles = filteredResults.filter(a => !seenIds.includes(a.url));
    
    console.log(`   Found ${newArticles.length} NEW articles (not seen before)`);
    
    if (newArticles.length === 0) {
      return { matches: [], emailSent: false, message: "No new articles" };
    }
    
    // 4. Use Smart Match logic if enabled
    let relevantMatches = [];
    
    if (alert.useSmartMatch) {
      console.log(`   Using Smart Match to find relevant articles...`);
      console.log(`   Skipping ILP/STEX auto-includes (directors already know about these)`);
      
      // Prepare articles for smart match
      const articlesForMatching = newArticles.map(a => ({
        url: a.url,
        title: a.title,
        kind: a.kind,
        summary: a.ilpSummary || a.summary || "",
        keywords: a.ilpKeywords || a.keywords || "",
        industries: a.industries || "",
        techThemes: a.techThemes || "",
        mitGroups: a.mitGroups || [],
        location: a.location || ""
      }));
      
      // Call smart match (reuse existing logic)
      // IMPORTANT: Set skipAutoIncludes=true for alerts
      // Program directors already know about ILP/STEX events
      const smartMatchResponse = await fetch("http://localhost:3000/api/smart-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberName: alert.memberName,
          memberPhrases: alert.memberProfile.phrases || [],
          memberProfile: alert.memberProfile,
          articles: articlesForMatching,
          skipAutoIncludes: true  // NEW: Skip ILP/STEX auto-inclusion for alerts
        })
      });
      
      if (smartMatchResponse.ok) {
        const smartMatchData = await smartMatchResponse.json();
        relevantMatches = smartMatchData.matches || [];
        console.log(`   Smart Match found ${relevantMatches.length} relevant matches`);
      } else {
        console.error("Smart Match failed, using all new articles");
        relevantMatches = newArticles.map(a => ({
          url: a.url,
          title: a.title,
          reason: "New article (Smart Match unavailable)"
        }));
      }
    } else {
      // No Smart Match - include all new articles
      relevantMatches = newArticles.map(a => ({
        url: a.url,
        title: a.title,
        kind: a.kind,
        reason: "New article matching your search"
      }));
      console.log(`   Including all ${relevantMatches.length} new articles (Smart Match disabled)`);
    }
    
    if (relevantMatches.length === 0) {
      return { matches: [], emailSent: false, message: "No relevant matches" };
    }
    
    // 5. Update alert metadata
    alert.metadata = alert.metadata || {};
    alert.metadata.lastRunAt = new Date().toISOString();
    alert.metadata.lastMatchCount = relevantMatches.length;
    alert.metadata.seenArticleIds = [
      ...seenIds,
      ...relevantMatches.map(m => m.url)
    ];
    
    saveAlert(personId, alert);
    
    console.log(`   ✅ Alert processed successfully`);
    console.log(`   📧 Sending email to: ${alert.emailSettings.recipientEmail}`);
    console.log(`   📊 Matches: ${relevantMatches.length}`);
    
    // 5. Send email notification
    const emailSent = await sendAlertEmail(alert, relevantMatches);
    
    return {
      matches: relevantMatches,
      emailSent: emailSent,
      message: `Found ${relevantMatches.length} relevant matches`
    };
    
  } catch (err) {
    console.error(`Error processing alert ${alert.alertId}:`, err);
    throw err;
  }
}

// ============================================================
// API: article matches from local search
// ============================================================

app.get("/api/matches", (req, res) => {
  try {
    const phrase = (req.query.phrase || "").toString();
    const minScore = Number(req.query.minScore || 0);
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    
    const results = searchArticlesByPhrase(phrase, { minScore, dateFrom, dateTo });
    
    if (dateFrom || dateTo) {
      console.log(`📅 Date range filter applied: ${dateFrom || 'any'} to ${dateTo || 'any'}`);
    }
    
    // Debug: Log kind breakdown
    const kindCounts = {};
    results.forEach(r => {
      const kind = r.kind || 'unknown';
      kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    });
    console.log(`📊 Results by kind:`, kindCounts);
    
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ============================================================
// API: list ILP members
// ============================================================

app.get("/api/members", async (req, res) => {
  try {
    const { personId } = req.query;
    const members = await loadMembers(personId);

    const simplified = (members || []).map((m) => ({
      memberName: m.memberName,
      Member: m.Member || m.memberName,
      commonName1: m.commonName1,
      commonName2: m.commonName2,
      pointOfContact: m.pointOfContact,
      PocFirstName: m.PocFirstName || m.pointOfContact,
      phrases: m.phrases || [],
      mainIndustry: m.mainIndustry || "",
      description: m.description || "",
      geographicConsiderations: m.geographicConsiderations || "",
      isTemp: m.isTemp || false,  // IMPORTANT: Include isTemp flag!
    }));

    res.json(simplified);
  } catch (err) {
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ============================================================
// TONE + LANGUAGE HELPERS (unchanged behavior)
// ============================================================

function toneInstruction(toneRaw, myVoiceText = null) {
  const tone = (toneRaw || "familiar").toLowerCase();

  if (tone === "myvoice" && myVoiceText) {
    return `
Tone - Use My Personal Voice:
${myVoiceText}

Apply the above writing style and voice to your response.
`;
  }

  if (tone === "formal") {
    return `
Tone:
- Formal and polished.
- Suitable for senior executives you don't know well.
- Clear, structured, professional.
- Avoid slang or overly casual phrasing.
`;
  }

  if (tone === "funny") {
    return `
Tone:
- Friendly, informal, and lightly humorous.
- As if writing to a colleague you know well.
- You may include a subtle, tasteful joke or witty turn of phrase (no forced puns).
- Still professional and respectful.
`;
  }

  if (tone === "upbeat") {
    return `
Tone:
- Energetic, optimistic (but still MIT-understated).
- Show interest in the work without hype.
- Still concise and professional.
`;
  }

  return `
Tone:
- Warm, familiar, collegial.
- Slightly conversational is fine.
- Still professional and concise.
`;
}

function languageInstruction(languageRaw) {
  const language = (languageRaw || "english").toLowerCase();

  if (language === "spanish") return `CRITICAL: Write ENTIRE response in SPANISH. No English.\n`;
  if (language === "portuguese") return `CRITICAL: Write ENTIRE response in PORTUGUESE (Brazil). No English.\n`;
  if (language === "french") return `CRITICAL: Write ENTIRE response in FRENCH. No English.\n`;
  if (language === "japanese") return `CRITICAL: Write ENTIRE response in JAPANESE. No English (except company names).\n`;
  if (language === "korean") return `CRITICAL: Write ENTIRE response in KOREAN. No English (except company names).\n`;
  if (language === "hindi") return `CRITICAL: Write ENTIRE response in HINDI. No English (except company names).\n`;
  if (language === "chinese") return `CRITICAL: Write ENTIRE response in SIMPLIFIED CHINESE. No English (except company names).\n`;
  if (language === "german") return `CRITICAL: Write ENTIRE response in GERMAN. No English (except company names).\n`;
  if (language === "italian") return `CRITICAL: Write ENTIRE response in ITALIAN. No English (except company names).\n`;

  return `Language: Write your response in ENGLISH.\n`;
}

// ============================================================
// API: member-specific intro via OpenAI (UPDATED)
// ============================================================

app.post("/api/member-intro", async (req, res) => {
  try {
    const { member, selectedArticles, tone, language } = req.body || {};
    const picked = Array.isArray(selectedArticles) ? selectedArticles : [];

    let memberName =
      (typeof member === "string" && member) ||
      (member && (member.memberName || member.commonName1 || member.commonName2)) ||
      "";

    if (!picked.length) return res.status(400).json({ error: "At least one article is required" });

    // Load member phrases if possible
    let memberContext = "";
    if (memberName) {
      try {
        const members = await loadMembers();
        const m = members.find(
          (x) => x.memberName === memberName || x.commonName1 === memberName || x.commonName2 === memberName
        );
        const phrases = m?.phrases || [];
        memberContext = phrases.length
          ? `Known interests (phrases): ${phrases.join(", ")}.`
          : `Member context: broad interests across innovation-relevant MIT work.`;
      } catch {}
    }

    const articlesBlock = picked
      .map((a, i) => {
        const src = a.source || a.Source || "MIT News";
        const kind = a.kind || "unknown";
        return `
${i + 1}.
Title: ${stripXML(a.title)}
Source: ${src} [${kind.toUpperCase()}]
Date: ${a.date}
ILP Summary: ${a.ilpSummary || a.summary || ""}
ILP Keywords: ${Array.isArray(a.ilpKeywords) ? a.ilpKeywords.join(", ") : a.ilpKeywords || ""}
`;
      })
      .join("\n");

    const prompt = `
${languageInstruction(language)}
${UNIVERSAL_MIT_PROMPT}

You are helping a program director at MIT Corporate Relations write an email intro to an ILP member.

Member: ${memberName || "this company"}
${memberContext}
${toneInstruction(tone)}

Below are the items that will follow in the email:

${articlesBlock}

Write a short 2–3 sentence paragraph that goes immediately after "Hi [Name],".

Rules:
- Do NOT mention "articles", "bullet points", or "list".
- Do NOT include a greeting or sign-off.
- Keep it factual and non-salesy.
- No "strategic priorities" language.
- Frame relevance at a domain level (adjacent interests), not as a pitch.

Write the paragraph now:
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "You write concise, factual email intros for MIT Corporate Relations. No sales language." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
    });

    let introText = completion.choices?.[0]?.message?.content?.trim() || "";

    // Fallback (also non-salesy)
    if (!introText) {
      introText = "Following up with a few recent MIT items that sit near your team’s interests. I picked these because they touch on practical mechanisms and constraints that often show up in real-world deployment and operations.";
    }

    // Strip accidental greeting
    introText = introText.replace(/^hi\s*\[[^\]]+\],?\s*/i, "").trim();

    lintForPitch(introText, "member-intro");
    res.json({ intro: introText });
  } catch (err) {
    console.error("Error in /api/member-intro:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ============================================================
// API: member-specific article summaries (2 sentences) (UPDATED)
// ============================================================

app.post("/api/member-article-summaries", async (req, res) => {
  try {
    const { member, selectedArticles, tone, language, personId } = req.body || {};
    const picked = Array.isArray(selectedArticles) ? selectedArticles : [];

    let memberName =
      (typeof member === "string" && member) ||
      (member && (member.memberName || member.commonName1 || member.commonName2)) ||
      "";

    if (!picked.length) return res.status(400).json({ error: "At least one article is required" });

    // Optional member context
    let memberContext = "";
    if (memberName) {
      try {
        const members = await loadMembers();
        const m = members.find(
          (x) => x.memberName === memberName || x.commonName1 === memberName || x.commonName2 === memberName
        );
        const phrases = m?.phrases || [];
        memberContext = phrases.length ? `Known interests (phrases): ${phrases.join(", ")}.` : "";
      } catch {}
    }

    // Load user's personal voice (if exists)
    const myVoiceText = await loadMyVoice(personId);

    const rewritten = [];

    for (let i = 0; i < picked.length; i++) {
      const a = picked[i];
      const src = a.source || a.Source || "MIT News";

      let articleBlock = `
Title: ${stripXML(a.title)}
Source: ${src} [${a.kind ? a.kind.toUpperCase() : "UNKNOWN"}]
Date: ${a.date}
MIT Unit: ${a.mitUnit || ""}
ILP Summary: ${a.ilpSummary || a.summary || ""}
ILP Keywords: ${Array.isArray(a.ilpKeywords) ? a.ilpKeywords.join(", ") : a.ilpKeywords || ""}
General Keywords: ${a.keywords || ""}
Industries: ${a.industries || ""}
Tech Themes: ${a.techThemes || ""}
`;

      // Add event details for future_event items
      if (a.kind === "future_event") {
        const eventDetails = [];
        if (a.futureEventDate) eventDetails.push(`Event Date: ${a.futureEventDate}`);
        const mitGroupsStr = parseMitGroups(a.mitGroups);
        if (mitGroupsStr) eventDetails.push(`MIT Groups: ${mitGroupsStr}`);
        if (a.location) eventDetails.push(`Location: ${a.location}`);
        if (a.eventType) eventDetails.push(`Event Type: ${a.eventType}`);
        if (eventDetails.length) articleBlock += eventDetails.join(" | ") + "\n";
      }

      const companyRef = getCompanyReference(member?.memberName || memberName, member?.commonName1, i);

      const prompt = `
${languageInstruction(language)}
${UNIVERSAL_MIT_PROMPT}

${toneInstruction(tone, myVoiceText)}

${myVoiceText ? `## PERSONAL WRITING STYLE (apply)\n${myVoiceText}\n` : ""}

## TASK
Write EXACTLY 2 sentences about this item.
- Sentence 1: what the work is (factual, from the data)
- Sentence 2: why it may be relevant (domain-level, non-advocacy)

## COMPANY-SPECIFIC RELEVANCE RULES (CRITICAL)
- Do NOT use "${memberName}" (or any company name) as the subject of a sentence.
- Do NOT say the company would benefit, gain, strengthen, position, or obtain an edge.
- Do NOT recommend adoption or action ("adopt/implement/integrate/embrace").
- Avoid second-person persuasion ("your focus/your strategy/your operations").
- If you mention the company at all, use it only as context (at most once): "relevant for organizations like ${companyRef} involved in ..."

Member: ${memberName || "this company"}
${memberContext}
Company reference (optional): "${companyRef}"

## ARTICLE DATA (use only this)
${articleBlock}

Write the 2 sentences now:
`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You write concise, factual MIT ILP blurbs. No sales language. Exactly 2 sentences." },
          { role: "user", content: prompt },
        ],
        temperature: 0.35,
      });

      let text = completion.choices?.[0]?.message?.content?.trim() || "";

      if (!text) text = (a.ilpSummary || a.summary || "").trim();

      if (a.kind === "future_event") {
        const eventDetails = [];
        if (a.futureEventDate) eventDetails.push(`Event Date: ${a.futureEventDate}`);
        const mitGroupsStr = parseMitGroups(a.mitGroups);
        if (mitGroupsStr) eventDetails.push(`MIT Groups: ${mitGroupsStr}`);
        if (a.location) eventDetails.push(`Location: ${a.location}`);
        if (a.eventType) eventDetails.push(`Event Type: ${a.eventType}`);
        if (eventDetails.length) text += "\n" + eventDetails.join(" | ");
      }

      detectHallucinations(text, a);
      lintForPitch(text, "member-article-summary");

      rewritten.push(text);
    }

    const combined = rewritten.join("\n\n");
    checkForAIGiveaways(combined);
    res.json({ text: combined });
  } catch (err) {
    console.error("Error in /api/member-article-summaries:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ============================================================
// API: template-based text generation (UPDATED)
// ============================================================

app.post("/api/generate-template-text", async (req, res) => {
  try {
    const { personId, templateId, member, selectedArticles, tone, language, myVoice, excludeItemType } = req.body || {};
    const picked = Array.isArray(selectedArticles) ? selectedArticles : [];

    if (!picked.length) return res.status(400).json({ error: "At least one article is required" });

    let memberName =
      (typeof member === "string" && member) ||
      (member && (member.memberName || member.commonName1 || member.commonName2)) ||
      "";

    let pointOfContact = (member && member.pointOfContact) || memberName || "[Name]";

    // Load member context if personId is provided
    let memberContext = "";
    if (memberName && personId) {
      try {
        const members = await loadMembers(personId);
        const m = members.find(
          (x) => x.memberName === memberName || x.commonName1 === memberName || x.commonName2 === memberName
        );

        if (m) {
          const phrases = m.phrases || [];
          const industry = m.mainIndustry || "";
          const description = m.description || "";

          const contextParts = [];
          if (industry) contextParts.push(`Industry: ${industry}`);
          if (description) contextParts.push(`Business focus: ${description}`);
          if (phrases.length) contextParts.push(`Known interests (phrases): ${phrases.join(", ")}`);

          memberContext = contextParts.length ? contextParts.join("\n") : "";
        }
      } catch {}
    }

    // My Voice (if any)
    const myVoiceText = await loadMyVoice(personId);
    const voiceToUse = myVoiceText || myVoice || null;

    // Generate knowledge list (per-item blurbs)
    const rewritten = [];

    for (let i = 0; i < picked.length; i++) {
      const a = picked[i];
      const src = a.source || a.Source || "MIT News";

      let articleBlock = `
Title: ${stripXML(a.title)}
Source: ${src} [${a.kind ? a.kind.toUpperCase() : "UNKNOWN"}]
Date: ${a.date}
MIT Unit: ${a.mitUnit || ""}
ILP Summary: ${a.ilpSummary || a.summary || ""}
ILP Keywords: ${Array.isArray(a.ilpKeywords) ? a.ilpKeywords.join(", ") : a.ilpKeywords || ""}
General Keywords: ${a.keywords || ""}
Industries: ${a.industries || ""}
Tech Themes: ${a.techThemes || ""}
`;

      if (a.kind === "future_event") {
        const eventDetails = [];
        if (a.futureEventDate) eventDetails.push(`Event Date: ${a.futureEventDate}`);
        const mitGroupsStr = parseMitGroups(a.mitGroups);
        if (mitGroupsStr) eventDetails.push(`MIT Groups: ${mitGroupsStr}`);
        if (a.location) eventDetails.push(`Location: ${a.location}`);
        if (a.eventType) eventDetails.push(`Event Type: ${a.eventType}`);
        if (eventDetails.length) articleBlock += eventDetails.join(" | ") + "\n";
      }

      const previousSummaries =
        rewritten.length > 0
          ? `\nPREVIOUS BLURBS (avoid repeating openings):\n${rewritten.join("\n---\n")}\n`
          : "";

      const companyRef = getCompanyReference(member?.memberName || memberName, member?.commonName1, i);

      // IMPORTANT: this is the prompt that used to force "business value / strategic alignment / competitive advantage".
      // We replace it with domain relevance without advocacy.
      const prompt = `
${UNIVERSAL_MIT_PROMPT}

${toneInstruction(tone, voiceToUse)}

Write in ENGLISH. (If translation is requested, it will happen later.)

${voiceToUse ? `## PERSONAL WRITING STYLE (apply)\n${voiceToUse}\n` : ""}

Member: ${memberName || "this company"}
${memberContext}

TASK:
Write a short blurb (2–4 sentences) that will appear under the fixed article title.
- Start immediately with the blurb (do NOT repeat the title).
- Stay factual and restrained.
- Explain what it is, then why it may be relevant (domain-level).
- Avoid generic “efficiency/value/impact” endings unless tied to a concrete mechanism.

COMPANY-SPECIFIC RELEVANCE RULES (CRITICAL):
- Do NOT use "${memberName}" (or any company name) as the subject of a sentence.
- Do NOT say the company would benefit/gain/strengthen/position/obtain an edge.
- Do NOT recommend adoption or action ("adopt/implement/integrate/embrace").
- Avoid second-person persuasion ("your focus/your strategy/your operations").
- If you mention the company at all, mention it at most once and only as context: "relevant for organizations like ${companyRef} involved in ..."

${previousSummaries}

ARTICLE DATA (use only this):
${articleBlock}

Write the blurb now:
`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You write concise, factual MIT ILP blurbs. No sales tone. No advocacy." },
          { role: "user", content: prompt },
        ],
        temperature: 0.45,
      });

      const blurb = completion.choices?.[0]?.message?.content?.trim() || (a.ilpSummary || a.summary || "").trim();

      // Format: Title (kind) + newline + blurb
      const title = a.title || "Untitled";
      const kind = excludeItemType || !a.kind ? "" : ` (${a.kind})`;
      let formattedItem = `${title}${kind}\n${blurb}`;

      if (a.kind === "future_event") {
        const eventDetails = [];
        if (a.futureEventDate) eventDetails.push(`Event Date: ${a.futureEventDate}`);
        const mitGroupsStr = parseMitGroups(a.mitGroups);
        if (mitGroupsStr) eventDetails.push(`MIT Groups: ${mitGroupsStr}`);
        if (a.location) eventDetails.push(`Location: ${a.location}`);
        if (a.eventType) eventDetails.push(`Event Type: ${a.eventType}`);
        if (eventDetails.length) formattedItem += "\n" + eventDetails.join(" | ");
      }

      detectHallucinations(formattedItem, a);
      lintForPitch(formattedItem, "template-item");

      rewritten.push(formattedItem);
    }

    const knowledgeList = rewritten.join("\n\n");

    // Load and apply template (optional)
    let finalText = knowledgeList;

    if (personId && templateId) {
      try {
        const templatePath = path.join(__dirname, "../../people", personId, "templates", `${templateId}.txt`);
        const templateContent = await fs.readFile(templatePath, "utf8");

        // Prepare articles with blurbs for formatting
        const articlesWithBlurbs = picked.map((article, i) => {
          // Split the rewritten text to separate title from blurb
          const lines = rewritten[i].split('\n');
          const titleLine = lines[0]; // First line is title with optional (kind)
          const blurbLines = lines.slice(1).join('\n').trim(); // Rest is blurb
          
          return {
            title: article.title || 'Untitled',
            kind: article.kind,
            blurb: blurbLines,
            url: article.url || article.link || ''
          };
        });

        // Create formatted lists for each kind (user controls order in template)
        const futureEventList = formatArticleList(filterArticlesByKind(articlesWithBlurbs, 'future_event'), excludeItemType);
        const videoList = formatArticleList(filterArticlesByKind(articlesWithBlurbs, 'video'), excludeItemType);
        
        // Handle both 'news' and 'article' kind values
        const newsArticles = [
          ...filterArticlesByKind(articlesWithBlurbs, 'news'),
          ...filterArticlesByKind(articlesWithBlurbs, 'article')
        ];
        const newsList = formatArticleList(newsArticles, excludeItemType);
        
        const paperList = formatArticleList(filterArticlesByKind(articlesWithBlurbs, 'paper'), excludeItemType);
        const startupList = formatArticleList(filterArticlesByKind(articlesWithBlurbs, 'startup'), excludeItemType);

        // Get member data fields (matching CSV columns)
        const memberData = member || {};
        const memberName = memberData.memberName || memberData.Member || memberName || '[Company Name]';
        const pocFirstName = memberData.pointOfContact || memberData.PocFirstName || pointOfContact || '[Name]';
        const commonName1 = memberData.commonName1 || memberData['Common Name 1'] || memberName;
        const commonName2 = memberData.commonName2 || memberData['Common Name 2'] || '';

        // Prepare all template replacements (matching CSV column names)
        const replacements = {
          // Member data (CSV columns)
          'Member': memberName,
          'PocFirstName': pocFirstName,
          'CommonName1': commonName1,
          'CommonName2': commonName2,
          
          // Legacy/alternate names for compatibility
          'Point-of-Contact': pocFirstName,
          'member-name': memberName,
          
          // Knowledge lists
          'knowledge-list': knowledgeList,
          
          // Individual kind tags (singular)
          'future_event': futureEventList,
          'video': videoList,
          'news': newsList,
          'paper': paperList,
          'startup': startupList,
          
          // Individual kind tags (plural for readability)
          'events': futureEventList,
          'videos': videoList,
          'articles': newsList,
          'papers': paperList,
          'startups': startupList,
          
          // Meta tags
          'article-count': picked.length.toString(),
          'count': picked.length.toString(),
          'date': new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        };

        // Process all template tags
        finalText = processTemplateTags(templateContent, replacements);

        // Apply text styling (bold, underline) - AFTER template processing
        finalText = applyTextStyling(finalText);

        // Light template wrapper customization (keep subtle + non-salesy)
        if (memberName) {
          const customizePrompt = `
${UNIVERSAL_MIT_PROMPT}

You are lightly customizing an email template for a specific company.

Member: ${memberName}
${memberContext}
${toneInstruction(tone, voiceToUse)}

Rules:
- Keep length and structure similar.
- Do NOT add sales/consulting language.
- Avoid second-person persuasion beyond what already exists in the template.
- Do NOT rewrite article titles or the knowledge list (they are already inserted).
- Preserve any HTML formatting tags like <strong>, <u>, etc. EXACTLY as they are.
- Do NOT remove or modify any <strong> or <u> tags.
- Output ONLY the customized template text.

TEMPLATE (already filled with titles + blurbs):
${finalText}
`;

          const customizeCompletion = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
              { role: "system", content: "You lightly customize templates without adding sales language. Preserve HTML tags." },
              { role: "user", content: customizePrompt },
            ],
            temperature: 0.35,
          });

          const customized = customizeCompletion.choices?.[0]?.message?.content?.trim();
          if (customized) finalText = customized;

          lintForPitch(finalText, "template-wrapper");
        }
      } catch (err) {
        console.warn(`⚠️ Could not load template, using knowledge list only: ${err.message}`);
        finalText = knowledgeList;
      }
    }

    // Translation (preserve titles in English)
    if (language && language.toLowerCase() !== "english") {
      const translatePrompt = `
${languageInstruction(language)}

Translate the ENTIRE text below into the target language.

CRITICAL:
- Do NOT translate article titles. Keep titles EXACTLY as they appear in English.
- Titles are the standalone lines immediately above each blurb (and may include "(article)" etc).
- Translate only the prose under each title, plus the greeting/intro/closing.

Preserve structure and spacing.

Text:
${finalText}
`;

      const translateCompletion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You are a professional translator. Preserve article titles in English." },
          { role: "user", content: translatePrompt },
        ],
        temperature: 0.2,
      });

      finalText = translateCompletion.choices?.[0]?.message?.content?.trim() || finalText;
    }

    // Subject line
    const subjectPrompt = `
${language && language.toLowerCase() !== "english" ? languageInstruction(language) : "Write in ENGLISH.\n"}

Create a subject line (5–10 words) for MIT outreach to ${memberName || "a company"}.

Rules:
- Specific, professional, no hype.
- No "strategic" phrasing.
- Output ONLY the subject line.

Email excerpt:
${finalText.substring(0, 900)}
`;

    const subjectCompletion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "You write concise, professional email subject lines. No hype." },
        { role: "user", content: subjectPrompt },
      ],
      temperature: 0.5,
    });

    const subjectLine = subjectCompletion.choices?.[0]?.message?.content?.trim() || "MIT updates relevant to your work";

    lintForPitch(subjectLine, "subject-line");
    checkForAIGiveaways(finalText);

    res.json({ text: finalText, subject: subjectLine });
  } catch (err) {
    console.error("Error in /api/generate-template-text:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ============================================================
// API: regenerate subject line only
// ============================================================

app.post("/api/regenerate-subject", async (req, res) => {
  try {
    const { member, emailText, language } = req.body || {};

    let memberName =
      (typeof member === "string" && member) ||
      (member && (member.memberName || member.commonName1 || member.commonName2)) ||
      "";

    const subjectPrompt = `
${language && language.toLowerCase() !== "english" ? languageInstruction(language) : "Write in ENGLISH.\n"}

Create a different subject line (5–10 words) for MIT outreach to ${memberName || "a company"}.

Rules:
- Specific, professional, no hype.
- No "strategic" phrasing.
- Output ONLY the subject line.

Email excerpt:
${(emailText || "").substring(0, 900)}
`;

    const subjectCompletion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "You write concise, professional email subject lines. No hype." },
        { role: "user", content: subjectPrompt },
      ],
      temperature: 0.7,
    });

    const subjectLine = subjectCompletion.choices?.[0]?.message?.content?.trim() || "MIT updates relevant to your work";
    lintForPitch(subjectLine, "subject-line");
    res.json({ subject: subjectLine });
  } catch (err) {
    console.error("Error in /api/regenerate-subject:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ============================================================
// Test endpoint for language translation (kept)
// ============================================================

app.post("/api/test-language", async (req, res) => {
  try {
    const { language } = req.body || {};

    const languageMap = {
      spanish: "español",
      portuguese: "português",
      french: "français",
      japanese: "日本語",
      korean: "한국어",
      hindi: "हिन्दी",
      chinese: "中文",
      german: "Deutsch",
      italian: "italiano",
      english: "English",
    };

    const targetLang = languageMap[(language || "english").toLowerCase()] || "English";
    const prompt = `You MUST respond ONLY in ${targetLang}. Write one simple sentence about MIT research.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: `You are a translator. You respond only in ${targetLang}.` },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    });

    res.json({
      language,
      targetLang,
      response: completion.choices?.[0]?.message?.content?.trim() || "",
      success: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Smart Match endpoint (left as-is logically; wording still uses "strategic",
// but this endpoint is internal ranking, not customer-facing prose).
// ============================================================

app.post("/api/smart-match", async (req, res) => {
  try {
    const { memberName, memberPhrases, memberProfile, articles, skipAutoIncludes } = req.body || {};

    if (!memberName || !memberPhrases || !articles || articles.length === 0) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    
    // skipAutoIncludes flag:
    // - false (default): Auto-include ILP/STEX events (for email generation)
    // - true: Skip auto-includes (for alerts - directors already know about ILP events)
    const shouldAutoInclude = skipAutoIncludes !== true;

    let memberProfileText = `Member: ${memberName}\n`;
    if (memberProfile?.mainIndustry) memberProfileText += `Main Industry: ${memberProfile.mainIndustry}\n`;
    if (memberProfile?.description) memberProfileText += `Description: ${memberProfile.description}\n`;
    if (memberProfile?.geographicConsiderations)
      memberProfileText += `Geographic Considerations: ${memberProfile.geographicConsiderations}\n`;
    memberProfileText += `Key Interests: ${memberPhrases.join(", ")}\n`;

    const ilpEvents = [];
    const stexEvents = [];
    const otherArticles = [];

    if (shouldAutoInclude) {
      // Auto-include ILP/STEX events (for email generation)
      articles.forEach((article) => {
        const titleLower = (article.title || "").toLowerCase();
        const summaryLower = (article.summary || "").toLowerCase();
        const ilpSummaryLower = (article.ilpSummary || "").toLowerCase();
        const mitGroupsLower = parseMitGroups(article.mitGroups).toLowerCase();
        const eventNameLower = (article.eventName || "").toLowerCase();

        const isILP =
          titleLower.includes("ilp") ||
          titleLower.includes("industrial liaison") ||
          summaryLower.includes("industrial liaison program") ||
          ilpSummaryLower.includes("industrial liaison program") ||
          mitGroupsLower.includes("industrial liaison") ||
          eventNameLower.includes("industrial liaison") ||
          eventNameLower.includes("ilp");

        const isSTEX =
          titleLower.includes("stex") ||
          titleLower.includes("startup exchange") ||
          summaryLower.includes("startup exchange") ||
          ilpSummaryLower.includes("startup exchange") ||
          mitGroupsLower.includes("startup exchange") ||
          eventNameLower.includes("startup exchange") ||
          eventNameLower.includes("stex");

        if (isILP) {
          ilpEvents.push({ url: article.url, title: article.title, reason: "ILP event (auto)", autoIncluded: true, type: "ILP" });
        } else if (isSTEX) {
          stexEvents.push({ url: article.url, title: article.title, reason: "STEX event (auto)", autoIncluded: true, type: "STEX" });
        } else {
          otherArticles.push(article);
        }
      });
    } else {
      // Skip auto-includes (for alerts)
      otherArticles.push(...articles);
    }

    // Geographic filtering (same as yours)
    const memberLocation = (memberProfile?.geographicConsiderations || "").toLowerCase();
    const isUSBased =
      memberLocation.includes("us") ||
      memberLocation.includes("united states") ||
      memberLocation.includes("boston") ||
      memberLocation.includes("new york") ||
      memberLocation.includes("california");

    let filteredOtherArticles = otherArticles;
    if (isUSBased && otherArticles.length > 0) {
      const badLocations = ["japan", "tokyo", "beijing", "china", "europe", "london", "paris", "berlin"];
      filteredOtherArticles = otherArticles.filter((article) => {
        const location = (article.location || "").toLowerCase();
        const title = (article.title || "").toLowerCase();
        const isEvent = article.kind === "future_event";
        if (isEvent) {
          for (const badLoc of badLocations) {
            if (location.includes(badLoc) || title.includes(badLoc)) return false;
          }
        }
        return true;
      });
    }

    const articlesText = filteredOtherArticles
      .map(
        (a, idx) => `
Article ${idx + 1}:
URL: ${a.url}
Title: ${stripXML(a.title)}
Type: ${a.kind || "unknown"}
Summary: ${a.summary || ""}
Keywords: ${a.keywords || ""}
Industries: ${a.industries || ""}
Tech Themes: ${a.techThemes || ""}
MIT Groups: ${parseMitGroups(a.mitGroups) || "N/A"}
Event Location: ${a.location || "N/A"}
`
      )
      .join("\n---\n");

    const prompt = `You are an expert at matching MIT research content to corporate member interests.

${memberProfileText}

TASK: Select the TOP 10 MOST RELEVANT articles from the list below for ${memberName}.

NOTE: All ILP and STEX events have already been automatically included. You only need to pick the 10 best additional articles from this list.

Respond ONLY with valid JSON in this exact format:
{
  "matches": [
    { "url": "article_url", "title": "article_title", "reason": "Why this is relevant (1 sentence)" }
  ]
}

Articles:
${articlesText}
`;

    let aiMatches = [];
    if (filteredOtherArticles.length > 0) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You match content to interests and return ONLY valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.5,
      });

      const responseText = completion.choices?.[0]?.message?.content?.trim() || "{}";
      try {
        const cleanJson = responseText.replaceAll("```json", "").replaceAll("```", "").trim();
        const parsed = JSON.parse(cleanJson);
        aiMatches = (parsed.matches || []).slice(0, 10);
      } catch {
        aiMatches = [];
      }
    }

    const allMatches = [...ilpEvents, ...stexEvents, ...aiMatches];

    res.json({
      matches: allMatches,
      count: allMatches.length,
      memberName,
      ilpCount: ilpEvents.length,
      stexCount: stexEvents.length,
      aiCount: aiMatches.length,
      totalAnalyzed: articles.length,
    });
  } catch (err) {
    console.error("Error in smart-match endpoint:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// API: Temp Prospect Profile (Fast Temp Add)
// ============================================================

app.post("/api/temp-prospect", async (req, res) => {
  try {
    const { memberName, Member, pointOfContact, PocFirstName, mainIndustry, phrases, personId } = req.body || {};
    
    const company = memberName || Member;
    const poc = pointOfContact || PocFirstName;
    
    if (!company || !poc) {
      return res.status(400).json({ error: "Company name and contact first name are required" });
    }
    
    // Get personId from query or body (default to 'default' if not provided)
    const targetPersonId = personId || req.query.personId || 'default';
    
    // Initialize temp prospects array for this person if it doesn't exist
    if (!tempProspects[targetPersonId]) {
      tempProspects[targetPersonId] = [];
    }
    
    // Create temp profile
    const tempProfile = {
      memberName: company,
      Member: company,
      pointOfContact: poc,
      PocFirstName: poc,
      mainIndustry: mainIndustry || "",
      description: mainIndustry ? `${mainIndustry} company` : "",
      phrases: Array.isArray(phrases) ? phrases.filter(Boolean) : [],
      commonName1: company,
      commonName2: "",
      isTemp: true,
      createdAt: new Date().toISOString()
    };
    
    // Add to temp prospects (at the beginning so it appears first)
    tempProspects[targetPersonId].unshift(tempProfile);
    
    // Clear cache so loadMembers will rebuild with the new temp
    delete cachedMembersByPerson[targetPersonId];
    
    console.log(`⚡ [DEBUG] After adding temp:`);
    console.log(`   - targetPersonId: ${targetPersonId}`);
    console.log(`   - tempProspects[${targetPersonId}].length: ${tempProspects[targetPersonId].length}`);
    console.log(`   - Temp profile: ${JSON.stringify(tempProfile, null, 2).substring(0, 200)}`);
    
    console.log(`⚡ Created temp prospect for ${targetPersonId}: ${company} (POC: ${poc})`);
    console.log(`   Total temp prospects for this person: ${tempProspects[targetPersonId].length}`);
    
    res.json({ 
      success: true, 
      profile: tempProfile,
      message: `Temp prospect "${company}" created successfully`
    });
    
  } catch (err) {
    console.error("Error creating temp prospect:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// API: Clear temp prospects (optional - clear all temp profiles for a person)
app.delete("/api/temp-prospects", async (req, res) => {
  try {
    const personId = req.query.personId || 'default';
    const count = tempProspects[personId]?.length || 0;
    
    tempProspects[personId] = [];
    
    console.log(`🗑️  Cleared ${count} temp prospects for ${personId}`);
    
    res.json({ success: true, cleared: count });
  } catch (err) {
    console.error("Error clearing temp prospects:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});




// ============================================================
// Email Template & Sending
// ============================================================

function getScoreColor(score) {
  if (score >= 9) return '#27ae60'; // Green - exceptional
  if (score >= 7) return '#2ecc71'; // Light green - highly relevant
  if (score >= 5) return '#f39c12'; // Orange - moderately relevant
  if (score >= 3) return '#e67e22'; // Dark orange - somewhat relevant
  return '#95a5a6'; // Gray - weakly relevant
}

function getScoreLabel(score) {
  if (score >= 9) return 'Exceptional';
  if (score >= 7) return 'Highly Relevant';
  if (score >= 5) return 'Moderately Relevant';
  if (score >= 3) return 'Somewhat Relevant';
  return 'Weakly Relevant';
}

function generateAlertEmailHTML(alert, matches) {
  const matchesHTML = matches.map(m => {
    const score = m.relevanceScore || 0;
    const scoreColor = getScoreColor(score);
    const scoreLabel = getScoreLabel(score);
    const isAutoIncluded = m.autoIncluded || false;
    
    return `
      <div style="border-left: 4px solid ${scoreColor}; padding: 15px; margin: 15px 0; background: #f9f9f9;">
        <h3 style="margin: 0 0 8px 0;">
          <a href="${m.url}" style="color: #2c3e50; text-decoration: none;">${m.title}</a>
        </h3>
        ${score > 0 ? `
          <div style="margin: 8px 0;">
            <span style="display: inline-block; padding: 4px 10px; background: ${scoreColor}; color: white; border-radius: 4px; font-size: 0.85em; font-weight: bold;">
              ${score}/10 - ${scoreLabel}
            </span>
          </div>
        ` : ''}
        ${m.kind ? `<div style="font-size: 0.9em; color: #666; margin: 5px 0;"><strong>Type:</strong> ${m.kind}</div>` : ''}
        <div style="font-size: 0.9em; color: #555; margin: 8px 0; line-height: 1.5;">
          <strong>Why relevant:</strong> ${m.reason}
        </div>
        ${isAutoIncluded ? `<div style="font-size: 0.85em; color: #27ae60; margin-top: 5px;">✓ Auto-included (ILP/STEX event)</div>` : ''}
      </div>
    `;
  }).join('');

  const threshold = alert.relevanceThreshold || 7;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 0;
    }
    .container {
      background: #ffffff;
    }
    .header {
      background: linear-gradient(135deg, #e67e22 0%, #d35400 100%);
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0 0 10px 0;
      font-size: 24px;
    }
    .header p {
      margin: 5px 0;
      font-size: 14px;
      opacity: 0.9;
    }
    .content {
      padding: 30px 20px;
    }
    .summary {
      background: #f0f8ff;
      border-left: 4px solid #3498db;
      padding: 15px;
      margin: 0 0 25px 0;
      border-radius: 4px;
    }
    .footer {
      background: #f5f5f5;
      padding: 20px;
      text-align: center;
      font-size: 0.9em;
      color: #666;
      border-top: 1px solid #ddd;
    }
    .footer a {
      color: #e67e22;
      text-decoration: none;
    }
    .footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔔 New Matches for ${alert.memberName}</h1>
      <p>Alert: <strong>${alert.alertName}</strong></p>
      <p>Search: "${alert.searchParams.phrase}" | Threshold: ≥${threshold}/10</p>
    </div>
    
    <div class="content">
      <div class="summary">
        <strong>📊 Summary:</strong> Found <strong>${matches.length}</strong> new relevant items matching your criteria.
      </div>
      
      ${matchesHTML}
    </div>
    
    <div class="footer">
      <p>This is an automated alert from MIT Brain.</p>
      <p>
        <a href="http://localhost:3000">View in MIT Brain</a> | 
        <a href="http://localhost:3000">Manage Alerts</a>
      </p>
      <p style="font-size: 0.85em; color: #999; margin-top: 15px;">
        Alert ID: ${alert.alertId} | Run: ${new Date().toLocaleString()}
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

async function sendAlertEmail(alert, matches) {
  if (!emailTransporter) {
    console.log("⚠️  Email transporter not configured, skipping email send");
    return false;
  }

  try {
    const htmlContent = generateAlertEmailHTML(alert, matches);
    const subject = `🔔 ${matches.length} new matches for ${alert.memberName}`;

    const mailOptions = {
      from: EMAIL_CONFIG.from,
      to: alert.emailSettings.recipientEmail,
      subject: subject,
      html: htmlContent,
    };

    const info = await emailTransporter.sendMail(mailOptions);
    console.log(`✉️  Email sent to ${alert.emailSettings.recipientEmail}: ${info.messageId}`);
    return true;

  } catch (err) {
    console.error("❌ Error sending email:", err.message);
    return false;
  }
}

/**
 * Send one consolidated email with all alerts for a person
 */
async function sendConsolidatedAlertEmail(personId, allMatchesByAlert, recipientEmail) {
  if (!emailTransporter) {
    console.log("⚠️  Email transporter not configured, skipping email send");
    return false;
  }

  try {
    const today = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    const totalMatches = allMatchesByAlert.reduce((sum, item) => sum + item.matches.length, 0);
    const alertCount = allMatchesByAlert.length;

    // Build HTML for each alert section
    const alertSectionsHTML = allMatchesByAlert.map(({ alert, matches }) => {
      const matchesHTML = matches.map(m => {
        const score = m.relevanceScore || 0;
        const scoreColor = getScoreColor(score);
        const scoreLabel = getScoreLabel(score);
        const isAutoIncluded = m.autoIncluded || false;
        
        return `
          <div style="border-left: 4px solid ${scoreColor}; padding: 12px; margin: 10px 0; background: #f9f9f9;">
            <h4 style="margin: 0 0 6px 0;">
              <a href="${m.url}" style="color: #2c3e50; text-decoration: none;">${m.title}</a>
            </h4>
            ${score > 0 ? `
              <div style="margin: 6px 0;">
                <span style="display: inline-block; padding: 3px 8px; background: ${scoreColor}; color: white; border-radius: 3px; font-size: 0.8em; font-weight: bold;">
                  ${score}/10 - ${scoreLabel}
                </span>
              </div>
            ` : ''}
            ${m.kind ? `<div style="font-size: 0.85em; color: #666; margin: 4px 0;"><strong>Type:</strong> ${m.kind}</div>` : ''}
            <div style="font-size: 0.85em; color: #555; margin: 6px 0; line-height: 1.4;">
              <strong>Why relevant:</strong> ${m.reason}
            </div>
            ${isAutoIncluded ? `<div style="font-size: 0.8em; color: #27ae60; margin-top: 4px;">✓ Auto-included (ILP/STEX event)</div>` : ''}
          </div>
        `;
      }).join('');

      const threshold = alert.relevanceThreshold || 7;
      
      return `
        <div style="margin-bottom: 40px;">
          <div style="background: #f0f8ff; border-left: 4px solid #3498db; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
            <h3 style="margin: 0 0 8px 0; color: #2c3e50;">
              🔔 ${alert.alertName}
            </h3>
            <div style="font-size: 0.9em; color: #555;">
              <strong>Company:</strong> ${alert.memberName}<br>
              <strong>Search:</strong> "${alert.searchParams.phrase}"<br>
              <strong>Matches:</strong> ${matches.length} new items (threshold: ≥${threshold}/10)
            </div>
          </div>
          ${matchesHTML}
        </div>
      `;
    }).join('');

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 900px;
      margin: 0 auto;
      padding: 0;
      background: #f5f5f5;
    }
    .container {
      background: #ffffff;
    }
    .header {
      background: linear-gradient(135deg, #e67e22 0%, #d35400 100%);
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0 0 10px 0;
      font-size: 26px;
    }
    .header p {
      margin: 5px 0;
      font-size: 15px;
      opacity: 0.95;
    }
    .content {
      padding: 30px 20px;
    }
    .summary {
      background: #e8f5e9;
      border-left: 4px solid #4caf50;
      padding: 20px;
      margin: 0 0 30px 0;
      border-radius: 4px;
    }
    .summary h2 {
      margin: 0 0 10px 0;
      color: #2c3e50;
      font-size: 20px;
    }
    .footer {
      background: #f5f5f5;
      padding: 20px;
      text-align: center;
      font-size: 0.9em;
      color: #666;
      border-top: 1px solid #ddd;
    }
    .footer a {
      color: #e67e22;
      text-decoration: none;
    }
    .footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📬 Daily MIT Brain Alert Digest</h1>
      <p><strong>${today}</strong></p>
      <p>${alertCount} Alert${alertCount !== 1 ? 's' : ''} • ${totalMatches} Total Match${totalMatches !== 1 ? 'es' : ''}</p>
    </div>
    
    <div class="content">
      <div class="summary">
        <h2>📊 Daily Summary</h2>
        <p>You have <strong>${totalMatches} new matches</strong> across <strong>${alertCount} active alert${alertCount !== 1 ? 's' : ''}</strong> for today.</p>
      </div>
      
      ${alertSectionsHTML}
    </div>
    
    <div class="footer">
      <p><strong>MIT Brain Alert System</strong></p>
      <p>
        <a href="http://localhost:3000">View in MIT Brain</a> | 
        <a href="http://localhost:3000">Manage Alerts</a>
      </p>
      <p style="font-size: 0.85em; color: #999; margin-top: 15px;">
        Person: ${personId} | Sent: ${new Date().toLocaleString()}
      </p>
      <p style="font-size: 0.8em; color: #999; margin-top: 10px;">
        This is your daily digest. All alerts are checked once per day and consolidated into this single email.
      </p>
    </div>
  </div>
</body>
</html>
    `;

    const mailOptions = {
      from: EMAIL_CONFIG.from,
      to: recipientEmail,
      subject: `📬 MIT Brain Daily Digest: ${totalMatches} new matches (${today})`,
      html: htmlContent,
    };

    const info = await emailTransporter.sendMail(mailOptions);
    console.log(`✉️  Consolidated email sent to ${recipientEmail}: ${info.messageId}`);
    return true;

  } catch (err) {
    console.error("❌ Error sending consolidated email:", err.message);
    return false;
  }
}

// ============================================================
// Alert Management API
// ============================================================

// Create alert
app.post("/api/alerts", async (req, res) => {
  try {
    const {
      personId,
      memberName,
      memberProfile,
      searchParams,
      alertName,
      emailSettings,
      useSmartMatch
    } = req.body || {};

    if (!personId || !memberName || !alertName || !emailSettings) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Generate alert ID
    const alertId = `${memberName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;

    const alert = {
      alertId,
      alertName,
      memberName,
      memberProfile: memberProfile || {},
      searchParams: searchParams || {},
      emailSettings,
      useSmartMatch: useSmartMatch !== false, // Default to true
      active: true,
      metadata: {
        createdAt: new Date().toISOString(),
        lastRunAt: null,
        lastMatchCount: 0,
        seenArticleIds: []
      }
    };

    saveAlert(personId, alert);

    console.log(`📬 Created alert: ${alertId} for ${personId}`);

    res.json({
      alertId,
      message: "Alert created successfully"
    });

  } catch (err) {
    console.error("Error creating alert:", err);
    res.status(500).json({ error: err.message });
  }
});

// List alerts for person
app.get("/api/alerts", async (req, res) => {
  try {
    const { personId } = req.query;

    if (!personId) {
      return res.status(400).json({ error: "Missing personId parameter" });
    }

    const alerts = loadAlertsForPerson(personId);

    res.json({
      alerts,
      count: alerts.length
    });

  } catch (err) {
    console.error("Error loading alerts:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update alert (pause/resume, etc.)
app.put("/api/alerts/:alertId", async (req, res) => {
  try {
    const { alertId } = req.params;
    const { personId, ...updates } = req.body || {};

    if (!personId) {
      return res.status(400).json({ error: "Missing personId parameter" });
    }

    const alertsDir = path.join(__dirname, "../../people", personId, "alerts");
    const alertPath = path.join(alertsDir, `${alertId}.json`);

    if (!fsSync.existsSync(alertPath)) {
      return res.status(404).json({ error: "Alert not found" });
    }

    const alertContent = fsSync.readFileSync(alertPath, 'utf8');
    const alert = JSON.parse(alertContent);
    
    // Apply updates
    Object.assign(alert, updates);
    
    saveAlert(personId, alert);

    console.log(`✏️ Updated alert: ${alertId}`);

    res.json({
      message: "Alert updated successfully",
      alert
    });

  } catch (err) {
    console.error("Error updating alert:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete alert
app.delete("/api/alerts/:alertId", async (req, res) => {
  try {
    const { alertId } = req.params;
    const { personId } = req.query;

    if (!personId) {
      return res.status(400).json({ error: "Missing personId parameter" });
    }

    deleteAlert(personId, alertId);

    res.json({
      message: "Alert deleted successfully"
    });

  } catch (err) {
    console.error("Error deleting alert:", err);
    res.status(500).json({ error: err.message });
  }
});

// Run alert manually
app.post("/api/alerts/:alertId/run", async (req, res) => {
  try {
    const { alertId } = req.params;
    const { personId } = req.body || {};

    if (!personId) {
      return res.status(400).json({ error: "Missing personId parameter" });
    }

    const alertsDir = path.join(__dirname, "../../people", personId, "alerts");
    const alertPath = path.join(alertsDir, `${alertId}.json`);

    if (!fsSync.existsSync(alertPath)) {
      return res.status(404).json({ error: "Alert not found" });
    }

    const alertContent = fsSync.readFileSync(alertPath, 'utf8');
    const alert = JSON.parse(alertContent);

    console.log(`▶ Running alert manually: ${alertId}`);

    const result = await processAlert(alert, personId);

    res.json({
      alertId,
      alertName: alert.alertName,
      matches: result.matches,
      matchCount: result.matches.length,
      emailSent: result.emailSent,
      message: result.message
    });

  } catch (err) {
    console.error("Error running alert:", err);
    res.status(500).json({ error: err.message });
  }
});



// Test email configuration
app.post("/api/test-email", async (req, res) => {
  try {
    const { recipientEmail } = req.body || {};

    if (!recipientEmail) {
      return res.status(400).json({ error: "Missing recipientEmail parameter" });
    }

    if (!emailTransporter) {
      return res.status(500).json({ 
        error: "Email not configured. Set EMAIL_USER and EMAIL_PASSWORD environment variables." 
      });
    }

    // Send test email
    const testHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          .header { background: #e67e22; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>✅ MIT Brain Email Test</h2>
        </div>
        <div class="content">
          <p>This is a test email from MIT Brain alert system.</p>
          <p>If you're seeing this, your email configuration is working correctly!</p>
          <p><strong>Configuration:</strong></p>
          <ul>
            <li>Service: ${EMAIL_CONFIG.service}</li>
            <li>From: ${EMAIL_CONFIG.from}</li>
            <li>Time: ${new Date().toLocaleString()}</li>
          </ul>
          <p>You're all set to receive alert notifications.</p>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: EMAIL_CONFIG.from,
      to: recipientEmail,
      subject: "✅ MIT Brain Email Test",
      html: testHTML,
    };

    const info = await emailTransporter.sendMail(mailOptions);
    
    console.log(`✉️  Test email sent to ${recipientEmail}: ${info.messageId}`);

    res.json({
      success: true,
      message: "Test email sent successfully",
      messageId: info.messageId,
      recipient: recipientEmail
    });

  } catch (err) {
    console.error("Error sending test email:", err);
    res.status(500).json({ 
      error: "Failed to send test email", 
      details: err.message 
    });
  }
});

// Add to server.js - Webapp Reload Endpoint
// Place this with the other API endpoints

// ============================================================
// Hot Reload Endpoint (for production updates)
// ============================================================

/**
 * POST /api/reload
 * Reloads the brain data without restarting the server
 * Called automatically after scheduled scraping/enrichment
 */
app.post("/api/reload", async (req, res) => {
  try {
    console.log("\n🔄 Hot reload triggered...");
    
    const oldCount = articles.length;
    const oldKinds = { ...articlesByKind };
    
    // Reload articles from JSONL
    await loadArticles();
    
    const newCount = articles.length;
    const addedCount = newCount - oldCount;
    
    console.log(`✅ Reload complete:`);
    console.log(`   Old count: ${oldCount}`);
    console.log(`   New count: ${newCount}`);
    console.log(`   Added: ${addedCount}`);
    console.log(`   Old kinds:`, oldKinds);
    console.log(`   New kinds:`, articlesByKind);
    
    res.json({
      success: true,
      oldCount,
      newCount,
      addedCount,
      oldKinds,
      newKinds: articlesByKind,
      message: `Reloaded ${newCount} articles (${addedCount} new)`
    });
    
  } catch (error) {
    console.error("❌ Reload failed:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/status
 * Returns current brain status (for monitoring)
 */
app.get("/api/status", (req, res) => {
  res.json({
    brainFile: JSONL_FILENAME,
    articleCount: articles.length,
    kinds: articlesByKind,
    loadedAt: serverStartTime,
    uptime: process.uptime()
  });
});

// ============================================================
// Daily Alert Cron Job
// ============================================================

// Run every day at 9:00 AM
cron.schedule('0 9 * * *', async () => {
  console.log('\n========================================');
  console.log('🔔 DAILY ALERT CHECK - ' + new Date().toLocaleString());
  console.log('========================================\n');

  try {
    // Get all person directories
    const peopleDir = path.join(__dirname, '../../people');
    if (!fsSync.existsSync(peopleDir)) {
      console.log('No people directory found');
      return;
    }

    const people = fsSync.readdirSync(peopleDir);
    let totalPeople = 0;
    let totalAlerts = 0;
    let totalEmailsSent = 0;

    // Process each person separately
    for (const personId of people) {
      const personPath = path.join(peopleDir, personId);
      if (!fsSync.statSync(personPath).isDirectory()) continue;

      totalPeople++;
      const alerts = loadAlertsForPerson(personId);
      
      if (alerts.length === 0) {
        console.log(`\n👤 ${personId}: No alerts configured`);
        continue;
      }

      console.log(`\n👤 ${personId}: Processing ${alerts.length} alerts...`);

      // Collect all matches for this person
      const allMatchesByAlert = [];
      let activeAlerts = 0;

      for (const alert of alerts) {
        // Skip inactive alerts
        if (!alert.active) {
          console.log(`   ⏸  Skipped (paused): ${alert.alertName}`);
          continue;
        }

        // Check frequency
        if (alert.emailSettings.frequency !== 'daily') {
          console.log(`   ⏭  Skipped (non-daily): ${alert.alertName} (${alert.emailSettings.frequency})`);
          continue;
        }

        activeAlerts++;
        totalAlerts++;

        console.log(`   ▶ Running: ${alert.alertName}`);

        try {
          const result = await processAlert(alert, personId);

          if (result.matches.length > 0) {
            allMatchesByAlert.push({
              alert: alert,
              matches: result.matches
            });
            console.log(`     ✅ Found ${result.matches.length} new matches`);
          } else {
            console.log(`     ℹ️  No new matches`);
          }

        } catch (err) {
          console.error(`     ❌ Error: ${err.message}`);
        }
      }

      // Send ONE consolidated email if there are any matches
      if (allMatchesByAlert.length > 0) {
        const totalMatches = allMatchesByAlert.reduce((sum, item) => sum + item.matches.length, 0);
        console.log(`\n   📧 Sending consolidated email: ${allMatchesByAlert.length} alerts, ${totalMatches} total matches`);
        
        // Get first alert's recipient email (all alerts for a person should use same email)
        const recipientEmail = allMatchesByAlert[0].alert.emailSettings.recipientEmail;
        
        const emailSent = await sendConsolidatedAlertEmail(personId, allMatchesByAlert, recipientEmail);
        
        if (emailSent) {
          totalEmailsSent++;
          console.log(`   ✅ Email sent to ${recipientEmail}`);
        } else {
          console.log(`   ⚠️  Email failed to send`);
        }
      } else if (activeAlerts > 0) {
        console.log(`   ℹ️  No matches found across ${activeAlerts} active alerts`);
      }
    }

    console.log('\n========================================');
    console.log('📊 DAILY ALERT CHECK COMPLETE');
    console.log(`   People processed: ${totalPeople}`);
    console.log(`   Alerts checked: ${totalAlerts}`);
    console.log(`   Emails sent: ${totalEmailsSent}`);
    console.log('========================================\n');

  } catch (err) {
    console.error('❌ Error in daily alert check:', err);
  }
});

console.log('⏰ Daily alert cron job scheduled (9:00 AM)');

// ============================================================
// Start server
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  
  
});