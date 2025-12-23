#!/usr/bin/env node

// enrichIlpFields.js
//
// Enrich MIT Brain records with ILP-focused fields:
//   - ilpSummary  : short executive-facing summary for ILP members
//   - ilpKeywords : compact keyword string for tagging/search
//
// All reading/writing of JSONL + shadow CSV goes through MITBrainSchema.
// This script assumes an ESM project ("type": "module" in package.json).

import "dotenv/config";
import OpenAI from "openai";
import { MITBrainSchema } from "../shared/MITBrainSchema.cjs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OPENAI_MODEL = process.env.ILP_ENRICH_MODEL || "gpt-4o-mini";

// If true, regenerate ILP fields even if they already exist
const FORCE_REGENERATE_ILP = process.env.FORCE_REGENERATE_ILP === "true";

// If you want to limit how many records to process in a single run,
// set ILP_MAX_RECORDS (e.g., 200). 0 or undefined means "no limit".
const MAX_RECORDS = process.env.ILP_MAX_RECORDS
  ? parseInt(process.env.ILP_MAX_RECORDS, 10)
  : 0;

// ---------------------------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------------------------

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------------------------------------------------------------------------
// Project validation patterns
// ---------------------------------------------------------------------------

const PROJECT_PATTERNS = [
  /Project NANDA/i,
  /MIT\.nano/i,
  /The Engine/i,
  /J-WAFS/i,
  /Quest for Intelligence/i,
  /MIT Schwarzman College of Computing/i,
  /CSAIL/i,
  /Media Lab/i,
  /Lincoln Laboratory/i,
  /Koch Institute/i,
  /Broad Institute/i,
  /McGovern Institute/i,
  /MIT Energy Initiative/i,
  /MITEI/i,
];

// ---------------------------------------------------------------------------
// Validate and auto-fix project extraction
// ---------------------------------------------------------------------------

function validateProjectExtraction(record, enriched) {
  const textToCheck = `${record.summary || ''} ${record.fullText || ''}`;
  let autoFixed = false;
  
  for (const pattern of PROJECT_PATTERNS) {
    const match = textToCheck.match(pattern);
    if (match) {
      const projectName = match[0];
      // Check if it's in keywords (case-insensitive)
      if (!enriched.ilpKeywords.toLowerCase().includes(projectName.toLowerCase())) {
        console.log(`      🔧 Auto-adding "${projectName}" to keywords`);
        enriched.ilpKeywords += ` | ${projectName}`;
        autoFixed = true;
      }
    }
  }
  
  if (autoFixed) {
    console.log(`      ✓ Project extraction validated and fixed`);
  }
  
  return enriched;
}

// ---------------------------------------------------------------------------
// ILP enrichment for a single record (uses Chat Completions API)
// ---------------------------------------------------------------------------

