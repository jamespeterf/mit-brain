#!/usr/bin/env node

// enrichers/fillMissingPaperSummaries.mjs
//
// Fills missing summaries for papers by:
//   - Loading records via MITBrainSchema
//   - Finding paper records with empty summary
//   - Fetching text from pdfUrl or url
//   - Summarizing via OpenAI (3-5 sentences)
//   - Writing updated values BACK through MITBrainSchema
//   - Creating a run-specific LOG FILE using the Run ID
//
// Usage:
//   node enrichers/fillMissingPaperSummaries.mjs
//
// Required env:
//   OPENAI_API_KEY

import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import pdfParse from "pdf-parse";
import OpenAI from "openai";
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const {
  MITBrainSchema,
  getRunId,
} = require("../shared/MITBrainSchema.cjs");

// ---------- OpenAI ----------
if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY env var is required.");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------- Run log setup ----------

const runId = getRunId();
const logsDir = path.join(process.cwd(), "output", "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logFile = path.join(logsDir, `fillMissingPaperSummaries__${runId}.log`);

function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + "\n", "utf8");
}

// ---------- Helpers ----------

function needsSummary(rec) {
  if (!rec || rec.kind !== "paper") return false;
  const s = rec.summary || "";
  return s.trim().length === 0 && (rec.pdfUrl || rec.url);
}

async function fetchBinary(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    maxRedirects: 5,
    timeout: 30000,
  });
  return {
    data: Buffer.from(res.data),
    contentType: res.headers["content-type"] || "",
  };
}

async function extractText(rec) {
  const target = rec.pdfUrl || rec.url;
  if (!target) return "";

  log(`  Fetching: ${target}`);

  try {
    const { data, contentType } = await fetchBinary(target);

    if (contentType.toLowerCase().includes("pdf")) {
      const pdfData = await pdfParse(data);
      return (pdfData.text || "").replace(/\s+/g, " ").trim();
    }

    const html = data.toString("utf8");
    const $ = cheerio.load(html);

    let text = "";
    if ($("article").length) {
      text = $("article").text();
    } else if ($("#main").length) {
      text = $("#main").text();
    } else {
      text = $("p").text();
    }

    return text.replace(/\s+/g, " ").trim();
  } catch (err) {
    log(`  ⚠️ Failed fetching or parsing ${target}: ${err.message}`);
    return "";
  }
}

async function summarize(text, rec) {
  const MAX = 8000;
  const snippet = text.slice(0, MAX);
  if (!snippet) return "";

  const title = rec.title || "(untitled)";

  const sys =
    "You generate factual academic summaries based ONLY on provided text.";

  const user = `
Paper title: "${title}"

Write a concise 3–5 sentence abstract-style summary. 
Focus on:
• research question
• high-level methods
• key findings
• significance

Do NOT invent details beyond the text. Avoid hype. Use third person.

Extracted text:
${snippet}
  `.trim();

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });

  return (response.choices?.[0]?.message?.content || "").trim();
}

// ---------- Main ----------

async function main() {
  log("===============================================");
  log("Filling missing paper summaries using OpenAI");
  log("===============================================");
  log(`Run ID: ${runId}`);
  log(`Log file: ${logFile}`);
  log("");

  const schema = new MITBrainSchema();
  const all = schema.records || [];
  const targets = all.filter(needsSummary);

  log(`Loaded ${all.length} records via MITBrainSchema.`);
  log(`${targets.length} papers missing summary AND have a url/pdfUrl.`);
  log("");

  let count = 0;

  for (const rec of targets) {
    count += 1;
    log(`[${count}/${targets.length}] ${rec.title || "(untitled)"}`);

    const text = await extractText(rec);
    if (!text) {
      log("  ⚠️ No extractable text.");
      continue;
    }

    try {
      const sum = await summarize(text, rec);
      if (!sum) {
        log("  ⚠️ OpenAI returned empty summary.");
        continue;
      }

      rec.summary = sum;
      if (!rec.fullText || !rec.fullText.trim()) {
        rec.fullText = text.slice(0, 20000);
      }
      rec.summarySource = "url-fallback-openai";

      log("  ✅ Summary updated.");
    } catch (err) {
      log(`  ⚠️ OpenAI failure: ${err.message}`);
    }
  }

  log("");
  log("Flushing updates via MITBrainSchema...");
  schema.flush();
  schema.printStats();

  log("\nDone.\n");
}

main().catch((err) => {
  log("FATAL ERROR: " + err.message);
  process.exit(1);
});
