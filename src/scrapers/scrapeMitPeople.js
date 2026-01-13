#!/usr/bin/env node

/**
 * scrapeMitPeople.js
 * 
 * Scrape MIT people profiles from an XLSX spreadsheet and write them into 
 * the MIT Brain JSONL/CSV files via MITBrainSchema.
 * 
 * Features:
 * - AI-powered URL lookup (MIT.edu → Wikipedia → LinkedIn)
 * - AI-generated fullText from profile data
 * - Keywords extraction from Interests/Expertise
 * 
 * ALL reads/writes to the MIT Brain go through MITBrainSchema.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import XLSX from "xlsx";
import OpenAI from "openai";
import dotenv from "dotenv";

const require = createRequire(import.meta.url);
const {
  MITBrainSchema,
  fixText,
  normalizeDate,
  getRunId,
} = require("../shared/MITBrainSchema.cjs");

// Load environment variables
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../..", ".env") });

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -----------------------------------------------------------------------------
// Paths / config
// -----------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default XLSX path (override with --xlsx path/to/file.xlsx)
const DEFAULT_PEOPLE_XLSX = path.resolve(
  __dirname,
  "../../input/mitPeople.xlsx"  // Note: lowercase 'm' to match uploaded file
);

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

function getFirst(row, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const val = row[key];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        return String(val).trim();
      }
    }
  }
  return "";
}

/**
 * Convert "Interests Expertise" field to tags array
 * Handles Excel's \r\r\n line breaks and common delimiters
 * Example: "Complex Cognition\r\r\nNeural Prosthetics\r\r\nDeep Brain Stimulation"
 *       → ["Complex Cognition", "Neural Prosthetics", "Deep Brain Stimulation"]
 */
function parseTags(interestsStr) {
  if (!interestsStr) return [];
  
  // Split by Excel line breaks (\r\r\n, \r\n, \n) and common delimiters (comma, semicolon, pipe)
  const tags = interestsStr
    .split(/[\r\n]+|[,;|]/)
    .map(k => k.trim())
    .filter(k => k.length > 0);
  
  return tags;
}

// -----------------------------------------------------------------------------
// AI-powered URL lookup
// -----------------------------------------------------------------------------

/**
 * Use AI to search for the person's profile URL
 * Priority: MIT.edu → Wikipedia → LinkedIn → fallback to mit.edu
 */
async function findProfileUrl(person) {
  const { firstName, lastName, title, mitPeopleCategory } = person;
  
  // If we already have a URL from the spreadsheet, use it
  if (person.primaryUrl && person.primaryUrl.trim()) {
    return person.primaryUrl.trim();
  }
  
  try {
    const prompt = `Find the most likely official profile URL for this MIT person. Return ONLY the URL, nothing else.

Person:
- Name: ${firstName} ${lastName}
- Title: ${title || "N/A"}
- Category: ${mitPeopleCategory || "N/A"}
- Institution: MIT (Massachusetts Institute of Technology)

Search priority:
1. MIT.edu faculty/staff profile (most preferred)
2. MIT research lab page
3. Wikipedia page (if notable)
4. LinkedIn profile (as last resort)

Requirements:
- Must be confident this is the correct person (matching name + MIT affiliation)
- Prefer official MIT pages over external sources
- If no confident match found, return: https://mit.edu

Return only the URL, no explanation.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cheap model for URL lookup
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0.3, // Lower temperature for factual lookup
    });

    const url = response.choices[0]?.message?.content?.trim() || "https://mit.edu";
    
    // Basic validation
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    
    return "https://mit.edu";
    
  } catch (err) {
    console.error(`   ⚠️  URL lookup failed for ${firstName} ${lastName}:`, err.message);
    return "https://mit.edu";
  }
}

/**
 * Use AI to generate a comprehensive fullText from profile data
 */
async function generateFullText(person) {
  const { firstName, lastName, title, summary, tags, mitPeopleCategory, city, state, country } = person;
  
  try {
    const tagsStr = Array.isArray(tags) ? tags.join(", ") : "";
    
    const prompt = `Write a comprehensive 2-3 paragraph professional biography for this MIT person. Use third person. Make it informative and suitable for a corporate relations database.

Person:
- Name: ${firstName} ${lastName}
- Title: ${title || "N/A"}
- Category: ${mitPeopleCategory || "Faculty/Researcher"}
- Location: ${city || ""}${state ? `, ${state}` : ""}${country ? `, ${country}` : ""}
- Research Overview: ${summary || "N/A"}
- Expertise: ${tagsStr || "N/A"}

Write a natural biography that:
1. Introduces their role and expertise
2. Highlights their research focus and contributions
3. Mentions key areas of expertise
4. Keeps a professional, informative tone

Return only the biography text, no labels or formatting.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cheap model for text generation
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.7,
    });

    const fullText = response.choices[0]?.message?.content?.trim() || "";
    
    return fullText || `${firstName} ${lastName} is ${title || "a member"} at MIT${summary ? `. ${summary}` : ""}.`;
    
  } catch (err) {
    console.error(`   ⚠️  Text generation failed for ${firstName} ${lastName}:`, err.message);
    // Fallback to basic text
    return `${firstName} ${lastName} is ${title || "a member"} at MIT${summary ? `. ${summary}` : ""}.`;
  }
}

