#!/usr/bin/env node
/**
 * fillMissingPaperSummaries.mjs  (ESM version)
 *
 * ✔ ALL JSONL/CSV reading & writing routes through MITBrainSchema
 * ✔ ESM-only (no require)
 * ✔ Uses Crossref + Semantic Scholar + PubMed as metadata fallbacks
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import { load as cheerioLoad } from "cheerio";
import OpenAI from "openai";

// ⭐ adjust this import if MITBrainSchema exports differently
import * as MITBrainSchema from "../shared/MITBrainSchema.js";

// Resolve __dirname in ESM
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- CONFIG ----------
const MAX_TEXT_CHARS = 20000;
const MIN_TEXT_FOR_FULLTEXT = 500;
const OPENAI_DELAY_MS = 250;
const LOG_DIR = path.join(__dirname, "../output/logs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY missing");
  process.exit(1);
}

// ---------- LOGGING ----------
let logStream = null;
function initLog() {
  const id = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, `fillMissingPaperSummaries__${id}.log`);
  logStream = fs.createWriteStream(file, { flags: "a" });
  console.log(`📌 Log file: ${file}`);
  return id;
}

function log(msg) {
  console.log(msg);
  if (logStream) logStream.write(`[${new Date().toISOString()}] ${msg}\n`);
}

// ---------- HTTP FETCH ----------
async function fetchBinary(url) {
  log(`  Fetching: ${url}`);
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: (s) => s < 400,
    });
    return {
      data: res.data,
      contentType: (res.headers["content-type"] || "").toLowerCase(),
    };
  } catch (err) {
    log(`  ⚠️ fetch failed: ${err.message}`);
    return null;
  }
}

// ---------- TEXT EXTRACTION ----------
async function extractTextFromRecord(record) {
  const url = record.pdfUrl || record.url;
  if (!url) return "";

  const res = await fetchBinary(url);
  if (!res) return "";

  const isPdf = res.contentType.includes("pdf") || /\.pdf($|\?)/i.test(url);

  if (isPdf) {
    try {
      // Safe dynamic import for ESM + weird pdf-parse exports
      const pdfLib = await import("pdf-parse");
      const pdfParse =
        typeof pdfLib.default === "function"
          ? pdfLib.default
          : typeof pdfLib === "function"
            ? pdfLib
            : pdfLib?.PDFParse;

      if (pdfParse) {
        const data = await pdfParse(res.data);
        return (data.text || "").replace(/\s+/g, " ").trim();
      }
      log("  ⚠️ pdf-parse module has no callable export");
    } catch (err) {
      log(`  ⚠️ pdf-parse failed: ${err.message}`);
    }
    return "";
  }

  // Otherwise HTML → use cheerio
  try {
    const html = res.data.toString("utf8");
    const $ = cheerioLoad(html);

    let text =
      $("article").text() ||
      $("#main").text() ||
      $("body").text() ||
      $("p").text();

    return text.replace(/\s+/g, " ").trim();
  } catch (err) {
    log(`  ⚠️ HTML parse failed: ${err.message}`);
    return "";
  }
}

// ---------- METADATA FALLBACK API HELPERS ----------
function extractDoi(url) {
  const m = url && url.match(/doi\.org\/(.+?)(?:$|[?#])/i);
  return m ? decodeURIComponent(m[1]) : null;
}

async function fetchCrossref(record) {
  const doi = extractDoi(record.url || record.pdfUrl);
  try {
    if (doi) {
      const r = await axios.get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
      const item = r.data?.message;
      return { title: item?.title?.[0], abstract: item?.abstract };
    }
  } catch (err) {
    log(`  ⚠️ Crossref failed: ${err.message}`);
  }
  return null;
}

async function fetchSemanticScholar(record) {
  const doi = extractDoi(record.url || record.pdfUrl);
  const title = record.title || "";
  try {
    if (doi) {
      const r = await axios.get(
        `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}`,
        { params: { fields: "title,abstract" } }
      );
      return { title: r.data?.title, abstract: r.data?.abstract };
    }
    if (title) {
      const r = await axios.get(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        {
          params: { query: title, limit: 1, fields: "title,abstract" },
        }
      );
      const p = r.data?.data?.[0];
      return { title: p?.title, abstract: p?.abstract };
    }
  } catch (err) {
    log(`  ⚠️ Semantic Scholar failed: ${err.message}`);
  }
  return null;
}

async function fetchPubMed(record) {
  const title = record.title || "";
  if (!title) return null;

  try {
    const s = await axios.get(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
      { params: { db: "pubmed", retmode: "json", term: title, retmax: 1 } }
    );
    const pmid = s.data?.esearchresult?.idlist?.[0];
    if (!pmid) return null;

    const efetch = await axios.get(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
      { params: { db: "pubmed", id: pmid, retmode: "xml" } }
    );

    const xml = efetch.data;
    const m = xml.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/i);
    return {
      title,
      abstract: m ? m[1].replace(/<[^>]+>/g, "").trim() : null,
    };
  } catch (err) {
    log(`  ⚠️ PubMed failed: ${err.message}`);
    return null;
  }
}

// ---------- OPENAI SUMMARIZATION ----------
async function summarize(record, text, metadata) {
  const title = record.title || metadata?.title || "this research";

  const usable =
    (text && text.slice(0, MAX_TEXT_CHARS)) ||
    (metadata?.abstract && metadata.abstract.slice(0, MAX_TEXT_CHARS)) ||
    `Title: ${title}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "You summarize academic papers for busy MIT ILP executives. Write 2–3 clear factual sentences. Avoid phrases like 'This paper' or hypey language. Just explain what the work does and why it matters."
      },
      {
        role: "user",
        content: `Title: ${title}\n\nSummarize the key contribution and context in 2–3 sentences:\n\n${usable}`
      }
    ],
    temperature: 0.2,
    max_tokens: 180,
  });

  return completion.choices[0].message.content.trim();
}

// ---------- MAIN ----------
async function main() {
  const runId = initLog();
  log(`Run ID: ${runId}`);

  const jsonlPath = process.argv[2];
  const csvPath = process.argv[3];

  if (!jsonlPath || !csvPath) {
    console.error("Usage: node fillMissingPaperSummaries.mjs <jsonlPath> <csvPath>");
    process.exit(1);
  }

  // ⭐ ALL I/O via MITBrainSchema
  const { jsonlRecords, csvRows } = await MITBrainSchema.loadMitBrain(
    jsonlPath,
    csvPath
  );

  log(`Loaded ${jsonlRecords.length} JSONL records`);
  log(`Loaded ${csvRows.length} CSV rows`);

  const csvByUrl = new Map(csvRows.map((r) => [r.url, r]));

  const missing = jsonlRecords.filter(
    (r) =>
      (!r.summary || !r.summary.trim()) &&
      (r.url || r.pdfUrl)
  );

  log(`Found ${missing.length} records missing summaries and having url/pdfUrl\n`);

  let idx = 0;
  for (const rec of missing) {
    idx++;
    log(`[${idx}/${missing.length}] ${rec.title || "(no title)"}\n  URL: ${rec.pdfUrl || rec.url}`);

    let text = await extractTextFromRecord(rec);

    let metadata = null;
    if (!text || text.length < MIN_TEXT_FOR_FULLTEXT) {
      metadata =
        (await fetchCrossref(rec)) ||
        (await fetchSemanticScholar(rec)) ||
        (await fetchPubMed(rec));
    }

    if (!text && !metadata?.abstract) {
      log("  ⚠️ No extractable text or metadata; leaving summary empty.");
      continue;
    }

    try {
      const summary = await summarize(rec, text, metadata);
      rec.summary = summary;

      const row = csvByUrl.get(rec.url);
      if (row) {
        row.summary = summary;
      }

      log("  ✅ Summary filled.");
    } catch (err) {
      log(`  ⚠️ OpenAI summarization failed: ${err.message}`);
    }

    // small delay to be nice to APIs
    if (OPENAI_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, OPENAI_DELAY_MS));
    }
  }

  // ⭐ Save ONLY through MITBrainSchema
  await MITBrainSchema.saveMitBrain(jsonlPath, csvPath, jsonlRecords, csvRows);

  log("✅ Done updating summaries.");
  logStream?.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  if (logStream) {
    logStream.write(`FATAL: ${err.stack || err.message}\n`);
    logStream.end();
  }
  process.exit(1);
});
