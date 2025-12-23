#!/usr/bin/env node

/**
 * Scrape events from an XLSX spreadsheet and write them into the MIT Brain
 * JSONL / CSV files via MITBrainSchema.
 *
 * ALL reads/writes to the MIT Brain go through MITBrainSchema.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import XLSX from "xlsx";

const require = createRequire(import.meta.url);
const {
  MITBrainSchema,
  fixText,
  normalizeDate,
  getRunId,
} = require("../shared/MITBrainSchema.cjs");

// -----------------------------------------------------------------------------
// Paths / config
// -----------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default XLSX path (override with --xlsx path/to/file.xlsx)
const DEFAULT_EVENTS_XLSX = path.resolve(
  __dirname,
  "../data/events.xlsx"
);

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

function stripEditSuffix(str) {
  if (!str) return str;
  return String(str).replace(/\s*Edit\s*$/i, "").trim();
}

/**
 * Get the first non-empty value for a list of possible column names.
 */
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

// -----------------------------------------------------------------------------
// Core scraper
// -----------------------------------------------------------------------------

function loadEventRowsFromXlsx(xlsxPath) {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`XLSX file not found: ${xlsxPath}`);
  }

  const workbook = XLSX.readFile(xlsxPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });

  console.log(
    `Loaded ${rows.length} rows from sheet "${sheetName}" in ${xlsxPath}`
  );
  return rows;
}

function mapRowToEventRecord(row, runId) {
  const rawTitle = getFirst(row, [
    "Event Title",
    "Title",
    "Name",
    "Event",
  ]);
  const rawUrl = getFirst(row, [
    "Event URL",
    "URL",
    "Link",
  ]);

  if (!rawTitle && !rawUrl) {
    return null;
  }

  const rawDate = getFirst(row, [
    "Date",
    "Start Date",
    "Event Date",
  ]);

  const rawEndDate = getFirst(row, [
    "End Date",
    "End",
  ]);

  const rawLocation = getFirst(row, [
    "Location",
    "Venue",
  ]);

  const rawDescription = getFirst(row, [
    "Description",
    "Short Description",
    "Summary",
  ]);

  const rawSpeakers = getFirst(row, [
    "Speaker(s)",
    "Speakers",
    "Host",
    "Organizer",
  ]);

  const rawCategory = getFirst(row, [
    "Category",
    "Event Type",
    "Type",
  ]);

  const rawRegistrationUrl = getFirst(row, [
    "Registration URL",
    "Reg URL",
    "Signup URL",
  ]);

  const record = {
    kind: "event",
    source: "mit-events-spreadsheet",
    sourceType: "event",
    runId,

    title: stripEditSuffix(fixText(rawTitle || rawUrl)),
    url: rawUrl || undefined,

    // For events we treat start date as "publishedAt" / canonical date
    publishedAt: rawDate ? normalizeDate(rawDate) : undefined,

    eventStart: rawDate ? normalizeDate(rawDate) : undefined,
    eventEnd: rawEndDate ? normalizeDate(rawEndDate) : undefined,

    location: rawLocation ? fixText(rawLocation) : undefined,
    speakers: rawSpeakers ? fixText(rawSpeakers) : undefined,
    category: rawCategory ? fixText(rawCategory) : undefined,
    registrationUrl: rawRegistrationUrl || undefined,

    summary: rawDescription ? fixText(rawDescription) : undefined,
  };

  // Remove undefined fields so we don't clutter CSV
  for (const key of Object.keys(record)) {
    if (record[key] === undefined || record[key] === null) {
      delete record[key];
    }
  }

  return record;
}

async function scrapeEventsFromSpreadsheet({ xlsxPath, dryRun }) {
  console.log("==============================================");
  console.log("Scraping events into MIT Brain via MITBrainSchema");
  console.log("==============================================");
  console.log(`XLSX path: ${xlsxPath}`);
  console.log(`Dry run:   ${dryRun ? "YES" : "NO"}`);
  console.log("");

  const runId = getRunId();
  const rows = loadEventRowsFromXlsx(xlsxPath);

  const schema = new MITBrainSchema();
  const eventRecords = [];

  rows.forEach((row, index) => {
    const rec = mapRowToEventRecord(row, runId);
    const rowNumber = index + 2; // 1-based, plus header row

    if (!rec) {
      console.log(
        `Skipping row ${rowNumber}: no title or URL`
      );
      return;
    }

    console.log(
      `[row ${rowNumber}] ${rec.title}${rec.url ? " -> " + rec.url : ""}`
    );
    eventRecords.push(rec);
  });

  console.log("");
  console.log(`Prepared ${eventRecords.length} event records.`);

  if (dryRun) {
    console.log("Dry run enabled; NOT writing to MIT Brain files.");
    return;
  }

  if (eventRecords.length === 0) {
    console.log("No event records to write. Exiting.");
    return;
  }

  // All writes go through MITBrainSchema
  schema.writeBatch(eventRecords);
  await schema.flush?.(); // supports both sync and async flush

  console.log("");
  console.log(
    `✅ Done. Wrote ${eventRecords.length} events via MITBrainSchema.`
  );
}

// -----------------------------------------------------------------------------
// CLI entrypoint
// -----------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  let xlsxPath = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--xlsx" && args[i + 1]) {
      xlsxPath = path.resolve(args[++i]);
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  if (!xlsxPath) {
    xlsxPath = DEFAULT_EVENTS_XLSX;
  }

  try {
    await scrapeEventsFromSpreadsheet({ xlsxPath, dryRun });
  } catch (err) {
    console.error("❌ scrapeEvents failed:", err.message || err);
    console.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Node 22/24 style main check
  main();
}