#!/usr/bin/env node

// =============================================================================
// backfillDateAddedToBrain.cjs
// 
// Adds dateAddedToBrain field to all existing records in JSONL and CSV
// Sets to yesterday's date (2024-12-21) as requested
// =============================================================================

const fs = require('fs');
const path = require('path');

// Configuration
const BRAIN_NAME = process.env.MIT_BRAIN || 'mit_brain_test17';
//const BRAIN_DIR = process.env.BRAIN_DIR || path.join(__dirname, '..', 'brain');
const BRAIN_DIR = 'brain';
const BACKFILL_DATE = '2025-12-21'; // Yesterday as requested

const JSONL_PATH = path.join(BRAIN_DIR, `${BRAIN_NAME}.jsonl`);
const CSV_PATH = path.join(BRAIN_DIR, `${BRAIN_NAME}.csv`);

console.log('\n' + '='.repeat(70));
console.log('BACKFILL dateAddedToBrain FIELD');
console.log('='.repeat(70));
console.log(`Brain: ${BRAIN_NAME}`);
console.log(`JSONL: ${JSONL_PATH}`);
console.log(`CSV:   ${CSV_PATH}`);
console.log(`Backfill date: ${BACKFILL_DATE}`);
console.log('='.repeat(70) + '\n');

// =============================================================================
// Step 1: Backup Files
// =============================================================================

function backupFiles() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  
  console.log('📦 Creating backups...');
  
  if (fs.existsSync(JSONL_PATH)) {
    const backupJsonl = `${JSONL_PATH}.backup-${timestamp}`;
    fs.copyFileSync(JSONL_PATH, backupJsonl);
    console.log(`   ✅ JSONL backed up to: ${backupJsonl}`);
  }
  
  if (fs.existsSync(CSV_PATH)) {
    const backupCsv = `${CSV_PATH}.backup-${timestamp}`;
    fs.copyFileSync(CSV_PATH, backupCsv);
    console.log(`   ✅ CSV backed up to: ${backupCsv}`);
  }
  
  console.log('');
}

// =============================================================================
// Step 2: Update JSONL
// =============================================================================

