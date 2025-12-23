#!/usr/bin/env node

// scrapers/scrapeEvents-fresh.mjs
// FRESH START: Removes ALL future_event records and loads events from scratch

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const XLSX = require("xlsx");
const { MITBrainSchema, fixText, normalizeDate } = require("../shared/MITBrainSchema.js");

const eventsPath = process.argv[2] || path.join(__dirname, "../input/events.xlsx");

console.log("\n🔥 FRESH START: Loading MIT Events");
console.log("=" .repeat(60));
console.log("⚠️  WARNING: This will REMOVE all existing future_event records!");
console.log("File:", eventsPath);
console.log("");

try {
  // Step 1: Load existing records and remove ALL future_event records
  console.log("STEP 1: Removing existing future_event records...");
  
  const jsonlPath = path.join(process.cwd(), 'output', 'jsonl', 'mit_brain.jsonl');
  let otherRecords = [];
  let eventsRemoved = 0;
  
  try {
    await fs.access(jsonlPath);
    const fileContent = await fs.readFile(jsonlPath, 'utf-8');
    const lines = fileContent.trim().split('\n').filter(line => line.trim());
    const allRecords = lines.map(line => JSON.parse(line));
    
    eventsRemoved = allRecords.filter(r => r.kind === "future_event").length;
    otherRecords = allRecords.filter(r => r.kind !== "future_event");
    
    console.log(`  🗑️  Removed ${eventsRemoved} existing future_event records`);
    console.log(`  ✅ Kept ${otherRecords.length} other records`);
  } catch {
    console.log("  No existing data file found. Starting fresh.");
  }
  
  // Step 2: Load Excel file
  console.log("\nSTEP 2: Loading Excel file...");
  const workbook = XLSX.readFile(eventsPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  console.log("  ✅ Loaded sheet:", sheetName);
  
  // Step 3: Parse rows
  console.log("\nSTEP 3: Parsing rows...");
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  console.log("  ✅ Parsed", rows.length, "rows");
  
  // Step 4: Extract hyperlinks
  console.log("\nSTEP 4: Extracting hyperlinks...");
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const headers = {};
  
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    const cell = sheet[cellAddress];
    if (cell && cell.v) {
      headers[col] = cell.v;
    }
  }
  
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const excelRowNum = rowIdx + range.s.r + 1;
    
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: excelRowNum, c: col });
      const cell = sheet[cellAddress];
      
      if (cell && cell.l && cell.l.Target) {
        const headerName = headers[col];
        if (headerName) {
          rows[rowIdx][`${headerName}_LINK`] = cell.l.Target;
        }
      }
    }
  }
  
  const withLinks = rows.filter(r => r['MIT Upcoming Events_LINK']).length;
  console.log("  ✅ Extracted", withLinks, "hyperlinks");
  
  // Step 5: Create schema and write other records
  console.log("\nSTEP 5: Creating MITBrainSchema...");
  const schema = new MITBrainSchema();
  
  if (otherRecords.length > 0) {
    console.log(`  Writing ${otherRecords.length} existing non-event records...`);
    schema.writeBatch(otherRecords);
  }
  
  console.log("  ✅ Schema ready");
  
  // Step 6: Process new events
  console.log("\nSTEP 6: Processing new events...");
  let added = 0;
  let skipped = 0;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    const title = fixText(row['MIT Upcoming Events'] || "");
    if (!title) {
      skipped++;
      continue;
    }
    
    // Get date - handle Excel dates properly
    let eventDate = "";
    if (row['DATE']) {
      if (row['DATE'] instanceof Date) {
        // Already a Date object
        eventDate = row['DATE'].toISOString().split('T')[0];
      } else if (typeof row['DATE'] === 'number') {
        // Excel serial number - convert to Date
        const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
        const date = new Date(excelEpoch.getTime() + row['DATE'] * 86400000);
        eventDate = date.toISOString().split('T')[0];
      } else if (typeof row['DATE'] === 'string') {
        // Try to parse string date
        const normalized = normalizeDate(row['DATE']);
        // Validate it's a reasonable date
        if (normalized && normalized.match(/^\d{4}-\d{2}-\d{2}$/) && !normalized.startsWith('+')) {
          eventDate = normalized;
        } else {
          // Try parsing directly
          try {
            const date = new Date(row['DATE']);
            if (!isNaN(date.getTime()) && date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
              eventDate = date.toISOString().split('T')[0];
            }
          } catch (e) {
            eventDate = "";
          }
        }
      }
    }
    
    let url = row['MIT Upcoming Events_LINK'] || "";
    if (!url) {
      const titleSlug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);
      url = `https://events.mit.edu/${eventDate}/${titleSlug}`;
    }
    
    const record = {
      kind: "future_event",
      source: "MIT Events",
      sourceType: "spreadsheet",
      title: title,
      url: url,
      publishedAt: "",
      rawDate: row['DATE']?.toString() || "",
      summary: fixText(row['Description'] || ""),
      fullText: "",
      tags: [],
      authors: [],
      mitGroups: row['MIT DLCIs'] ? String(row['MIT DLCIs']).split(',').map(s => s.trim()).filter(Boolean) : [],
      mitAuthors: [],
      eventName: title,
      ilpSummary: "",
      ilpKeywords: "",
      rssFeed: "",
      citationCount: 0,
      venue: "",
      doi: "",
      arxivId: "",
      pdfUrl: "",
      grants: [],
      videoId: "",
      durationSeconds: 0,
      thumbnailUrl: "",
      recordingDate: "",
      speakers: [],
      viewCount: 0,
      likeCount: 0,
      commentCount: 0,
      futureEventDate: eventDate || "",
      location: fixText(row['Location'] || ""),
      eventType: fixText(row['In-Person / Virtual / Hybrid'] || ""),
      generalAdmission: fixText(row['General Public Admission'] || ""),
      ilpAdmission: fixText(row['ILP Member Admission'] || ""),
      eventTime: fixText(String(row['Time (EST)'] || "")),
      eventNote: fixText(row['Note '] || ""),
    };
    
    schema.write(record);
    added++;
    
    if (added % 10 === 0) {
      console.log(`  Processed ${added} events...`);
    }
  }
  
  console.log("\n  SUMMARY:");
  console.log("    Added:", added);
  console.log("    Skipped:", skipped);
  
  // Step 7: Flush
  console.log("\nSTEP 7: Flushing to disk...");
  schema.flush();
  console.log("  ✅ Flush completed");
  
  // Step 8: Verify
  console.log("\nSTEP 8: Verifying output...");
  const jsonlContent = await fs.readFile(jsonlPath, 'utf-8');
  const jsonlLines = jsonlContent.trim().split('\n');
  const futureEvents = jsonlLines
    .map(line => JSON.parse(line))
    .filter(r => r.kind === "future_event");
  
  console.log("  Future events in file:", futureEvents.length);
  
  const withRealUrls = futureEvents.filter(e => e.url && !e.url.startsWith('https://events.mit.edu/')).length;
  const withSyntheticUrls = futureEvents.length - withRealUrls;
  
  console.log("\n" + "=".repeat(60));
  console.log("✅ FRESH START COMPLETED");
  console.log("=".repeat(60));
  console.log(`🗑️  Old events removed:           ${eventsRemoved}`);
  console.log(`✅ Other records preserved:      ${otherRecords.length}`);
  console.log(`✅ New events added:             ${added}`);
  console.log(`   - With real URLs:             ${withRealUrls}`);
  console.log(`   - With synthetic URLs:        ${withSyntheticUrls}`);
  console.log(`📊 Total events in output:       ${futureEvents.length}`);
  console.log("=".repeat(60));
  
} catch (err) {
  console.error("\n❌ FRESH START FAILED:");
  console.error("Error:", err.message);
  console.error("Stack:", err.stack);
  process.exit(1);
}
