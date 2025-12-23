#!/usr/bin/env node

// clearLast466Direct.js - Directly edit JSONL to clear enrichment

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('============================================================');
console.log('Direct JSONL Edit: Clear enrichment for last 466 records');
console.log('============================================================\n');

const brainDir = process.env.BRAIN_DIR || path.join(__dirname, '..', '..', 'brain');
const brainName = process.env.MIT_BRAIN || 'mit_brain_test17';
const jsonlPath = path.join(brainDir, `${brainName}.jsonl`);
const backupPath = path.join(brainDir, `${brainName}_backup_before_clear_${Date.now()}.jsonl`);

console.log(`Reading: ${jsonlPath}\n`);

// Backup first
console.log('📦 Creating backup...');
fs.copyFileSync(jsonlPath, backupPath);
console.log(`   Saved to: ${backupPath}\n`);

// Read all records
const content = fs.readFileSync(jsonlPath, 'utf8');
const lines = content.split('\n').filter(Boolean);
const records = lines.map(line => JSON.parse(line));

console.log(`📚 Total records: ${records.length}`);
console.log(`🎯 Clearing last 466 records\n`);

// Get indices for last 466
const startIdx = records.length - 466;
let clearedCount = 0;

// Clear enrichment for last 466
for (let i = startIdx; i < records.length; i++) {
  if (records[i].ilpSummary || (records[i].ilpKeywords && records[i].ilpKeywords.length > 0)) {
    records[i].ilpSummary = '';
    records[i].ilpKeywords = [];
    clearedCount++;
    
    if (clearedCount <= 5) {
      console.log(`  ✓ Cleared: ${records[i].title?.substring(0, 60)}...`);
    }
  }
}

if (clearedCount > 5) {
  console.log(`  ... and ${clearedCount - 5} more`);
}

console.log(`\n📊 Cleared ${clearedCount} records\n`);

// Write back to JSONL
console.log('💾 Writing updated JSONL...');
const newContent = records.map(r => JSON.stringify(r)).join('\n') + '\n';
fs.writeFileSync(jsonlPath, newContent, 'utf8');

console.log('✅ JSONL updated!\n');

// Now regenerate CSV from the clean JSONL
console.log('📊 Regenerating CSV from JSONL...');
console.log('   (This will sync CSV with the cleared JSONL)\n');

// Use regenerateCSV logic
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { MITBrainSchema } = require('../shared/MITBrainSchema.cjs');

const schema = new MITBrainSchema();
const csvPath = path.join(brainDir, `${brainName}.csv`);

// Rewrite CSV from the updated records
schema._rewriteCsv(csvPath, records);

console.log('✅ CSV regenerated!\n');
console.log('============================================================');
console.log('Complete!');
console.log('============================================================');
console.log(`\nBackup: ${backupPath}`);
console.log(`Updated: ${jsonlPath}`);
console.log(`Updated: ${csvPath}`);
console.log(`\nCleared enrichment for ${clearedCount} records (last 466)`);
console.log(`\nNext step: Run enrichment`);
console.log(`  cd src/`);
console.log(`  node enrichers/enrichIlpFields.js\n`);