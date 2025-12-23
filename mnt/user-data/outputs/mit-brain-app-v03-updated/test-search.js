// test-search.js
// Test the JSONL search functionality

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    
    console.log(`✅ Loaded ${articles.length} articles from JSONL\n`);
    return articles;
  } catch (err) {
    console.error("❌ Error loading mit_brain_test01.jsonl:", err.message);
    articles = [];
    return articles;
  }
}

function searchArticlesByPhrase(phrase, options = {}) {
  const minScore = options.minScore || 0;
  const phraseLower = phrase.toLowerCase();
  
  console.log(`🔍 Searching ${articles.length} articles for: "${phrase}" (minScore: ${minScore})`);
  
  const matches = articles
    .map((article) => {
      let score = 0;
      let matchedIn = [];
      
      // Search in ilpSummary
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
      
      // Also search in title as fallback
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
  
  console.log(`   Found ${matches.length} matching articles\n`);
  return matches;
}

async function runTests() {
  await loadArticles();
  
  if (articles.length === 0) {
    console.error("❌ No articles loaded. Cannot run tests.");
    return;
  }
  
  console.log("=" .repeat(80));
  console.log("TEST 1: Search for 'quantum'");
  console.log("=" .repeat(80));
  let results = searchArticlesByPhrase("quantum");
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title}`);
    console.log(`   Score: ${r.score.toFixed(2)} | Matched in: ${r.matchedIn}`);
    console.log(`   URL: ${r.url}\n`);
  });
  
  console.log("=" .repeat(80));
  console.log("TEST 2: Search for 'data centers'");
  console.log("=" .repeat(80));
  results = searchArticlesByPhrase("data centers");
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title}`);
    console.log(`   Score: ${r.score.toFixed(2)} | Matched in: ${r.matchedIn}`);
    console.log(`   URL: ${r.url}\n`);
  });
  
  console.log("=" .repeat(80));
  console.log("TEST 3: Search for 'AI' with minScore 0.8");
  console.log("=" .repeat(80));
  results = searchArticlesByPhrase("AI", { minScore: 0.8 });
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title}`);
    console.log(`   Score: ${r.score.toFixed(2)} | Matched in: ${r.matchedIn}`);
    console.log(`   URL: ${r.url}\n`);
  });
  
  console.log("=" .repeat(80));
  console.log("TEST 4: Search for 'robotics'");
  console.log("=" .repeat(80));
  results = searchArticlesByPhrase("robotics");
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title}`);
    console.log(`   Score: ${r.score.toFixed(2)} | Matched in: ${r.matchedIn}`);
    console.log(`   URL: ${r.url}\n`);
  });
  
  console.log("✅ All tests completed!");
}

runTests();
