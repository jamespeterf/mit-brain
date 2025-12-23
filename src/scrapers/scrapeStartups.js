#!/usr/bin/env node

// scrapers/scrapeStartups.js
//
// Import startup data from a CSV file in ../data directory
// Maps startup fields to MIT Brain schema
// Supports update mode to overwrite existing startups
//
// CSV columns expected (based on your existing data):
//   name, website, elevator_pitch, description, technology_description,
//   mit_connection, contact, founded, employees, technology, industry,
//   capital_raised, keywords, profile_url, scraped_at
//
// Env vars:
//   STARTUP_CSV_FILE      (required - filename in ../data directory)
//   UPDATE_MODE           (set to 'true' to overwrite existing startups)
//   MIT_BRAIN_RUN_ID      (optional - run identifier)

console.log("Starting scrapeStartups.js...");

import 'dotenv/config';
console.log("Loaded dotenv");

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import { createRequire } from 'module';
console.log("Loaded dependencies");

// Get current file's directory (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import CommonJS module (MITBrainSchema uses module.exports)
const require = createRequire(import.meta.url);
const { MITBrainSchema, fixText, normalizeDate, getRunId } = require("../shared/MITBrainSchema.cjs");
console.log("Loaded MITBrainSchema");

// ==================================================
// Configuration
// ==================================================

const STARTUP_CSV_FILE = process.env.STARTUP_CSV_FILE;
const UPDATE_MODE = process.env.UPDATE_MODE === 'true';

if (!STARTUP_CSV_FILE) {
  console.error("ERROR: STARTUP_CSV_FILE environment variable is required");
  console.error("Example: STARTUP_CSV_FILE=startups.csv");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "..", "input");
const CSV_PATH = path.join(DATA_DIR, STARTUP_CSV_FILE);

if (!fs.existsSync(CSV_PATH)) {
  console.error(`ERROR: CSV file not found: ${CSV_PATH}`);
  console.error(`Please place your CSV file in the data/ directory`);
  process.exit(1);
}

// ==================================================
// Field Mapping
// ==================================================

/**
 * Map CSV row to MIT Brain schema
 * Reuses existing schema fields where possible:
 * - name → title (company name as title)
 * - description → summary (short description)
 * - elevator_pitch → fullText (longer pitch)
 * - website → url (company website)
 * - founded → publishedAt (founding date)
 * - keywords → tags (array of keywords)
 */
function mapStartupToRecord(row) {
  // Clean and normalize data
  let companyName = fixText(row.name || "");
  
  // Remove common suffixes from scraped data (e.g., "Edit" buttons)
  companyName = companyName.replace(/\s+Edit\s*$/i, "").trim();
  
  const website = (row.website || "").trim();
  const elevatorPitch = fixText(row.elevator_pitch || "");
  const description = fixText(row.description || "");
  const foundedDate = row.founded ? row.founded.trim() : "";
  
  // Parse keywords into array
  const keywords = row.keywords 
    ? row.keywords.split(/[,;|]/).map(k => fixText(k)).filter(Boolean)
    : [];
  
  // Parse industries into array (handle both comma and pipe separators)
  const industries = row.industry
    ? row.industry.split(/[,;|]/).map(i => fixText(i)).filter(Boolean)
    : [];
  
  // Parse contacts into array (if it's structured data)
  let contacts = [];
  if (row.contact) {
    try {
      // Try parsing as JSON first
      contacts = JSON.parse(row.contact);
    } catch {
      // Otherwise treat as single contact
      contacts = [fixText(row.contact)];
    }
  }
  
  // Parse employees (could be a range like "50-100" or single number)
  // Don't let Papa treat it as a date - keep as string
  const employees = row.employees ? String(row.employees).trim() : "";
  
  // Create the record
  const record = {
    // Standard schema fields
    kind: "startup",
    source: "MIT STEX",
    sourceType: "website",
    title: companyName,  // Use company name as title for validation
    url: website,
    publishedAt: null,  // Not applicable for startups
    rawDate: "",
    summary: elevatorPitch,  // Elevator pitch in summary
    fullText: description,   // Description in fullText
    tags: keywords,
    authors: [],  // Could add founders here if available
    mitGroups: [],  // To be enriched later
    mitAuthors: [],  // To be enriched later
    eventName: "",
    ilpSummary: "",
    ilpKeywords: "",
    
    // Startup-specific optional fields
    companyName: companyName,  // Company name goes here
    foundedDate: foundedDate,
    employees: employees,
    
    // Location (to be enriched from website or PitchBook)
    headquarters: "",
    country: "",
    region: "",
    
    // Funding
    capitalRaised: row.capital_raised || "",
    capitalStage: "",  // To be enriched from PitchBook
    lastFundingDate: "",
    lastFundingAmount: "",
    valuation: "",
    totalFundingRounds: "",
    
    // Investors (to be enriched from PitchBook)
    investors: [],
    leadInvestors: [],
    mitInvestors: [],
    
    // People (to be enriched)
    founders: [],
    mitFounders: [],
    ceo: "",
    keyExecutives: [],
    
    // Status & Model (to be enriched)
    companyStatus: "Active",  // Default assumption
    businessModel: "",
    
    // Industries & Tech
    industries: industries,
    technology: fixText(row.technology || ""),
    technologyDescription: fixText(row.technology_description || ""),
    
    // MIT Connection
    mitConnection: fixText(row.mit_connection || ""),
    mitLicensedTechnology: false,  // To be enriched
    mitLabs: [],  // To be enriched
    
    // Exit (to be enriched from PitchBook)
    exitDate: null,
    exitType: null,
    acquiredBy: null,
    acquisitionAmount: null,
    ipoTicker: null,
    
    // Performance (to be enriched)
    revenue: "",
    revenueGrowthRate: "",
    isProfitable: false,
    customerCount: "",
    
    // Social/Web (to be enriched from website)
    linkedinUrl: "",
    crunchbaseUrl: "",
    twitterHandle: "",
    
    // Contacts
    contacts: contacts,
    
    // Metadata
    profileUrl: row.profile_url || "",
    pitchbookId: "",
    updatedAt: row.scraped_at || new Date().toISOString()
  };
  
  return record;
}

