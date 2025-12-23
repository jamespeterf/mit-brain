// shared/MITBrainSchema.js
//
// Centralized schema management for MIT Brain scrapers.
// Handles writing to CSV and JSONL with consistent formatting,
// deduplication, and validation.
//
// CSV Truncation: Fields exceeding 32,000 characters are automatically
// truncated with "WARNING - TEXT TRUNCATED: " prefix. This conservative limit
// ensures compatibility across all Excel versions and import methods.
// JSONL files maintain full fidelity with no truncation.

const fs = require("fs");
const path = require("path");
const he = require("he");
const { parse } = require("csv-parse/sync");

// Excel-safe cell limit (conservative)
const EXCEL_CELL_LIMIT = 32000;
const TRUNCATION_WARNING = "WARNING - TEXT TRUNCATED:";

// Helper to safely normalize text (decode HTML entities, collapse whitespace)
function fixText(str) {
  if (str == null) return "";
  const decoded = he.decode(String(str));
  return decoded.replace(/\s+/g, " ").trim();
}

// Helper to normalize date to YYYY-MM-DD (or return empty string)
function normalizeDate(dateStr) {
  if (!dateStr) return "";
  const s = String(dateStr);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

class MITBrainSchema {
  constructor() {
    this.brainName = process.env.MIT_BRAIN || "mit_brain";
    // Updated for new directory structure
    this.brainDir =
      process.env.BRAIN_DIR || path.join(__dirname, "../..", "brain");
    this.inputDir =
      process.env.INPUT_DIR || path.join(__dirname, "../..", "input");
    // Legacy aliases for compatibility
    this.outputRoot = this.brainDir;
    this.dataRoot = this.inputDir;

    // Auto-flush configuration (prevent data loss on long runs)
    this.autoFlushThreshold = process.env.AUTO_FLUSH_RECORDS 
      ? parseInt(process.env.AUTO_FLUSH_RECORDS, 10) 
      : 500; // Default: flush every 500 records
    this.recordsSinceLastFlush = 0;

    // Core schema fields (always present)
    this.fields = [
      "kind",
      "source",
      "sourceType",
      "title",
      "url",
      "publishedAt",
      "rawDate",
      "dateAddedToBrain",  // NEW: When item was added to brain (YYYY-MM-DD)
      "summary",
      "fullText",
      "tags",
      "authors",
      "mitGroups",
      "mitAuthors",
      "eventName",
      "ilpSummary",
      "ilpKeywords",
    ];

    // Optional / extended fields
    this.optionalFields = [
      "rssFeed",
      "citationCount",
      "venue",
      "doi",
      "arxivId",
      "pdfUrl",
      "grants",
      "videoId",
      "durationSeconds",
      "thumbnailUrl",
      "recordingDate",
      "speakers",
      "viewCount",
      "likeCount",
      "commentCount",
      "companyName",
      "employees",
      "headquarters",
      "country",
      "region",
      "capitalRaised",
      "capitalStage",
      "lastFundingDate",
      "lastFundingAmount",
      "valuation",
      "totalFundingRounds",
      "investors",
      "leadInvestors",
      "mitInvestors",
      "founders",
      "mitFounders",
      "ceo",
      "keyExecutives",
      "companyStatus",
      "businessModel",
      "industries",
      "technology",
      "technologyDescription",
      "mitConnection",
      "mitLicensedTechnology",
      "mitLabs",
      "exitDate",
      "exitType",
      "acquiredBy",
      "acquisitionAmount",
      "ipoTicker",
      "revenue",
      "revenueGrowthRate",
      "isProfitable",
      "customerCount",
      "linkedinUrl",
      "crunchbaseUrl",
      "twitterHandle",
      "contacts",
      "profileUrl",
      "pitchbookId",
      "updatedAt",
      "futureEventDate",
      "location",
      "eventType",
      "generalAdmission",
      "ilpAdmission",
      "eventTime",
      "eventNote",
    ];

    this.records = [];
    this.existingUrls = new Set();
    this.sessionUrls = new Set();
    this._existingRecordsLoaded = false;
    this._existingRecordsByUrl = new Map();
    this._updatedRecords = new Set(); // CRITICAL FIX: Track which existing records were updated

    this.stats = {
      written: 0,
      skipped: 0,
      updated: 0,
      errors: 0,
      truncated: 0,
      autoFlushCount: 0,
    };
  }

  // ---------- Public write APIs ----------

  // Check if a URL is already in the dataset (useful for avoiding unnecessary API calls)
  isDuplicate(url, trackAsSkipped = false) {
    if (!url) return false;
    
    this._loadExistingRecords();
    
    const isDupe = this.existingUrls.has(url) || this.sessionUrls.has(url);
    
    if (isDupe && trackAsSkipped) {
      this.stats.skipped += 1;
    }
    
    return isDupe;
  }

  write(record) {
    try {
      const normalized = this._normalizeRecord(record);
      const url = normalized.url;

      if (!url) {
        this.stats.errors += 1;
        console.warn("Skipping record with no URL:", normalized.title);
        return { written: false, skipped: false, updated: false, error: true };
      }

      this._loadExistingRecords();

      if (!this.existingUrls.has(url) && this._existingRecordsByUrl.has(url)) {
        this.existingUrls.add(url);
      }

      if (this.existingUrls.has(url) || this.sessionUrls.has(url)) {
        const updated = this._updateExistingRecord(url, normalized);
        if (updated) this.stats.updated += 1;
        else this.stats.skipped += 1;
        return { written: false, skipped: !updated, updated: updated };
      }

      this.records.push(normalized);
      this.sessionUrls.add(url);
      this.stats.written += 1;
      this.recordsSinceLastFlush += 1;

      // Auto-flush when threshold is reached
      if (this.recordsSinceLastFlush >= this.autoFlushThreshold) {
        console.log(`\n💾 Auto-flush: Writing ${this.records.length} records to disk...`);
        this._autoFlush();
      }
      
      return { written: true, skipped: false, updated: false };
    } catch (err) {
      this.stats.errors += 1;
      console.error("Error writing record:", err);
      return { written: false, skipped: false, updated: false, error: true };
    }
  }

  writeBatch(records) {
    if (!Array.isArray(records)) return;
    for (const r of records) this.write(r);
  }

  flush() {
    // CRITICAL: If auto-flush happened, DON'T rewrite (would lose auto-flushed records)
    // Instead, just append remaining records
    
    if (this.stats.autoFlushCount > 0) {
      // Auto-flush happened - just append remaining records
      if (this.records.length > 0) {
        console.log(`\n💾 Final flush: Appending ${this.records.length} remaining records...`);
        this._ensureDirectories();
        const csvPath = this._getCsvPath();
        const jsonlPath = this._getJsonlPath();
        this._appendToCsv(csvPath, this.records);
        this._appendToJsonl(jsonlPath, this.records);
        console.log(`   ✅ Flush complete!`);
      }
      this.records = [];
      this.recordsSinceLastFlush = 0;
      this._updatedRecords.clear();
      return;
    }
    
    // No auto-flush happened - do full rewrite to save any updates
    console.log(`\n💾 Final flush: Rewriting all records to ensure updates are saved...`);
    
    this._ensureDirectories();
    const csvPath = this._getCsvPath();
    const jsonlPath = this._getJsonlPath();
    
    // Collect ALL records: existing (including updated) + new
    const allRecords = [];
    
    // Add all existing records (some may have been updated)
    for (const record of this._existingRecordsByUrl.values()) {
      allRecords.push(record);
    }
    
    // Add new records from this session
    for (const record of this.records) {
      allRecords.push(record);
    }
    
    console.log(`   Total records to write: ${allRecords.length}`);
    console.log(`   - Existing (may include updates): ${this._existingRecordsByUrl.size}`);
    console.log(`   - New this session: ${this.records.length}`);
    console.log(`   - Updated existing: ${this._updatedRecords.size}`);
    
    // REWRITE both files completely with all records
    this._rewriteCsv(csvPath, allRecords);
    this._rewriteJsonl(jsonlPath, allRecords);
    
    this.records = []; // Clear after final flush
    this.recordsSinceLastFlush = 0;
    this._updatedRecords.clear(); // Clear update tracking
    
    console.log(`   ✅ Flush complete!`);
  }

  // Internal auto-flush (called periodically during long runs)
  _autoFlush() {
    if (this.records.length === 0) return;
    
    this._ensureDirectories();
    const csvPath = this._getCsvPath();
    const jsonlPath = this._getJsonlPath();
    this._appendToCsv(csvPath, this.records);
    this._appendToJsonl(jsonlPath, this.records);
    
    this.stats.autoFlushCount += 1;
    this.records = []; // Clear after writing to avoid duplicates
    this.recordsSinceLastFlush = 0;
    console.log(`   ✅ Auto-flush complete (${this.stats.autoFlushCount} total)\n`);
  }

  // ---------- Stats / sanity ----------

  printStats() {
    console.log("\n" + "=".repeat(60));
    console.log("MIT Brain Schema Stats");
    console.log("=".repeat(60));
    console.log(`Brain: ${this.brainName}`);
    console.log(`Output dir: ${this.outputRoot}`);
    console.log(`Data dir: ${this.dataRoot}`);
    console.log("-".repeat(60));
    console.log(`Records written this run: ${this.stats.written}`);
    console.log(`Records skipped (duplicates): ${this.stats.skipped}`);
    console.log(`Records updated (merged): ${this.stats.updated}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log(`Fields truncated for CSV: ${this.stats.truncated}`);
    console.log(`Auto-flushes (every ${this.autoFlushThreshold} records): ${this.stats.autoFlushCount}`);
    console.log("-".repeat(60));
    console.log(`Total unique URLs (existing+new): ${this.existingUrls.size}`);
    console.log(`New URLs this session: ${this.sessionUrls.size}`);
    console.log("=".repeat(60) + "\n");
  }

  printSummary() {
    // Backward-compatible alias
    this.printStats();
  }

  sanityCheck() {
    const csvPath = this._getCsvPath();
    const jsonlPath = this._getJsonlPath();

    if (!fs.existsSync(csvPath) || !fs.existsSync(jsonlPath)) {
      console.warn("⚠️ Missing output files");
      return { csv: 0, jsonl: 0, match: false };
    }

    // JSONL is easy - one line per record
    const jsonlContent = fs.readFileSync(jsonlPath, "utf8");
    const jsonlLines = jsonlContent.trim().split("\n").filter(Boolean);
    const jsonlCount = jsonlLines.length;

    // CSV is tricky - fields can contain newlines, so we need to parse properly
    // Count records by looking for quoted field boundaries
    const csvContent = fs.readFileSync(csvPath, "utf8");
    
    // Use csv-parse to properly count records
    try {
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        relax_quotes: true,
        relax_column_count: true
      });
      const csvCount = records.length;
      
      return { csv: csvCount, jsonl: jsonlCount, match: csvCount === jsonlCount };
    } catch (err) {
      // Fallback to simple line count if parsing fails
      console.warn(`⚠️  CSV parsing failed, using line count (may be inaccurate): ${err.message}`);
      const csvLines = csvContent.trim().split("\n");
      const csvCount = Math.max(0, csvLines.length - 1); // subtract header
      return { csv: csvCount, jsonl: jsonlCount, match: csvCount === jsonlCount };
    }
  }

  printSanityCheck() {
    console.log("\n" + "=".repeat(60));
    console.log("Sanity Check: CSV vs JSONL");
    console.log("=".repeat(60));
    const { csv, jsonl, match } = this.sanityCheck();
    console.log(`CSV records:   ${csv}`);
    console.log(`JSONL records: ${jsonl}`);
    console.log(`Match: ${match ? "✅ Yes" : "❌ No"}`);
    console.log("=".repeat(60) + "\n");
  }

  // ---------- Internal helpers ----------

  _ensureDirectories() {
    for (const dir of ["csv", "jsonl"]) {
      const dirPath = path.join(this.outputRoot, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }
  }

  // Helper to clean potentially stringified array fields
  _cleanArrayField(value) {
    // If it's not an array, return as-is
    if (!Array.isArray(value)) return value;
    
    return value.map(item => {
      // If item is a string that looks like JSON, try to parse it
      if (typeof item === 'string' && (item.startsWith('[') || item.startsWith('{"'))) {
        try {
          const parsed = JSON.parse(item);
          // Recursively clean if we got an array
          if (Array.isArray(parsed)) {
            console.warn(`⚠️  Auto-fixed stringified array in field`);
            return this._cleanArrayField(parsed);
          }
          return parsed;
        } catch (e) {
          // Not valid JSON, return as-is
          return item;
        }
      }
      return item;
    }).flat(); // Flatten in case we got nested arrays
  }

  _normalizeRecord(record) {
    this._loadExistingRecords();

    const normalized = {};

    // List of all array fields that should never be stringified
    const arrayFields = [
      'tags', 'authors', 'mitGroups', 'mitAuthors', 'speakers',
      'ilpKeywords', 'investors', 'leadInvestors', 'mitInvestors',
      'founders', 'mitFounders', 'keyExecutives', 'industries', 'contacts'
    ];

    this.fields.forEach((f) => {
      if (arrayFields.includes(f)) {
        // Ensure it's an array and clean any stringified values
        let arr = Array.isArray(record[f]) ? record[f] : [];
        arr = this._cleanArrayField(arr);
        normalized[f] = arr.map((v) => fixText(v));
      } else {
        normalized[f] = record[f] != null ? record[f] : "";
      }
    });

    this.optionalFields.forEach((f) => {
      if (record[f] != null) {
        // Clean array fields in optional fields too
        if (arrayFields.includes(f) && Array.isArray(record[f])) {
          normalized[f] = this._cleanArrayField(record[f]).map((v) => fixText(v));
        } else {
          normalized[f] = record[f];
        }
      }
    });

    if (normalized.url) normalized.url = fixText(normalized.url);
    if (normalized.title) normalized.title = fixText(normalized.title);

    // AUTO-SET dateAddedToBrain for NEW records (don't overwrite existing)
    if (!normalized.dateAddedToBrain || normalized.dateAddedToBrain === "") {
      normalized.dateAddedToBrain = new Date().toISOString().split('T')[0];
    }

    return normalized;
  }

  _getCsvPath() {
    // Single canonical CSV per brain, in brain/ directory
    return path.join(this.brainDir, `${this.brainName}.csv`);
  }

  _getJsonlPath() {
    // Single canonical JSONL per brain, in brain/ directory
    return path.join(this.brainDir, `${this.brainName}.jsonl`);
  }



  _truncateForCsv(value) {
    if (value == null) return "";
    let str = String(value);
    if (str.length <= EXCEL_CELL_LIMIT) return str;

    this.stats.truncated += 1;
    const allowed =
      EXCEL_CELL_LIMIT - TRUNCATION_WARNING.length - 1;
    return `${TRUNCATION_WARNING} ${str.slice(0, Math.max(0, allowed))}`;
  }

  _appendToCsv(csvPath, records) {
    if (!records || !records.length) return;

    const allFields = [...this.fields, ...this.optionalFields];
    const needsHeader = !fs.existsSync(csvPath);
    const lines = [];

    if (needsHeader) {
      lines.push(allFields.join(","));
    }

    for (const rec of records) {
      const row = [];
      for (const f of allFields) {
        let val = rec[f];

        // Handle arrays and objects properly for CSV
        if (Array.isArray(val)) {
          // Join array elements with semicolon (CSV-friendly)
          val = val.join('; ');
        } else if (val !== null && typeof val === "object") {
          // For non-array objects, still use JSON (rare case)
          val = JSON.stringify(val);
        }
        
        val = this._truncateForCsv(val);
        val = String(val).replace(/"/g, '""');
        row.push(`"${val}"`);
      }
      lines.push(row.join(","));
    }

    fs.appendFileSync(csvPath, lines.join("\n") + "\n", "utf8");
  }

  // CRITICAL FIX: Add method to completely rewrite CSV (for updates)
  _rewriteCsv(csvPath, records) {
    if (!records || !records.length) return;

    const allFields = [...this.fields, ...this.optionalFields];
    const lines = [];

    // Always write header
    lines.push(allFields.join(","));

    for (const rec of records) {
      const row = [];
      for (const f of allFields) {
        let val = rec[f];

        // Handle arrays and objects properly for CSV
        if (Array.isArray(val)) {
          // Join array elements with semicolon (CSV-friendly)
          val = val.join('; ');
        } else if (val !== null && typeof val === "object") {
          // For non-array objects, still use JSON (rare case)
          val = JSON.stringify(val);
        }
        
        val = this._truncateForCsv(val);
        val = String(val).replace(/"/g, '""');
        row.push(`"${val}"`);
      }
      lines.push(row.join(","));
    }

    fs.writeFileSync(csvPath, lines.join("\n") + "\n", "utf8");
  }

  _appendToJsonl(jsonlPath, records) {
    if (!records || !records.length) return;
    const lines = records.map((r) => JSON.stringify(r));
    fs.appendFileSync(jsonlPath, lines.join("\n") + "\n", "utf8");
  }

  // CRITICAL FIX: Add method to completely rewrite JSONL (for updates)
  _rewriteJsonl(jsonlPath, records) {
    if (!records || !records.length) return;
    const lines = records.map((r) => JSON.stringify(r));
    fs.writeFileSync(jsonlPath, lines.join("\n") + "\n", "utf8");
  }

  _loadExistingRecords() {
    if (this._existingRecordsLoaded) return;
    const jsonlPath = this._getJsonlPath();
    if (!fs.existsSync(jsonlPath)) {
      this._existingRecordsLoaded = true;
      return;
    }

    const jsonlData = fs.readFileSync(jsonlPath, "utf8");
    jsonlData
      .split("\n")
      .filter(Boolean)
      .forEach((line) => {
        try {
          const rec = JSON.parse(line);
          if (rec.url) {
            this._existingRecordsByUrl.set(rec.url, rec);
            this.existingUrls.add(rec.url);
          }
        } catch {
          // ignore malformed
        }
      });

    this._existingRecordsLoaded = true;
    console.log(`📚 Loaded ${this._existingRecordsByUrl.size} existing records from JSONL`);
  }

  _updateExistingRecord(url, newRecord) {
    const existing = this._existingRecordsByUrl.get(url);
    if (!existing) return false;

    let hasChanges = false;
    
    for (const [key, value] of Object.entries(newRecord)) {
      // NEVER overwrite dateAddedToBrain on updates (preserve original)
      if (key === 'dateAddedToBrain') continue;
      
      if (
        value != null &&
        value !== "" &&
        !(Array.isArray(value) && value.length === 0)
      ) {
        // Check if value actually changed
        if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
          existing[key] = value;
          hasChanges = true;
        }
      }
    }

    // CRITICAL FIX: Track that this record was updated
    if (hasChanges) {
      this._updatedRecords.add(url);
    }

    return hasChanges;
  }
}

// Run ID helpers

function generateRunId() {
  const d = new Date();
  const date = d.toISOString().split("T")[0].replace(/-/g, "");
  const time = d.toTimeString().split(" ")[0].replace(/:/g, "");
  return `${date}_${time}`;
}

function getRunId() {
  if (process.env.MIT_BRAIN_RUN_ID) {
    return process.env.MIT_BRAIN_RUN_ID;
  }
  return generateRunId();
}

module.exports = {
  MITBrainSchema,
  fixText,
  normalizeDate,
  getRunId,
  generateRunId,
};