// -----------------------------------------------------------------------------
// Core scraper
// -----------------------------------------------------------------------------

function loadPeopleRowsFromXlsx(xlsxPath) {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`XLSX file not found: ${xlsxPath}`);
  }

  const workbook = XLSX.readFile(xlsxPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Dynamically find the header row by looking for "First Name" and "Last Name" columns
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  let headerRowIndex = -1;
  
  for (let i = 0; i < Math.min(30, rawData.length); i++) {
    const row = rawData[i];
    // Check if this row contains key header columns
    const hasFirstName = row.some(cell => String(cell).toLowerCase().includes('first name'));
    const hasLastName = row.some(cell => String(cell).toLowerCase().includes('last name'));
    
    if (hasFirstName && hasLastName) {
      headerRowIndex = i;
      console.log(`Found header row at index ${i}`);
      break;
    }
  }
  
  if (headerRowIndex === -1) {
    throw new Error("Could not find header row in Excel file. Expected columns 'First Name' and 'Last Name'.");
  }

  // Now read the data starting from the header row
  const range = XLSX.utils.decode_range(sheet['!ref']);
  range.s.r = headerRowIndex; // Start at the dynamically found header row
  sheet['!ref'] = XLSX.utils.encode_range(range);

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });

  console.log(
    `Loaded ${rows.length} rows from sheet "${sheetName}" (header at row ${headerRowIndex + 1})`
  );
  return rows;
}

