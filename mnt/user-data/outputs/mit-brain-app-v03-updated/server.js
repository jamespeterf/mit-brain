// server.js
//
// Backend for MIT News Monitor
// - Serves front-end from /public
// - /api/matches                  → phrase-based article search
// - /api/members                  → list of ILP members from member-profiles.csv
// - /api/member-intro             → OpenAI-generated intro tailored to chosen member & tone
// - /api/member-article-summaries → OpenAI-generated rewritten summaries for chosen member & tone

import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import OpenAI from "openai";

// Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Load MIT Brain JSONL data ----------

const jsonlPath = path.join(__dirname, "mit_brain_test01.jsonl");
let articles = [];

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
    
    console.log(`✅ Loaded ${articles.length} articles from JSONL`);
    return articles;
  } catch (err) {
    console.error("❌ Error loading mit_brain_test01.jsonl:", err.message);
    console.error("   Path:", jsonlPath);
    console.error("   Make sure the file exists and is readable");
    articles = [];
    return articles;
  }
}

// Search function that searches ilpSummary, ilpKeywords, fullText, tags, authors, and title
function searchArticlesByPhrase(phrase, options = {}) {
  const minScore = options.minScore || 0;
  const phraseLower = phrase.toLowerCase();
  
  console.log(`🔍 Searching ${articles.length} articles for: "${phrase}" (minScore: ${minScore})`);
  
  const matches = articles
    .map((article) => {
      let score = 0;
      let matchedIn = [];
      
      // Search in ilpSummary (highest priority)
      const summary = (article.ilpSummary || "").toLowerCase();
      if (summary.includes(phraseLower)) {
        score += 1.0;
        matchedIn.push("summary");
      }
      
      // Search in ilpKeywords (handle both array and string)
      let keywordsStr = "";
      if (Array.isArray(article.ilpKeywords)) {
        keywordsStr = article.ilpKeywords.join(" ").toLowerCase();
      } else if (typeof article.ilpKeywords === "string") {
        keywordsStr = article.ilpKeywords.toLowerCase();
      }
      
      if (keywordsStr.includes(phraseLower)) {
        score += 0.8;
        matchedIn.push("keywords");
      }
      
      // Search in fullText
      const fullText = (article.fullText || "").toLowerCase();
      if (fullText.includes(phraseLower)) {
        score += 0.7;
        matchedIn.push("fullText");
      }
      
      // Search in tags (handle both array and string)
      let tagsStr = "";
      if (Array.isArray(article.tags)) {
        tagsStr = article.tags.join(" ").toLowerCase();
      } else if (typeof article.tags === "string") {
        tagsStr = article.tags.toLowerCase();
      }
      
      if (tagsStr.includes(phraseLower)) {
        score += 0.6;
        matchedIn.push("tags");
      }
      
      // Search in authors (handle both array and string)
      let authorsStr = "";
      if (Array.isArray(article.authors)) {
        authorsStr = article.authors.join(" ").toLowerCase();
      } else if (typeof article.authors === "string") {
        authorsStr = article.authors.toLowerCase();
      }
      
      if (authorsStr.includes(phraseLower)) {
        score += 0.5;
        matchedIn.push("authors");
      }
      
      // Also search in title
      const title = (article.title || "").toLowerCase();
      if (title.includes(phraseLower)) {
        score += 0.5;
        matchedIn.push("title");
      }
      
      if (score > 0) {
        return {
          ...article,
          score,
          matchedIn: matchedIn.join(", ")
        };
      }
      
      return null;
    })
    .filter(Boolean)
    .filter((a) => a.score >= minScore)
    .sort((a, b) => b.score - a.score);
  
  console.log(`   Found ${matches.length} matching articles`);
  return matches;
}

// Load articles on startup
await loadArticles();

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Static files (front-end)
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// JSON body parsing - increased limit to handle large article selections
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ---------- Simple CSV parser & member loader ----------

const membersCsvPath = path.join(__dirname, "member-profiles.csv");
let cachedMembersByPerson = {}; // Cache by personId

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) {
    console.warn("⚠️ CSV is empty");
    return { header: [], rows: [] };
  }

  const header = lines[0].split(",").map((h) => h.trim());
  console.log(`📋 CSV header (${header.length} columns):`, header);
  
  const rows = lines.slice(1).map((line, idx) => {
    const cols = line.split(",");
    const row = {};
    header.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    return row;
  });

  console.log(`📊 Parsed ${rows.length} rows from CSV`);
  return { header, rows };
}

