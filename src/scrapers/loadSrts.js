#!/usr/bin/env node
/**
 * loadSrts.js
 * 
 * Updates an existing CSV file with YouTube SRT captions.
 * Reads the input CSV, adds fullText from SRT files, and writes via MITBrainSchema.
 * 
 * Usage:
 *   node loadSrts.js <csv_file> [captions_dir]
 * 
 * Arguments:
 *   csv_file     : Path to CSV file to update (required)
 *                  Expected location: output/csv/mit_brain.csv
 *   captions_dir : Path to captions directory (optional, default: output/captions)
 * 
 * What it does:
 *   - Reads existing CSV file
 *   - Matches videos to SRT files in captions directory
 *   - Adds/updates fullText column with inline transcript format: (HH:MM:SS) text
 *   - Writes CSV and JSONL via MITBrainSchema (which handles Excel truncation automatically)
 *   - CSV: Fields >32,000 chars truncated with "WARNING - TEXT TRUNCATED: " prefix
 *   - JSONL: Full fidelity, no truncation
 * 
 * Examples:
 *   node scrapers/loadSrts.js output/csv/mit_brain.csv
 *   node scrapers/loadSrts.js output/csv/mit_brain.csv output/captions
 * 
 * Requirements:
 *   npm install csv-parse
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { createRequire } from "module";

// Get current file's directory (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import CommonJS module (MITBrainSchema uses module.exports)
const require = createRequire(import.meta.url);
const { MITBrainSchema } = require("../shared/MITBrainSchema.cjs");

function getVideoIdFromUrl(url) {
  if (!url || typeof url !== "string") {
    return null;
  }
  
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/,
    /youtube\.com\/embed\/([^&\s]+)/,
    /youtube\.com\/v\/([^&\s]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function getVideoIdFromFilename(filename) {
  const match = filename.match(/^([^.]+)/);
  return match ? match[1] : null;
}

function simplifyTimestamp(timestamp) {
  return timestamp.split(",")[0];
}

function cleanText(text) {
  return text
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

function convertSrtToInlineFormat(srtContent) {
  if (!srtContent) {
    return "";
  }
  
  const lines = srtContent.trim().split("\n");
  const segments = [];
  let currentTimestamp = null;
  let currentText = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line) {
      if (currentTimestamp && currentText.length > 0) {
        segments.push({
          timestamp: currentTimestamp,
          text: currentText.join(" ")
        });
        currentTimestamp = null;
        currentText = [];
      }
      continue;
    }
    
    if (/^\d+$/.test(line)) {
      continue;
    }
    
    if (line.includes("-->")) {
      const parts = line.split("-->");
      if (parts.length >= 1) {
        currentTimestamp = simplifyTimestamp(parts[0].trim());
      }
      continue;
    }
    
    if (currentTimestamp) {
      currentText.push(cleanText(line));
    }
  }
  
  if (currentTimestamp && currentText.length > 0) {
    segments.push({
      timestamp: currentTimestamp,
      text: currentText.join(" ")
    });
  }
  
  const inlineText = segments.map(seg => `(${seg.timestamp}) ${seg.text}`).join(" ");
  
  return inlineText;
}

function readSrtFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content;
  } catch (error) {
    console.error(`  ✗ Error reading ${filePath}: ${error.message}`);
    return null;
  }
}

function getAllSrtFiles(captionsDir) {
  try {
    const files = fs.readdirSync(captionsDir);
    const srtFiles = files.filter(file => file.endsWith(".srt"));
    
    const srtMap = {};
    for (const file of srtFiles) {
      const videoId = getVideoIdFromFilename(file);
      if (videoId) {
        srtMap[videoId] = path.join(captionsDir, file);
      }
    }
    
    return srtMap;
  } catch (error) {
    console.error(`✗ Error reading captions directory: ${error.message}`);
    return {};
  }
}

function loadSrts(csvFile, captionsDir = "captions", urlColumn = "url") {
  console.log("=".repeat(60));
  console.log("SRT Loader - Update CSV In-Place");
  console.log("=".repeat(60));
  console.log(`Input CSV: ${csvFile}`);
  console.log(`Captions Directory: ${captionsDir}`);
  console.log(`URL Column: ${urlColumn}`);
  console.log(`Format: (HH:MM:SS) text (HH:MM:SS) text...`);
  console.log("=".repeat(60));
  
  // Check captions directory
  if (!fs.existsSync(captionsDir)) {
    console.error(`✗ Captions directory not found: ${captionsDir}`);
    return false;
  }
  
  // Read SRT files
  console.log("\n📂 Reading SRT files from captions directory...");
  const srtMap = getAllSrtFiles(captionsDir);
  const srtCount = Object.keys(srtMap).length;
  console.log(`📄 Found ${srtCount} SRT files`);
  
  if (srtCount === 0) {
    console.error("✗ No SRT files found in captions directory");
    return false;
  }
  
  // Read CSV
  console.log("\n📄 Reading CSV file...");
  let csvContent;
  try {
    csvContent = fs.readFileSync(csvFile, "utf8");
  } catch (error) {
    console.error(`✗ Error reading CSV file: ${error.message}`);
    return false;
  }
  
  // Parse CSV
  let records;
  try {
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true
    });
    console.log(`📊 Loaded ${records.length} rows from CSV`);
    
    // Convert pipe-separated strings back to arrays for schema validation
    const arrayFields = ['tags', 'authors', 'mitGroups', 'mitAuthors', 'ilpKeywords', 
                         'investors', 'leadInvestors', 'mitInvestors', 'founders', 
                         'mitFounders', 'keyExecutives', 'industries', 'mitLabs', 'speakers'];
    
    records = records.map(record => {
      arrayFields.forEach(field => {
        if (record[field] && typeof record[field] === 'string') {
          // Split by " | " and filter out empty strings
          record[field] = record[field].split(' | ').filter(item => item.trim());
        } else if (!record[field]) {
          record[field] = [];
        }
      });
      return record;
    });
  } catch (error) {
    console.error(`✗ Error parsing CSV: ${error.message}`);
    return false;
  }
  
  // Check URL column
  if (records.length > 0 && !records[0].hasOwnProperty(urlColumn)) {
    console.error(`✗ Column '${urlColumn}' not found in CSV`);
    console.log(`Available columns: ${Object.keys(records[0]).join(", ")}`);
    return false;
  }
  
  // Update records with SRT content
  console.log("\n📝 Matching SRT files to CSV rows and converting format...");
  let matchCount = 0;
  let updatedCount = 0;
  let resetCount = 0;  // Track how many get enrichment fields reset
  
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const url = record[urlColumn];
    
    if (!url) {
      continue;
    }
    
    const videoId = getVideoIdFromUrl(url);
    
    if (!videoId) {
      continue;
    }
    
    matchCount++;
    
    if (srtMap[videoId]) {
      const srtContent = readSrtFile(srtMap[videoId]);
      
      if (srtContent) {
        const inlineText = convertSrtToInlineFormat(srtContent);
        
        if (inlineText) {
          // OPTION 1: Auto-reset enrichment fields if fullText was empty
          const hadNoFullText = !record.fullText || record.fullText.trim() === '';
          
          record.fullText = inlineText;
          updatedCount++;
          
          // If fullText was empty, clear enrichment fields
          // (they were enriched without captions, so they're poor quality)
          if (hadNoFullText) {
            record.ilpSummary = "";
            record.ilpKeywords = [];
            resetCount++;
            
            const preview = inlineText.substring(0, 80) + (inlineText.length > 80 ? "..." : "");
            console.log(`  ✓ [${i + 1}] ${videoId} (${inlineText.length} chars)`);
            console.log(`      ⚠️  Cleared enrichment fields (will re-enrich with captions)`);
            console.log(`      ${preview}`);
          } else {
            const preview = inlineText.substring(0, 80) + (inlineText.length > 80 ? "..." : "");
            console.log(`  ✓ [${i + 1}] ${videoId} (${inlineText.length} chars)`);
            console.log(`      ${preview}`);
          }
        }
      }
    }
  }
  
  console.log(`\n📊 Processing Summary:`);
  console.log(`   Total CSV rows: ${records.length}`);
  console.log(`   Rows with video URLs: ${matchCount}`);
  console.log(`   Rows updated with SRT: ${updatedCount}`);
  console.log(`   Enrichment fields reset: ${resetCount} (will re-enrich)`);
  console.log(`   SRT files not matched: ${srtCount - updatedCount}`);
  
  console.log(`\n💾 Writing updated records via MITBrainSchema...`);
  
  try {
    // Create schema instance - it will load existing records from JSONL
    const schema = new MITBrainSchema();
    
    console.log(`   Brain file: ${schema.brainName}`);
    console.log(`   Output directory: ${schema.outputRoot}`);
    
    // Track which records need enrichment cleared
    const recordsNeedingClear = new Set();
    
    // First pass: identify which records just got captions
    for (const record of records) {
      if (!record.url) continue;
      
      const hasNewCaptions = record.fullText && record.fullText.trim() !== '';
      const hasEnrichment = record.ilpSummary || (record.ilpKeywords && record.ilpKeywords.length > 0);
      
      if (hasNewCaptions && hasEnrichment && schema._existingRecordsByUrl.has(record.url)) {
        const existing = schema._existingRecordsByUrl.get(record.url);
        const existingHadNoFullText = !existing.fullText || existing.fullText.trim() === '';
        
        if (existingHadNoFullText) {
          recordsNeedingClear.add(record.url);
        }
      }
    }
    
    console.log(`\n📝 Writing ${records.length} records...`);
    if (recordsNeedingClear.size > 0) {
      console.log(`   ⚠️  ${recordsNeedingClear.size} records will have enrichment force-cleared\n`);
    }
    
    let writeCount = 0;
    let updateCount = 0;
    let skipCount = 0;
    let forceClearCount = 0;
    
    for (const record of records) {
      if (!record.url) continue;
      
      // Force-clear enrichment for records that just got captions
      if (recordsNeedingClear.has(record.url)) {
        const existing = schema._existingRecordsByUrl.get(record.url);
        existing.fullText = record.fullText;
        existing.ilpSummary = '';
        existing.ilpKeywords = [];
        schema._updatedRecords.add(record.url);
        forceClearCount++;
        continue;
      }
      
      // Normal write for other records
      const result = schema.write(record);
      
      if (result.written) {
        writeCount++;
      } else if (result.updated) {
        updateCount++;
      } else if (result.skipped) {
        skipCount++;
      }
    }
    
    console.log(`\n📊 Write Results:`);
    console.log(`   New records: ${writeCount}`);
    console.log(`   Updated records: ${updateCount}`);
    console.log(`   Force-cleared enrichment: ${forceClearCount}`);
    console.log(`   Skipped (no changes): ${skipCount}`);
    
    // Flush to disk - writes CSV and JSONL
    console.log(`\n💾 Flushing to disk...`);
    schema.flush();
    
    // Run sanity check to verify CSV and JSONL consistency
    schema.printSanityCheck();
    
    console.log("\n✅ Files written successfully via MITBrainSchema!");
    console.log(`   📊 ${schema.records.length} total records in dataset`);
    console.log(`   📝 ${updatedCount} records updated with transcripts`);
    console.log(`   📊 CSV: Truncated at 32,000 chars (Excel-compatible)`);
    console.log(`   📄 JSONL: Full fidelity (no truncation)`);
    
  } catch (error) {
    console.error(`✗ Error writing files: ${error.message}`);
    console.error(error.stack);
    return false;
  }
  
  return true;
}

// Main execution
const args = process.argv.slice(2);

// Get paths from environment or use defaults
const brainDir = process.env.BRAIN_DIR || "../brain";
const inputDir = process.env.INPUT_DIR || "../input";
const brainName = process.env.MIT_BRAIN || "mit_brain_test17";
const csvFile = args[0] || `${brainDir}/${brainName}.csv`;
const captionsDir = args[1] || `${inputDir}/captions`;

if (!fs.existsSync(csvFile)) {
  console.error(`✗ File not found: ${csvFile}`);
  console.error(`\nExpected CSV file at: ${csvFile}`);
  console.error(`\nMake sure:`);
  console.error(`1. MIT_BRAIN environment variable is set correctly (current: ${brainName})`);
  console.error(`2. scrapeIlpVideos.js has run and created the CSV file`);
  console.error(`3. Or provide the CSV path as first argument: node loadSrts.js <csv_file>`);
  process.exit(1);
}

const success = loadSrts(csvFile, captionsDir);

if (success) {
  console.log("\n🎉 Processing complete!");
  console.log(`\n📦 Updated files:`);
  console.log(`   📊 ${csvFile} (updated with transcripts)`);
  console.log(`   📄 ${csvFile.replace(/\.csv$/, ".jsonl").replace("/csv/", "/jsonl/")} (full fidelity)`);
  process.exit(0);
} else {
  console.log("\n✗ Processing failed");
  process.exit(1);
}