async function mapRowToPersonRecord(row, runId, options = {}) {
  const { skipAI = false } = options;
  
  // Extract fields from spreadsheet - using EXACT column names from Excel
  const firstName = getFirst(row, ["First Name"]);
  const lastName = getFirst(row, ["Last Name"]);
  const title = getFirst(row, ["Title"]);
  const city = getFirst(row, ["Mailing City"]);
  const state = getFirst(row, ["Mailing State/Province", "Mailing State"]);
  const country = getFirst(row, ["Mailing Country"]);
  const mobile = getFirst(row, ["Mobile"]);
  const email = getFirst(row, ["Email"]);
  const dlc = getFirst(row, ["Account Name"]); // DLC = Department/Lab/Center
  const mitPeopleCategory = getFirst(row, ["MIT People Category"]);
  const primaryUrl = getFirst(row, ["Primary URL"]);
  const assistant = getFirst(row, ["Primary Assistant"]);
  const officeLocation = getFirst(row, ["Eval Office Location"]);
  const linkedIn = getFirst(row, ["LinkedIn", "Contact Linkedin"]);
  const summary = getFirst(row, ["Research Overview"]);
  const interestsExpertise = getFirst(row, ["Interests Expertise"]);
  const existingFullText = getFirst(row, ["Full Text", "FullText", "fullText"]); // Check if fullText already exists

  // Validation
  if (!firstName || !lastName) {
    return null; // Skip rows without name
  }

  // Parse tags from interests (handles \r\r\n separators from Excel)
  const tags = parseTags(interestsExpertise);

  // Prepare person object for AI calls
  const person = {
    firstName: fixText(firstName),
    lastName: fixText(lastName),
    title: fixText(title),
    city: fixText(city),
    state: fixText(state),
    country: fixText(country),
    summary: fixText(summary),
    mitPeopleCategory: fixText(mitPeopleCategory),
    primaryUrl,
    tags,
  };

  // AI-powered URL lookup (if not disabled)
  let url = primaryUrl || "https://mit.edu";
  if (!skipAI && (!primaryUrl || primaryUrl.trim() === "")) {
    console.log(`   🔍 Looking up URL for ${firstName} ${lastName}...`);
    url = await findProfileUrl(person);
    console.log(`   ✅ Found: ${url}`);
  } else if (primaryUrl && primaryUrl.trim()) {
    url = primaryUrl.trim();
    console.log(`   ✓ Using existing URL: ${url}`);
  }

  // AI-generated fullText (only if not disabled AND no existing fullText)
  let fullText = existingFullText ? fixText(existingFullText) : "";
  
  if (!fullText) {
    // No existing fullText, generate one
    if (!skipAI) {
      console.log(`   ✍️  Generating bio for ${firstName} ${lastName}...`);
      fullText = await generateFullText(person);
    } else {
      // Simple fallback
      fullText = `${firstName} ${lastName} is ${title || "a member"} at MIT${summary ? `. ${summary}` : ""}.`;
    }
  } else {
    console.log(`   ✓ Using existing fullText`);
  }

  // If no summary from Excel, extract first sentence from fullText as summary
  let finalSummary = summary;
  if (!finalSummary && fullText) {
    // Take first sentence (up to first period, or first 150 chars)
    const firstSentence = fullText.match(/^[^.!?]+[.!?]/);
    if (firstSentence) {
      finalSummary = firstSentence[0].trim();
    } else {
      // No sentence ending found, take first 150 chars
      finalSummary = fullText.substring(0, 150).trim();
      if (fullText.length > 150) finalSummary += '...';
    }
  }

  // Build the final record
  const record = {
    kind: "person",
    source: "mit-people-spreadsheet",
    sourceType: "person",
    runId,

    title: `${firstName} ${lastName}${title ? ` - ${title}` : ""}`,
    url,
    
    // IMPORTANT: For people with shared URLs (team pages), use composite key for deduplication
    // This overrides the default URL-only deduplication in MITBrainSchema
    _dedupeKey: `person:${firstName}:${lastName}:${url}`,

    firstName: fixText(firstName),
    lastName: fixText(lastName),
    
    // Optional fields
    ...(title && { title: fixText(title) }),
    ...(city && { city: fixText(city) }),
    ...(state && { state: fixText(state) }),
    ...(country && { country: fixText(country) }),
    ...(mobile && { mobile: fixText(mobile) }),
    ...(email && { email: fixText(email) }),
    ...(dlc && { dlc: fixText(dlc) }),
    ...(mitPeopleCategory && { mitPeopleCategory: fixText(mitPeopleCategory) }),
    ...(assistant && { assistant: fixText(assistant) }),
    ...(officeLocation && { officeLocation: fixText(officeLocation) }),
    ...(linkedIn && { linkedIn: fixText(linkedIn) }),
    ...(finalSummary && { summary: fixText(finalSummary) }),
    ...(tags.length > 0 && { tags }),
    
    fullText: fixText(fullText),
    
    publishedAt: new Date().toISOString().split('T')[0], // Today's date
  };

  return record;
}