async function generateIlpFields(record) {
  const systemPrompt = `
You are generating content for MIT's Industrial Liaison Program (ILP), which helps large companies engage with MIT research, labs, and startups.

Your audience is:
- Executives and senior technical leaders at large companies (typically >$1B in revenue).
- They are busy, smart, and interested in leveraging MIT research, talent, technology, and startups.

Use ALL available record fields (kind, sourceType, title, summary, fullText, tags,
authors, mitAuthors, mitGroups, labs, research areas, etc.) to:

1) Write a concise, executive-facing ILP summary (2–4 sentences) that:
   - Quickly highlights the core idea, contribution, or capability.
   - Avoids academic jargon where possible, or briefly explains it.
   - Does NOT repeat the title verbatim.
   - Does NOT talk about "this article" or "this story"; instead focus on the underlying capability, research, or technology (e.g., "This work shows...", "This research enables...") rather than specifying that it is an "article", "news story", "video", or "startup").
   - **Identifies and prominently mentions any named MIT projects, initiatives, platforms, or programs** (e.g., "Project NANDA", "MIT.nano", "Quest for Intelligence", "J-WAFS", "The Engine", "MIT Schwarzman College of Computing").
   - Emphasizes why it matters to ILP member companies (value, risk, commercialization potential, or strategic relevance). These are companies that usually have over one billion dollars in annual revenue.
   - Uses a clear, business-oriented tone — not academic, journalistic, or promotional.

2) Produce a compact keyword string (5–12 items) optimized for ILP tagging and search. Focus on:
   - MIT people, labs, or groups mentioned.
   - **Named MIT projects, initiatives, frameworks, platforms, or programs** (e.g., "Project NANDA", "MIT.nano", "The Engine", "J-WAFS", "Quest for Intelligence").
   - Core technical topics or research domains.
   - Industries or application sectors.
   - Capabilities (e.g., robotics, AI agents, microelectronics, secure computation, data centers).

Rules:
- Be factual and grounded ONLY in fields actually present in the record.
- DO NOT invent MIT names, labs, affiliations, or project names.
- **If MIT projects or initiatives are mentioned in the summary or fullText, they MUST appear in both ilpSummary and ilpKeywords.**
- If no MIT people/groups are known, focus on technical topics and industries.
- Keywords should be separated by " | " (space-pipe-space).

Examples of good project/initiative extraction:
- If summary mentions "Project NANDA", include "Project NANDA" in ilpKeywords
- If summary mentions "MIT.nano fabrication", include "MIT.nano" in ilpKeywords  
- If summary mentions "Quest for Intelligence initiative", include "Quest for Intelligence" in ilpKeywords
- If summary mentions "J-WAFS water research", include "J-WAFS" in ilpKeywords

Return STRICT JSON with this structure (do NOT wrap it in backticks or code fences):
{
  "ilpSummary": "<2-4 sentences in an executive tone>",
  "ilpKeywords": "keyword1 | keyword2 | keyword3"
}
`.trim();

  const userPayload = {
    kind: record.kind || null,
    source: record.source || null,
    sourceType: record.sourceType || null,
    title: record.title || null,
    url: record.url || null,
    publishedAt: record.publishedAt || null,
    authors: record.authors || [],
    mitAuthors: record.mitAuthors || [],
    mitGroups: record.mitGroups || [],
    tags: record.tags || [],
    industries: record.industries || [],
    labs: record.mitLabs || [],
    summary: record.summary || null,
    fullText: record.fullText || null,
  };

  const userPrompt = `
Here is a MIT Brain record to enrich for ILP:

${JSON.stringify(userPayload, null, 2)}

Generate "ilpSummary" and "ilpKeywords" as described in the instructions.
`.trim();

  // ✅ Use the Chat Completions API with lower temperature for consistency
  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.1, // Lower for more deterministic output
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  let rawText = completion.choices[0]?.message?.content || "";
  rawText = rawText.trim();

  // Strip ```json fences if the model adds them
  if (rawText.startsWith("```")) {
    rawText = rawText.replace(/^```json/i, "");
    rawText = rawText.replace(/^```/, "");
    rawText = rawText.replace(/```$/, "");
    rawText = rawText.trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    console.error("❌ Failed to parse JSON. Raw model text:\n", rawText);
    throw new Error("Failed to parse OpenAI JSON: " + err.message);
  }

  let ilpSummary = (parsed.ilpSummary || "").trim();
  let ilpKeywords = (parsed.ilpKeywords || "").trim();

  if (!ilpSummary || !ilpKeywords) {
    throw new Error(
      "OpenAI ILP enrichment did not return non-empty ilpSummary/ilpKeywords"
    );
  }

  // Validate and auto-fix project extraction
  const enriched = { ilpSummary, ilpKeywords };
  const validated = validateProjectExtraction(record, enriched);

  return validated;
}

// ---------------------------------------------------------------------------
// Main: iterate over records and enrich
// ---------------------------------------------------------------------------

async function main() {
  console.log("===============================================");
  console.log("MIT Brain – ILP Enrichment (ilpSummary / ilpKeywords)");
  console.log("===============================================");
  console.log(`Model               : ${OPENAI_MODEL}`);
  console.log(`Temperature         : 0.1`);
  console.log(`FORCE_REGENERATE_ILP: ${FORCE_REGENERATE_ILP}`);
  console.log(`ILP_MAX_RECORDS     : ${MAX_RECORDS || "no limit"}`);
  console.log(`Project Validation  : Enabled (${PROJECT_PATTERNS.length} patterns)`);
  console.log("");

  // MITBrainSchema needs to load existing records explicitly
  const schema = new MITBrainSchema();
  
  // CRITICAL FIX: Load existing records from JSONL
  schema._loadExistingRecords();
  
  // Get all existing records from the map
  const records = Array.from(schema._existingRecordsByUrl.values());

  console.log(`Loaded ${records.length} records from JSONL.\n`);

  if (records.length === 0) {
    console.log("No records found. Make sure you've run the scrapers first.");
    console.log("Expected JSONL file at: output/jsonl/mit_brain.jsonl");
    return;
  }

  let processedCount = 0;
  let enrichedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let projectsFound = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    const hasIlpSummary =
      typeof record.ilpSummary === "string" &&
      record.ilpSummary.trim().length > 0;

    const hasIlpKeywords =
      (typeof record.ilpKeywords === "string" &&
        record.ilpKeywords.trim().length > 0) ||
      (Array.isArray(record.ilpKeywords) &&
        record.ilpKeywords.length > 0);

    const alreadyHasIlp = hasIlpSummary && hasIlpKeywords;

    if (alreadyHasIlp && !FORCE_REGENERATE_ILP) {
      skippedCount++;
      if (skippedCount <= 5) {
        console.log(
          `Skipping ${i + 1}/${records.length} (already enriched): ${
            record.title || record.url || "(no title)"
          }`
        );
      }
      continue;
    }

    console.log(
      `Enriching ${i + 1}/${records.length}: ${
        record.title?.slice(0, 70) || record.url || "(no title)"
      }...`
    );

    try {
      const { ilpSummary, ilpKeywords } = await generateIlpFields(record);
      
      // Check if any known projects were identified
      const textToCheck = `${ilpSummary} ${ilpKeywords}`;
      let hasProject = false;
      for (const pattern of PROJECT_PATTERNS) {
        if (pattern.test(textToCheck)) {
          hasProject = true;
          break;
        }
      }
      
      if (hasProject) {
        projectsFound++;
        console.log(`      🎯 Contains MIT project/initiative`);
      }
      
      // Update the record in place (it's in the _existingRecordsByUrl map)
      record.ilpSummary = ilpSummary;
      record.ilpKeywords = ilpKeywords;
      
      // Mark this URL as updated so flush() saves it
      schema._updatedRecords.add(record.url);
      
      enrichedCount++;
    } catch (err) {
      errorCount++;
      console.error(
        `❌ Error enriching record ${i + 1} (${
          record.title || "no title"
        }): ${err.message || err}`
      );
      // keep going
    }

    processedCount++;

    if (MAX_RECORDS > 0 && processedCount >= MAX_RECORDS) {
      console.log(
        `\nReached ILP_MAX_RECORDS=${MAX_RECORDS}; stopping further enrichment.`
      );
      break;
    }
  }

  console.log("\n===============================================");
  console.log("Enrichment Complete");
  console.log("===============================================");
  console.log(`  Total processed    : ${processedCount}`);
  console.log(`  Successfully enriched: ${enrichedCount}`);
  console.log(`  Already had ILP    : ${skippedCount}`);
  console.log(`  Errors             : ${errorCount}`);
  console.log(`  Projects identified: ${projectsFound}`);
  console.log("");

  console.log("💾 Flushing updated records via MITBrainSchema...");
  schema.flush();
  if (typeof schema.printStats === "function") {
    schema.printStats();
  }
  console.log("✅ Done.");
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("Fatal error in ILP enrichment script:", err);
  process.exit(1);
});