async function loadMembers(personId = null) {
  const cacheKey = personId || 'default';
  
  if (cachedMembersByPerson[cacheKey]) {
    console.log(`✅ Using cached members for ${cacheKey} (${cachedMembersByPerson[cacheKey].length})`);
    return cachedMembersByPerson[cacheKey];
  }

  // Determine CSV path based on personId
  let csvPath;
  if (personId) {
    csvPath = path.join(__dirname, "people", personId, "member-profiles.csv");
    console.log(`📂 Loading members for ${personId} from: ${csvPath}`);
  } else {
    csvPath = membersCsvPath;
    console.log(`📂 Loading members from: ${csvPath}`);
  }
  
  try {
    const content = await fs.readFile(csvPath, "utf8");
    console.log(`✅ Read CSV file (${content.length} bytes)`);
    
    const { rows } = parseCsv(content);

    const members = rows
      .map((row, idx) => {
        const memberName = (row["Member"] || "").trim();
        if (!memberName) {
          console.warn(`⚠️ Row ${idx + 2} skipped: no member name`);
          return null;
        }

        const commonName1 = (row["Common Name 1"] || "").trim();
        const commonName2 = (row["Common Name 2"] || "").trim();
        const pointOfContact = (row["PocFirstName"] || row["Point-of-Contact"] || "").trim();

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
        };
      })
      .filter(Boolean);

    cachedMembersByPerson[cacheKey] = members;
    console.log(`✅ Loaded ${members.length} members for ${cacheKey}`);
    if (members.length > 0) {
      console.log(`   First member: ${members[0].memberName} (${members[0].phrases.length} phrases)`);
    }
    
    return members;
  } catch (err) {
    console.error(`❌ Error loading member-profiles.csv for ${cacheKey}:`, err.message);
    console.error("   Path:", csvPath);
    console.error("   Make sure the file exists and is readable");
    cachedMembersByPerson[cacheKey] = [];
    return [];
  }
}

// ---------- API: list all people ----------

