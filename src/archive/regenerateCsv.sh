#!/bin/bash

# ============================================================
# Regenerate CSV from JSONL (Fix Encoding Issues)
# ============================================================
# This script regenerates the CSV file from the JSONL file
# using the fixed MITBrainSchema that properly handles arrays
#
# Run from: src/ directory
# ============================================================

# Configuration
MIT_BRAIN=${MIT_BRAIN:-"mit_brain_test17"}
BRAIN_DIR=${BRAIN_DIR:-"../brain"}

JSONL_FILE="${BRAIN_DIR}/${MIT_BRAIN}.jsonl"
CSV_FILE="${BRAIN_DIR}/${MIT_BRAIN}.csv"
CSV_BACKUP="${BRAIN_DIR}/${MIT_BRAIN}_old.csv"

echo "============================================================"
echo "CSV Regeneration Script"
echo "============================================================"
echo "Brain: $MIT_BRAIN"
echo "JSONL: $JSONL_FILE"
echo "CSV: $CSV_FILE"
echo "============================================================"
echo ""

# Check if JSONL exists
if [ ! -f "$JSONL_FILE" ]; then
    echo "❌ Error: JSONL file not found: $JSONL_FILE"
    exit 1
fi

# Backup existing CSV
if [ -f "$CSV_FILE" ]; then
    echo "📦 Backing up existing CSV..."
    cp "$CSV_FILE" "$CSV_BACKUP"
    echo "   Backup saved to: $CSV_BACKUP"
    echo ""
fi

# Delete corrupted CSV
if [ -f "$CSV_FILE" ]; then
    echo "🗑️  Deleting corrupted CSV..."
    rm "$CSV_FILE"
    echo ""
fi

# Count records in JSONL
RECORD_COUNT=$(wc -l < "$JSONL_FILE")
echo "📊 JSONL contains: $RECORD_COUNT records"
echo ""

# Regenerate CSV from JSONL using fixed schema
echo "🔄 Regenerating CSV from JSONL..."
echo "   This will use the fixed encoding (arrays joined with ';')"
echo ""

node << 'NODEJS'
const { MITBrainSchema } = require('./shared/MITBrainSchema.cjs');
const fs = require('fs');
const path = require('path');

const brainName = process.env.MIT_BRAIN || 'mit_brain_test17';
const brainDir = process.env.BRAIN_DIR || path.join(__dirname, '..', 'brain');
const jsonlPath = path.join(brainDir, `${brainName}.jsonl`);
const csvPath = path.join(brainDir, `${brainName}.csv`);

console.log('Loading records from JSONL...');
const jsonlData = fs.readFileSync(jsonlPath, 'utf8');
const records = jsonlData
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line));

console.log(`Loaded ${records.length} records`);
console.log('');

// Create schema instance
const schema = new MITBrainSchema();

// Write CSV directly using the internal method
console.log('Writing CSV with fixed encoding...');
schema._rewriteCsv(csvPath, records);

console.log('✅ CSV regenerated successfully!');
console.log('');

// Verify
const csvContent = fs.readFileSync(csvPath, 'utf8');
const csvLines = csvContent.trim().split('\n');
const csvCount = csvLines.length - 1; // Subtract header

console.log('Verification:');
console.log(`  JSONL records: ${records.length}`);
console.log(`  CSV records: ${csvCount}`);
console.log(`  Match: ${records.length === csvCount ? '✅ Yes' : '❌ No'}`);

// Show sample of fixed data
console.log('');
console.log('Sample of fixed data (first non-header row):');
const sampleRow = csvLines[1];
const fields = sampleRow.split(',');

// Find tags field (index 9) and show it
if (fields.length > 9) {
  console.log(`  tags field: ${fields[9].substring(0, 100)}...`);
}

// Find mitGroups field (index 11) and show it  
if (fields.length > 11) {
  console.log(`  mitGroups field: ${fields[11].substring(0, 100)}...`);
}
NODEJS

echo ""
echo "============================================================"
echo "✅ CSV Regeneration Complete!"
echo "============================================================"
echo ""
echo "Next steps:"
echo "1. Open the CSV in Excel/Sheets to verify arrays look correct"
echo "2. Arrays should now appear as: 'value1; value2; value3'"
echo "3. No more escaped quotes: [\\\"value\\\"]"
echo ""
echo "Files:"
echo "  New CSV: $CSV_FILE"
echo "  Backup: $CSV_BACKUP"
echo "  Source: $JSONL_FILE"
echo ""
echo "If everything looks good, you can delete the backup:"
echo "  rm $CSV_BACKUP"
echo "============================================================"