function updateJsonl() {
  console.log('📝 Processing JSONL...');
  
  if (!fs.existsSync(JSONL_PATH)) {
    console.log('   ⚠️  JSONL file not found, skipping');
    return 0;
  }
  
  const content = fs.readFileSync(JSONL_PATH, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  
  console.log(`   Found ${lines.length} records`);
  
  let updated = 0;
  let alreadyHad = 0;
  
  const updatedLines = lines.map(line => {
    try {
      const record = JSON.parse(line);
      
      // If record already has dateAddedToBrain, keep it
      //if (record.dateAddedToBrain) {
      //  alreadyHad++;
      //  return line;
      //}
      
      // Add dateAddedToBrain
      record.dateAddedToBrain = BACKFILL_DATE;
      updated++;
      
      return JSON.stringify(record);
    } catch (err) {
      console.warn(`   ⚠️  Error parsing line, keeping as-is:`, err.message);
      return line;
    }
  });
  
  // Write updated JSONL
  fs.writeFileSync(JSONL_PATH, updatedLines.join('\n') + '\n', 'utf8');
  
  console.log(`   ✅ Updated ${updated} records`);
  console.log(`   ℹ️  ${alreadyHad} records already had dateAddedToBrain`);
  console.log('');
  
  return updated;
}

// =============================================================================
// Step 3: Update CSV
// =============================================================================

function updateCsv() {
  console.log('📊 Processing CSV...');
  
  if (!fs.existsSync(CSV_PATH)) {
    console.log('   ⚠️  CSV file not found, skipping');
    return 0;
  }
  
  const content = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = content.split('\n');
  
  if (lines.length < 2) {
    console.log('   ⚠️  CSV has no data rows, skipping');
    return 0;
  }
  
  // Parse header
  const headerLine = lines[0];
  const headers = headerLine.split(',').map(h => h.replace(/^"|"$/g, '').trim());
  
  console.log(`   Found ${headers.length} columns, ${lines.length - 1} data rows`);
  
  // Check if dateAddedToBrain column exists
  let dateAddedIndex = headers.indexOf('dateAddedToBrain');
  
  if (dateAddedIndex === -1) {
    // Add column to header
    console.log('   Adding dateAddedToBrain column to header...');
    headers.push('dateAddedToBrain');
    dateAddedIndex = headers.length - 1;
  } else {
    console.log(`   dateAddedToBrain column already exists at index ${dateAddedIndex}`);
  }
  
  // Build new CSV
  const newLines = [headers.map(h => `"${h}"`).join(',')];
  
  let updated = 0;
  let alreadyHad = 0;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    try {
      // Parse CSV row (handle quoted fields with commas)
      const row = [];
      let current = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        
        if (char === '"') {
          if (inQuotes && line[j + 1] === '"') {
            current += '"';
            j++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          row.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      row.push(current.trim());
      
      // Ensure row has enough columns
      while (row.length < headers.length) {
        row.push('');
      }
      
      // Check if dateAddedToBrain is already set
      const existingValue = row[dateAddedIndex]?.replace(/^"|"$/g, '').trim();
      
      //if (existingValue && existingValue !== '' && existingValue !== '""') {
      //  alreadyHad++;
      //} else {
        row[dateAddedIndex] = BACKFILL_DATE;
        updated++;
      //}
      
      // Quote all fields and join
      const newRow = row.map(val => {
        const cleaned = String(val).replace(/^"|"$/g, '');
        const escaped = cleaned.replace(/"/g, '""');
        return `"${escaped}"`;
      });
      
      newLines.push(newRow.join(','));
      
    } catch (err) {
      console.warn(`   ⚠️  Error processing row ${i}:`, err.message);
      newLines.push(line); // Keep original line
    }
  }
  
  // Write updated CSV
  fs.writeFileSync(CSV_PATH, newLines.join('\n') + '\n', 'utf8');
  
  console.log(`   ✅ Updated ${updated} rows`);
  console.log(`   ℹ️  ${alreadyHad} rows already had dateAddedToBrain`);
  console.log('');
  
  return updated;
}

// =============================================================================
// Step 4: Verify
// =============================================================================

function verify() {
  console.log('🔍 Verifying update...');
  
  // Check JSONL
  if (fs.existsSync(JSONL_PATH)) {
    const content = fs.readFileSync(JSONL_PATH, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const sample = lines.slice(0, 3).map(l => {
      try {
        const rec = JSON.parse(l);
        return `   ${rec.title?.substring(0, 50)}... => ${rec.dateAddedToBrain}`;
      } catch {
        return '   [parse error]';
      }
    });
    
    console.log('\n   Sample JSONL records:');
    sample.forEach(s => console.log(s));
  }
  
  // Check CSV
  if (fs.existsSync(CSV_PATH)) {
    const content = fs.readFileSync(CSV_PATH, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
    const dateAddedIndex = headers.indexOf('dateAddedToBrain');
    
    console.log(`\n   CSV dateAddedToBrain column index: ${dateAddedIndex}`);
    
    if (dateAddedIndex >= 0 && lines.length > 1) {
      const sample = lines.slice(1, 4).map(line => {
        const row = line.split(',');
        const value = row[dateAddedIndex]?.replace(/^"|"$/g, '').trim();
        return `   ${value}`;
      });
      
      console.log('   Sample CSV values:');
      sample.forEach(s => console.log(s));
    }
  }
  
  console.log('');
}

// =============================================================================
// Main
// =============================================================================

function main() {
  try {
    // Step 1: Backup
    backupFiles();
    
    // Step 2: Update JSONL
    const jsonlUpdated = updateJsonl();
    
    // Step 3: Update CSV
    const csvUpdated = updateCsv();
    
    // Step 4: Verify
    verify();
    
    // Summary
    console.log('='.repeat(70));
    console.log('✅ MIGRATION COMPLETE');
    console.log('='.repeat(70));
    console.log(`JSONL records updated: ${jsonlUpdated}`);
    console.log(`CSV rows updated: ${csvUpdated}`);
    console.log(`Backfill date: ${BACKFILL_DATE}`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Replace old MITBrainSchema.cjs with MITBrainSchema-UPDATED.cjs');
    console.log('2. Update server.js alert logic to use dateAddedToBrain');
    console.log('3. Test with a scraper to ensure new records get today\'s date');
    console.log('='.repeat(70) + '\n');
    
  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { backupFiles, updateJsonl, updateCsv, verify };