// ==================================================
// Main import function
// ==================================================

async function scrapeStartups() {
  console.log("MIT Startup CSV Importer starting.");
  console.log(`Reading CSV: ${CSV_PATH}`);
  console.log(`Update mode: ${UPDATE_MODE ? 'ON (will overwrite existing)' : 'OFF (skip duplicates)'}\n`);
  
  // Initialize schema
  const schema = new MITBrainSchema();
  
  // Read CSV file
  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  
  // Parse CSV
  console.log("Parsing CSV...");
  const parseResult = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,  // Keep everything as strings to prevent date conversion
    transformHeader: (header) => {
      // Normalize header names (trim whitespace)
      return header.trim();
    }
  });
  
  if (parseResult.errors.length > 0) {
    console.warn("\nCSV parsing warnings:");
    parseResult.errors.forEach(err => {
      console.warn(`  Row ${err.row}: ${err.message}`);
    });
    console.log("");
  }
  
  const rows = parseResult.data;
  console.log(`Found ${rows.length} startups in CSV\n`);
  
  if (rows.length === 0) {
    console.log("No data found in CSV. Exiting.");
    return;
  }
  
  // Show sample of first row for verification
  if (rows[0]) {
    console.log("Sample first row:");
    console.log(`  Name: ${rows[0].name}`);
    console.log(`  Website: ${rows[0].website}`);
    console.log(`  Founded: ${rows[0].founded}`);
    console.log(`  Industry: ${rows[0].industry}`);
    console.log("");
  }
  
  // Process each startup
  let processed = 0;
  let written = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const row of rows) {
    processed++;
    
    // Skip rows without required fields
    if (!row.name || !row.website) {
      console.log(`[${processed}/${rows.length}] Skip: Missing name or website`);
      errors++;
      continue;
    }
    
    console.log(`[${processed}/${rows.length}] ${row.name}`);
    
    try {
      // Map CSV row to schema record
      const record = mapStartupToRecord(row);
      
      // Write with appropriate options
      const result = schema.write(record, {
        skipDuplicates: !UPDATE_MODE,
        updateDuplicates: UPDATE_MODE,
        validate: true
      });
      
      if (result.written) {
        if (UPDATE_MODE && schema.isDuplicate(record.url)) {
          updated++;
          console.log(`  ✓ Updated`);
        } else {
          written++;
          console.log(`  ✓ Written`);
        }
      } else if (result.reason === 'duplicate') {
        skipped++;
        console.log(`  Skip (duplicate)`);
      } else if (result.reason === 'validation_failed') {
        errors++;
        console.log(`  ✗ Validation failed: ${result.errors?.join(', ')}`);
      }
      
    } catch (err) {
      errors++;
      console.error(`  ✗ Error processing: ${err.message}`);
    }
  }
  
  // Flush to disk (writes CSV and appends to JSONL)
  console.log("\n💾 Writing CSV and JSONL files...");
  schema.flush();
  
  // Run sanity check
  schema.printSanityCheck();
  
  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("IMPORT SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total rows in CSV: ${rows.length}`);
  console.log(`Processed: ${processed}`);
  console.log(`Written (new): ${written}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (duplicates): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log("=".repeat(80) + "\n");
  
  schema.printSummary();
}

// ==================================================
// Entrypoint
// ==================================================

async function main() {
  try {
    await scrapeStartups();
  } catch (err) {
    console.error("Fatal error in scrapeStartups:", err);
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) {
    main();
  }
}

export { scrapeStartups };