async function scrapeMitPeopleFromSpreadsheet({ xlsxPath, dryRun, skipAI, limit }) {
  console.log("==============================================");
  console.log("Scraping MIT People into MIT Brain via MITBrainSchema");
  console.log("==============================================");
  console.log(`XLSX path: ${xlsxPath}`);
  console.log(`Dry run:   ${dryRun ? "YES" : "NO"}`);
  console.log(`Skip AI:   ${skipAI ? "YES (faster, but basic)" : "NO (enhanced with AI)"}`);
  console.log(`Limit:     ${limit || "none (all rows)"}`);
  console.log("");

  if (!process.env.OPENAI_API_KEY && !skipAI) {
    console.warn("⚠️  WARNING: OPENAI_API_KEY not found. Running with --skip-ai mode.");
    skipAI = true;
  }

  const runId = getRunId();
  console.log(`Run ID: ${runId}`);
  
  console.log(`Loading Excel file: ${xlsxPath}`);
  const rows = loadPeopleRowsFromXlsx(xlsxPath);
  console.log(`✅ Loaded ${rows.length} rows from Excel`);

  console.log("\nInitializing MITBrainSchema...");
  const schema = new MITBrainSchema();
  console.log(`  Brain name: ${schema.brainName}`);
  console.log(`  Brain dir: ${schema.brainDir}`);
  console.log(`  JSONL: ${schema.brainDir}/${schema.brainName}.jsonl`);
  console.log(`  CSV: ${schema.brainDir}/${schema.brainName}.csv`);
  
  const peopleRecords = [];

  const rowsToProcess = limit ? rows.slice(0, limit) : rows;
  console.log(`\nProcessing ${rowsToProcess.length} people...`);
  console.log("");

  let processedCount = 0;

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i];
    const rowNumber = i + 2; // 1-based, plus header row

    console.log(`[Row ${rowNumber}/${rowsToProcess.length + 1}]`);
    
    const rec = await mapRowToPersonRecord(row, runId, { skipAI });

    if (!rec) {
      console.log(`   ⏭️  Skipped: no first/last name`);
      continue;
    }

    console.log(`   ✅ ${rec.title}`);
    
    // Write immediately to MITBrainSchema (enables auto-flush every 500 records)
    schema.write(rec);
    processedCount++;

    // Small delay to avoid rate limits (only if using AI)
    if (!skipAI && i < rowsToProcess.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
    }
  }

  console.log("");
  console.log(`Processed ${processedCount} person records.`);

  if (dryRun) {
    console.log("Dry run enabled; NOT writing to MIT Brain files.");
    return;
  }

  if (processedCount === 0) {
    console.log("No person records to write. Exiting.");
    return;
  }

  // Final flush to write any remaining records
  console.log("\nFinal flush...");
  await schema.flush?.(); // supports both sync and async flush

  console.log("");
  console.log(
    `✅ Done. Wrote ${processedCount} people via MITBrainSchema.`
  );
  
  // Print stats
  console.log("\nFinal statistics:");
  schema.printStats();
}

// -----------------------------------------------------------------------------
// CLI entrypoint
// -----------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  let xlsxPath = null;
  let dryRun = false;
  let skipAI = false;
  let limit = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--xlsx" && args[i + 1]) {
      xlsxPath = path.resolve(args[++i]);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--skip-ai") {
      skipAI = true;
    } else if (arg === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: node scrapeMitPeople.js [options]

Options:
  --xlsx <path>    Path to XLSX file (default: ../data/MITPeople.xlsx)
  --dry-run        Don't write to files, just show what would be done
  --skip-ai        Skip AI URL lookup and fullText generation (faster, basic fallback)
  --limit <n>      Only process first N rows (for testing)
  --help, -h       Show this help message

Examples:
  node scrapeMitPeople.js
  node scrapeMitPeople.js --xlsx ~/Downloads/people.xlsx
  node scrapeMitPeople.js --dry-run --limit 5
  node scrapeMitPeople.js --skip-ai  # Fast mode without AI
      `);
      process.exit(0);
    }
  }

  if (!xlsxPath) {
    xlsxPath = DEFAULT_PEOPLE_XLSX;
  }

  try {
    await scrapeMitPeopleFromSpreadsheet({ xlsxPath, dryRun, skipAI, limit });
  } catch (err) {
    console.error("❌ scrapeMitPeople failed:", err.message || err);
    console.error(err);
    process.exit(1);
  }
}

// Run main if this file is executed directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) {
    main();
  }
}