app.get("/api/people", async (req, res) => {
  try {
    console.log("📡 /api/people requested");
    const peopleDir = path.join(__dirname, "people");
    const entries = await fs.readdir(peopleDir, { withFileTypes: true });
    
    const people = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => ({
        id: entry.name,
        name: entry.name.replace(/-/g, ' ')
      }));
    
    console.log(`✅ Found ${people.length} people:`, people.map(p => p.name).join(', '));
    res.json(people);
  } catch (err) {
    console.error("❌ Error in /api/people:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- API: get person's my-voice and templates ----------

app.get("/api/people/:personId/data", async (req, res) => {
  try {
    const { personId } = req.params;
    console.log(`📡 /api/people/${personId}/data requested`);
    
    const personDir = path.join(__dirname, "people", personId);
    const myVoicePath = path.join(personDir, "my-voice.txt");
    const templatesDir = path.join(personDir, "templates");
    
    // Read my-voice.txt
    let myVoice = "";
    try {
      myVoice = await fs.readFile(myVoicePath, "utf8");
      console.log(`✅ Loaded my-voice.txt for ${personId}`);
    } catch (err) {
      console.warn(`⚠️ Could not load my-voice.txt for ${personId}:`, err.message);
    }
    
    // List templates
    let templates = [];
    try {
      const templateFiles = await fs.readdir(templatesDir);
      templates = templateFiles
        .filter(f => f.endsWith('.txt'))
        .map(f => ({
          id: f.replace('.txt', ''),
          name: f.replace('.txt', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          filename: f
        }));
      console.log(`✅ Found ${templates.length} templates for ${personId}`);
    } catch (err) {
      console.warn(`⚠️ Could not load templates for ${personId}:`, err.message);
    }
    
    res.json({
      personId,
      myVoice,
      templates
    });
  } catch (err) {
    console.error("❌ Error in /api/people/:personId/data:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- API: get template content ----------

app.get("/api/people/:personId/templates/:templateId", async (req, res) => {
  try {
    const { personId, templateId } = req.params;
    console.log(`📡 /api/people/${personId}/templates/${templateId} requested`);
    
    const templatePath = path.join(__dirname, "people", personId, "templates", `${templateId}.txt`);
    
    try {
      const content = await fs.readFile(templatePath, "utf8");
      console.log(`✅ Loaded template ${templateId} for ${personId}`);
      res.json({ content });
    } catch (err) {
      console.error(`❌ Template not found: ${templatePath}`, err.message);
      res.status(404).json({ error: "Template not found" });
    }
  } catch (err) {
    console.error("❌ Error in /api/people/:personId/templates/:templateId:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- API: article matches from local search ----------

app.get("/api/matches", (req, res) => {
  try {
    const phrase = (req.query.phrase || "").toString();
    const minScore = Number(req.query.minScore || 0);
    const results = searchArticlesByPhrase(phrase, { minScore });
    res.json(results);
  } catch (err) {
    console.error("Error in /api/matches:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- API: list ILP members ----------

app.get("/api/members", async (req, res) => {
  try {
    const { personId } = req.query;
    console.log(`📡 /api/members requested${personId ? ` for person: ${personId}` : ''}`);
    const members = await loadMembers(personId);
    
    // Defensive check
    if (!Array.isArray(members)) {
      console.error("❌ loadMembers() did not return an array:", typeof members);
      return res.json([]);
    }
    
    const simplified = members.map((m) => ({
      memberName: m.memberName,
      commonName1: m.commonName1,
      commonName2: m.commonName2,
      pointOfContact: m.pointOfContact,
    }));
    
    console.log(`✅ Returning ${simplified.length} members to client`);
    res.json(simplified);
  } catch (err) {
    console.error("❌ Error in /api/members:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- Tone helper ----------

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
- You may include a subtle, tasteful joke or witty turn of phrase, but never a pun that feels forced.
- Still professional and respectful.
`;
  }

  if (tone === "upbeat") {
    return `
Tone:
- Energetic, optimistic, and forward-looking.
- Show enthusiasm about MIT's work and the opportunities it creates.
- Still concise and professional.
`;
  }

  // default: familiar
  return `
Tone:
- Warm, familiar, collegial.
- As if writing to someone you regularly work with.
- Slightly conversational is fine.
- Still professional and concise.
`;
}

// ---------- Language helper ----------

function languageInstruction(languageRaw) {
  const language = (languageRaw || "english").toLowerCase();

  if (language === "spanish") {
    return `
CRITICAL INSTRUCTION - LANGUAGE:
You MUST write your ENTIRE response in SPANISH (español).
- Every word of your response must be in Spanish.
- Use proper Spanish grammar, vocabulary, and sentence structure.
- This is for professional business communication in Spanish.
- Technical terms should be in Spanish when Spanish equivalents exist.
- Only keep technical terms in English if they are universally used that way in Spanish business contexts (like "software" or "email").
- DO NOT write in English. Your response must be 100% in Spanish.
`;
  }

  if (language === "portuguese") {
    return `
CRITICAL INSTRUCTION - LANGUAGE:
You MUST write your ENTIRE response in PORTUGUESE (português brasileiro).
- Every word of your response must be in Portuguese.
- Use proper Portuguese grammar, vocabulary, and sentence structure.
- This is for professional business communication in Portuguese.
- Technical terms should be in Portuguese when Portuguese equivalents exist.
- Only keep technical terms in English if they are universally used that way in Portuguese business contexts (like "software" or "email").
- DO NOT write in English. Your response must be 100% in Portuguese.
`;
  }

  if (language === "french") {
    return `
CRITICAL INSTRUCTION - OUTPUT LANGUAGE:
You MUST write ONLY in FRENCH. NO ENGLISH ALLOWED.
Your ENTIRE response must be in French (français).
- Write EVERY SINGLE WORD in French
- Use French grammar and vocabulary ONLY
- Use formal "vous" for business communication
- This is MANDATORY: 100% French language output required
- Professional business French is required
- If you write ANY words in English, you have FAILED this instruction
- Technical terms should be in French when French equivalents exist (for example: "intelligence artificielle" not "artificial intelligence")
- DO NOT mix French and English
- Remember: The user needs FRENCH output, not English
FORBIDDEN: Do not write in English. English output is NOT acceptable.
REQUIRED: French language ONLY.
`;
  }

  if (language === "japanese") {
    return `
CRITICAL INSTRUCTION - OUTPUT LANGUAGE:
You MUST write ONLY in JAPANESE. NO ENGLISH ALLOWED.
Your ENTIRE response must be in Japanese (日本語).
- Write EVERY SINGLE WORD in Japanese using kanji (漢字), hiragana (ひらがな), and katakana (カタカナ) as appropriate
- Use Japanese grammar and vocabulary ONLY
- Use keigo (敬語) - formal/polite business Japanese (です・ます form)
- This is MANDATORY: 100% Japanese language output required
- Professional business Japanese is required
- If you write ANY words in English (except company names), you have FAILED this instruction
- Technical terms should be in katakana when that is standard practice
- DO NOT mix Japanese and English
- Remember: The user needs JAPANESE output, not English
FORBIDDEN: Do not write in English. English output is NOT acceptable.
REQUIRED: Japanese language ONLY (日本語のみ).
`;
  }

  if (language === "korean") {
    return `
CRITICAL INSTRUCTION - OUTPUT LANGUAGE:
You MUST write ONLY in KOREAN. NO ENGLISH ALLOWED.
Your ENTIRE response must be in Korean (한국어).
- Write EVERY SINGLE WORD in Korean using Hangul (한글)
- Use Korean grammar and vocabulary ONLY
- Use formal/honorific Korean suitable for business (존댓말)
- This is MANDATORY: 100% Korean language output required
- Professional business Korean is required
- If you write ANY words in English (except company names), you have FAILED this instruction
- Technical terms can use English loanwords only when standard in Korean business contexts
- DO NOT mix Korean and English
- Remember: The user needs KOREAN output, not English
FORBIDDEN: Do not write in English. English output is NOT acceptable.
REQUIRED: Korean language ONLY (한국어만).
`;
  }

  if (language === "hindi") {
    return `
CRITICAL INSTRUCTION - OUTPUT LANGUAGE:
You MUST write ONLY in HINDI. NO ENGLISH ALLOWED.
Your ENTIRE response must be in Hindi (हिन्दी).
- Write EVERY SINGLE WORD in Hindi using Devanagari script (देवनागरी)
- Use Hindi grammar and vocabulary ONLY
- Use formal Hindi suitable for professional business communication
- This is MANDATORY: 100% Hindi language output required
- Professional business Hindi is required
- If you write ANY words in English (except company names), you have FAILED this instruction
- Technical terms can use English loanwords only when standard in Hindi business contexts
- DO NOT mix Hindi and English
- Remember: The user needs HINDI output, not English
FORBIDDEN: Do not write in English. English output is NOT acceptable.
REQUIRED: Hindi language ONLY (हिन्दी में ही).
`;
  }

  if (language === "chinese") {
    return `
CRITICAL INSTRUCTION - OUTPUT LANGUAGE:
You MUST write ONLY in CHINESE. NO ENGLISH ALLOWED.
Your ENTIRE response must be in Simplified Chinese (简体中文).
- Write EVERY SINGLE WORD in Simplified Chinese characters (简体字)
- Use Chinese grammar and vocabulary ONLY
- Use formal Chinese suitable for professional business communication
- This is MANDATORY: 100% Chinese language output required
- Professional business Chinese is required
- If you write ANY words in English (except company names), you have FAILED this instruction
- Technical terms should be translated to Chinese when standard Chinese equivalents exist
- DO NOT mix Chinese and English
- Remember: The user needs CHINESE output, not English
FORBIDDEN: Do not write in English. English output is NOT acceptable.
REQUIRED: Chinese language ONLY (仅中文).
`;
  }

  if (language === "german") {
    return `
CRITICAL INSTRUCTION - OUTPUT LANGUAGE:
You MUST write ONLY in GERMAN. NO ENGLISH ALLOWED.
Your ENTIRE response must be in German (Deutsch).
- Write EVERY SINGLE WORD in German
- Use German grammar and vocabulary ONLY
- Use formal German suitable for professional business communication (Sie-Form)
- This is MANDATORY: 100% German language output required
- Professional business German is required
- If you write ANY words in English (except company names), you have FAILED this instruction
- Technical terms should be in German when German equivalents exist
- DO NOT mix German and English
- Remember: The user needs GERMAN output, not English
FORBIDDEN: Do not write in English. English output is NOT acceptable.
REQUIRED: German language ONLY (Nur Deutsch).
`;
  }

  if (language === "italian") {
    return `
CRITICAL INSTRUCTION - OUTPUT LANGUAGE:
You MUST write ONLY in ITALIAN. NO ENGLISH ALLOWED.
Your ENTIRE response must be in Italian (Italiano).
- Write EVERY SINGLE WORD in Italian
- Use Italian grammar and vocabulary ONLY
- Use formal Italian suitable for professional business communication
- This is MANDATORY: 100% Italian language output required
- Professional business Italian is required
- If you write ANY words in English (except company names), you have FAILED this instruction
- Technical terms can use English loanwords only when standard in Italian business contexts
- DO NOT mix Italian and English
- Remember: The user needs ITALIAN output, not English
FORBIDDEN: Do not write in English. English output is NOT acceptable.
REQUIRED: Italian language ONLY (Solo Italiano).
`;
  }

  // default: english
  return `
Language: Write your response in ENGLISH.
`;
}

// ---------- API: member-specific intro via OpenAI ----------
//
// NOTE: front-end sends { member, selectedArticles, tone }
// and expects { intro: "..." }

// ---------- API: member-specific intro via OpenAI ----------

app.post("/api/member-intro", async (req, res) => {
  try {
    // Front-end sends { member, selectedArticles, tone, language }
    const { member, selectedArticles, tone, language } = req.body || {};
    
    console.log(`\n========================================`);
    console.log(`🌍 /api/member-intro CALLED`);
    console.log(`   Language received: "${language}"`);
    console.log(`   Type: ${typeof language}`);
    console.log(`   Tone: "${tone}"`);
    console.log(`   Language instruction preview:`, languageInstruction(language).substring(0, 100) + '...');
    console.log(`========================================\n`);

    const articles = Array.isArray(selectedArticles) ? selectedArticles : [];

    // Derive memberName from the object or string (may be null/empty)
    let memberName =
      (typeof member === "string" && member) ||
      (member &&
        (member.memberName || member.commonName1 || member.commonName2)) ||
      "";

    if (!articles.length) {
      return res
        .status(400)
        .json({ error: "At least one article is required" });
    }

    // Only try to load member phrases if we *have* a memberName
    let memberContext = "";
    if (memberName) {
      try {
        const members = await loadMembers();
        const memberRecord = members.find(
          (m) =>
            m.memberName === memberName ||
            m.commonName1 === memberName ||
            m.commonName2 === memberName
        );

        const phrases = memberRecord?.phrases || [];
        memberContext = phrases.length
          ? `Key focus areas / phrases for ${memberName}: ${phrases.join(
              ", "
            )}.`
          : `${memberName} is a large ILP member with broad interest in innovation-relevant MIT work.`;
      } catch (e) {
        console.error("loadMembers error in /api/member-intro:", e);
      }
    }

    const articlesBlock = articles
      .map((a, i) => {
        const src = a.source || a.Source || "MIT News";
        const kind = a.kind || "unknown";
        return `
${i + 1}.
Title: ${a.title}
Source: ${src} [${kind.toUpperCase()}]
Date: ${a.date}
ILP Summary: ${a.ilpSummary || a.summary}
ILP Keywords: ${Array.isArray(a.ilpKeywords) ? a.ilpKeywords.join(", ") : a.ilpKeywords || ""}
General Keywords: ${a.keywords}
Industries: ${a.industries}
Tech Themes: ${a.techThemes}
MIT Unit: ${a.mitUnit}
`;
      })
      .join("\n");

    const prompt = `
${languageInstruction(language)}

You are helping a program director at MIT Corporate Relations write an email to an ILP member.

Member: ${memberName || "this company"}
${memberContext}
${toneInstruction(tone)}

Below are the MIT News stories that will be included:

${articlesBlock}

Write a short, 2–3 sentence paragraph that will appear immediately after "Hi [Name]," and before the list of stories.

Guidelines:
- REMEMBER: Write in the language specified at the top of this prompt.
- Explain why these MIT efforts are relevant and interesting specifically for ${
      memberName || "this company"
    }.
- Connect to their likely priorities and focus areas.
- Match the tone described above.
- Do NOT mention "articles", "bullet points", or "list" explicitly.
- Do NOT include a greeting or sign-off.
- Refer to "these MIT efforts" or "this work at MIT" rather than "the articles".
`;

    const systemPrompt = language === "chinese" 
      ? "You help MIT Corporate Relations write concise, tailored email intros for ILP member companies. You MUST write ONLY in CHINESE (Simplified Chinese). NO ENGLISH WORDS ALLOWED. 您必须仅用中文书写。不允许使用英文。"
      : language === "german"
      ? "You help MIT Corporate Relations write concise, tailored email intros for ILP member companies. You MUST write ONLY in GERMAN. NO ENGLISH WORDS ALLOWED. Sie müssen nur auf Deutsch schreiben. Englisch ist verboten."
      : language === "italian"
      ? "You help MIT Corporate Relations write concise, tailored email intros for ILP member companies. You MUST write ONLY in ITALIAN. NO ENGLISH WORDS ALLOWED. Devi scrivere solo in italiano. L'inglese non è consentito."
      : language === "french" 
      ? "You help MIT Corporate Relations write concise, tailored email intros for ILP member companies. You MUST write ONLY in FRENCH. NO ENGLISH WORDS ALLOWED. Vous devez écrire en français uniquement."
      : language === "japanese"
      ? "You help MIT Corporate Relations write concise, tailored email intros for ILP member companies. You MUST write ONLY in JAPANESE. NO ENGLISH WORDS ALLOWED. 日本語のみで書いてください。英語は禁止です。"
      : language === "korean"
      ? "You help MIT Corporate Relations write concise, tailored email intros for ILP member companies. You MUST write ONLY in KOREAN. NO ENGLISH WORDS ALLOWED. 한국어로만 작성해야 합니다. 영어는 금지됩니다."
      : language === "hindi"
      ? "You help MIT Corporate Relations write concise, tailored email intros for ILP member companies. You MUST write ONLY in HINDI. NO ENGLISH WORDS ALLOWED. हिन्दी में ही लिखें। अंग्रेज़ी की अनुमति नहीं है।"
      : "You help MIT Corporate Relations write concise, tailored email intros for ILP member companies. You ALWAYS write in the language specified by the user.";

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: prompt },
      ],
    });

    let introText =
      completion.choices?.[0]?.message?.content?.trim() ||
      "I thought you might be interested in these recent MIT efforts, which intersect with your strategic priorities and highlight emerging directions relevant to your business.";

    // In case the model ignores instructions and adds its own "Hi [Name],"
    introText = introText.replace(/^hi\s*\[[^\]]+\],?\s*/i, "").trim();

    res.json({ intro: introText });
  } catch (err) {
    console.error("Error in /api/member-intro:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ---------- API: member-specific article summaries via OpenAI ----------
//
// NOTE: front-end sends { member, selectedArticles, tone }
// and expects { text: "<combined summaries>" }

// ---------- API: member-specific article summaries via OpenAI ----------

app.post("/api/member-article-summaries", async (req, res) => {
  try {
    // Front-end sends { member, selectedArticles, tone, language }
    const { member, selectedArticles, tone, language } = req.body || {};
    
    console.log(`🌍 /api/member-article-summaries - Language requested: "${language}"`);

    const articles = Array.isArray(selectedArticles) ? selectedArticles : [];

    let memberName =
      (typeof member === "string" && member) ||
      (member &&
        (member.memberName || member.commonName1 || member.commonName2)) ||
      "";

    if (!articles.length) {
      return res
        .status(400)
        .json({ error: "At least one article is required" });
    }

    // Optional member context
    let memberContext = "";
    if (memberName) {
      try {
        const members = await loadMembers();
        const memberRecord = members.find(
          (m) =>
            m.memberName === memberName ||
            m.commonName1 === memberName ||
            m.commonName2 === memberName
        );
        const phrases = memberRecord?.phrases || [];
        memberContext = phrases.length
          ? `Key focus areas / phrases for ${memberName}: ${phrases.join(
              ", "
            )}.`
          : `${memberName} is a large ILP member with broad interest in innovation-relevant MIT work.`;
      } catch (e) {
        console.error(
          "loadMembers error in /api/member-article-summaries:",
          e
        );
      }
    }

    const rewritten = [];

    for (const a of articles) {
      const src = a.source || a.Source || "MIT News";

      const articleBlock = `
Title: ${a.title}
Source: ${src} [${a.kind ? a.kind.toUpperCase() : 'UNKNOWN'}]
Date: ${a.date}
MIT Unit: ${a.mitUnit}
ILP Summary: ${a.ilpSummary || a.summary}
ILP Keywords: ${Array.isArray(a.ilpKeywords) ? a.ilpKeywords.join(", ") : a.ilpKeywords || ""}
General Keywords: ${a.keywords}
Industries: ${a.industries}
Tech Themes: ${a.techThemes}
`;

      const prompt = `
${languageInstruction(language)}

You are helping a program director at MIT Corporate Relations tailor MIT News blurbs for a specific ILP member.

Member: ${memberName || "this company"}
${memberContext}
${toneInstruction(tone)}

Rewrite the following article description into a short, 1–3 sentence paragraph tailored specifically to ${
        memberName || "this company"
      }.

Guidelines:
- REMEMBER: Write in the language specified at the top of this prompt.
- Make clear why ${memberName || "this company"} in particular would care about this work at MIT.
- Refer to ${memberName || "the company"} by name at least once if a name is provided.
- Match the tone described above.
- Do NOT mention "ILP member companies" or ILP in general.
- Do NOT include a greeting or sign-off.

Article details:
${articleBlock}
`;

      const systemPrompt = language === "chinese"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach emails. You MUST write ONLY in CHINESE (Simplified Chinese). NO ENGLISH WORDS ALLOWED. 您必须仅用中文书写。不允许使用英文。"
        : language === "german"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach emails. You MUST write ONLY in GERMAN. NO ENGLISH WORDS ALLOWED. Sie müssen nur auf Deutsch schreiben. Englisch ist verboten."
        : language === "italian"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach emails. You MUST write ONLY in ITALIAN. NO ENGLISH WORDS ALLOWED. Devi scrivere solo in italiano. L'inglese non è consentito."
        : language === "french"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach emails. You MUST write ONLY in FRENCH. NO ENGLISH WORDS ALLOWED. Vous devez écrire en français uniquement."
        : language === "japanese"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach emails. You MUST write ONLY in JAPANESE. NO ENGLISH WORDS ALLOWED. 日本語のみで書いてください。英語は禁止です。"
        : language === "korean"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach emails. You MUST write ONLY in KOREAN. NO ENGLISH WORDS ALLOWED. 한국어로만 작성해야 합니다. 영어는 금지됩니다."
        : language === "hindi"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach emails. You MUST write ONLY in HINDI. NO ENGLISH WORDS ALLOWED. हिन्दी में ही लिखें। अंग्रेज़ी की अनुमति नहीं है।"
        : "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach emails. You ALWAYS write in the language specified by the user.";

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          { role: "user", content: prompt },
        ],
      });

      const text =
        completion.choices?.[0]?.message?.content?.trim() || a.summary || "";

      rewritten.push(text);
    }

    // IMPORTANT: front-end expects { text: "<combined>" }
    const combined = rewritten.join("\n\n");
    res.json({ text: combined });
  } catch (err) {
    console.error("Error in /api/member-article-summaries:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ---------- API: template-based text generation ----------

app.post("/api/generate-template-text", async (req, res) => {
  try {
    const { personId, templateId, member, selectedArticles, tone, language, myVoice } = req.body || {};
    
    console.log(`\n========================================`);
    console.log(`📝 /api/generate-template-text CALLED`);
    console.log(`   Person: "${personId}"`);
    console.log(`   Template: "${templateId}"`);
    console.log(`   Language: "${language}"`);
    console.log(`   Tone: "${tone}"`);
    console.log(`========================================\n`);

    const articles = Array.isArray(selectedArticles) ? selectedArticles : [];

    if (!articles.length) {
      return res.status(400).json({ error: "At least one article is required" });
    }

    // Derive memberName and point of contact
    let memberName =
      (typeof member === "string" && member) ||
      (member && (member.memberName || member.commonName1 || member.commonName2)) ||
      "";

    let pointOfContact = 
      (member && member.pointOfContact) || 
      memberName ||
      "[Name]";

    // Load member context if personId is provided
    let memberContext = "";
    if (memberName && personId) {
      try {
        const members = await loadMembers(personId);
        const memberRecord = members.find(
          (m) =>
            m.memberName === memberName ||
            m.commonName1 === memberName ||
            m.commonName2 === memberName
        );

        const phrases = memberRecord?.phrases || [];
        memberContext = phrases.length
          ? `Key focus areas / phrases for ${memberName}: ${phrases.join(", ")}.`
          : `${memberName} is a large ILP member with broad interest in innovation-relevant MIT work.`;
      } catch (e) {
        console.error("loadMembers error in /api/generate-template-text:", e);
      }
    }

    // Generate knowledge list (summaries for each article)
    const rewritten = [];
    for (const a of articles) {
      const src = a.source || a.Source || "MIT News";

      const articleBlock = `
Title: ${a.title}
Source: ${src} [${a.kind ? a.kind.toUpperCase() : 'UNKNOWN'}]
Date: ${a.date}
MIT Unit: ${a.mitUnit}
ILP Summary: ${a.ilpSummary || a.summary}
ILP Keywords: ${Array.isArray(a.ilpKeywords) ? a.ilpKeywords.join(", ") : a.ilpKeywords || ""}
General Keywords: ${a.keywords}
Industries: ${a.industries}
Tech Themes: ${a.techThemes}
`;

      const prompt = `
${languageInstruction(language)}

You are helping a program director at MIT Corporate Relations tailor MIT content for a specific ILP member.

Member: ${memberName || "this company"}
${memberContext}
${toneInstruction(tone, myVoice)}

Rewrite the following content into a short, 1–3 sentence paragraph tailored specifically to ${memberName || "this company"}.

Guidelines:
- REMEMBER: Write in the language specified at the top of this prompt.
- Make clear why ${memberName || "this company"} in particular would care about this work at MIT.
- Refer to ${memberName || "the company"} by name at least once if a name is provided.
- Match the tone described above.
- Do NOT mention "ILP member companies" or ILP in general.
- Do NOT include a greeting or sign-off.

Article details:
${articleBlock}
`;

      const systemPrompt = language === "chinese"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach. You MUST write ONLY in CHINESE (Simplified Chinese). NO ENGLISH WORDS ALLOWED. 您必须仅用中文书写。不允许使用英文。"
        : language === "german"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach. You MUST write ONLY in GERMAN. NO ENGLISH WORDS ALLOWED. Sie müssen nur auf Deutsch schreiben. Englisch ist verboten."
        : language === "italian"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach. You MUST write ONLY in ITALIAN. NO ENGLISH WORDS ALLOWED. Devi scrivere solo in italiano. L'inglese non è consentito."
        : language === "french"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach. You MUST write ONLY in FRENCH. NO ENGLISH WORDS ALLOWED. Vous devez écrire en français uniquement."
        : language === "japanese"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach. You MUST write ONLY in JAPANESE. NO ENGLISH WORDS ALLOWED. 日本語のみで書いてください。英語は禁止です。"
        : language === "korean"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach. You MUST write ONLY in KOREAN. NO ENGLISH WORDS ALLOWED. 한국어로만 작성해야 합니다. 영어는 금지됩니다."
        : language === "hindi"
        ? "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach. You MUST write ONLY in HINDI. NO ENGLISH WORDS ALLOWED. हिन्दी में ही लिखें। अंग्रेज़ी की अनुमति नहीं है।"
        : "You are a helpful assistant that writes concise, member-specific blurbs for MIT ILP outreach. You ALWAYS write in the language specified by the user.";

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          { role: "user", content: prompt },
        ],
      });

      const text =
        completion.choices?.[0]?.message?.content?.trim() || a.summary || "";

      rewritten.push(text);
    }

    // Generate knowledge list
    const knowledgeList = rewritten.join("\n\n");

    // Load template if provided
    let finalText = knowledgeList;
    if (personId && templateId) {
      try {
        const templatePath = path.join(__dirname, "people", personId, "templates", `${templateId}.txt`);
        const templateContent = await fs.readFile(templatePath, "utf8");
        
        // Replace template variables
        finalText = templateContent
          .replace(/\{\{Point-of-Contact\}\}/g, pointOfContact)
          .replace(/\{\{knowledge-list\}\}/g, knowledgeList);
        
        console.log(`✅ Applied template ${templateId}`);
      } catch (err) {
        console.warn(`⚠️ Could not load template, using knowledge list only:`, err.message);
        finalText = knowledgeList;
      }
    }

    res.json({ text: finalText });
  } catch (err) {
    console.error("Error in /api/generate-template-text:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ---------- Start server ----------

// Test endpoint for language translation
app.post("/api/test-language", async (req, res) => {
  try {
    const { language } = req.body || {};
    console.log(`\n🧪 TEST ENDPOINT - Language: "${language}"`);
    
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
      english: "English"
    };
    
    const targetLang = languageMap[language] || "English";
    
    const prompt = `You MUST respond ONLY in ${targetLang}. Write a simple sentence about MIT research in ${targetLang}. DO NOT use English.`;
    
    console.log(`🧪 Sending to OpenAI:`, prompt);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `You are a translator. You ALWAYS respond in ${targetLang}, never in English.`
        },
        { role: "user", content: prompt }
      ],
    });
    
    const response = completion.choices?.[0]?.message?.content?.trim() || "";
    console.log(`🧪 OpenAI Response:`, response);
    
    res.json({ 
      language: language,
      targetLang: targetLang,
      response: response,
      success: true 
    });
  } catch (err) {
    console.error("Error in test endpoint:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📂 Serving static files from: ${publicDir}`);
  console.log(`📋 Looking for member CSV at: ${membersCsvPath}`);
});