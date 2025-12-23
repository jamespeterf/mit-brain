#!/usr/bin/env node

// Clean corrupted array fields in JSONL file
// Recursively un-stringify array elements until they're clean

const fs = require('fs');
const path = require('path');

const brainDir = process.env.BRAIN_DIR || path.join(__dirname, '..', 'brain');
const brainName = process.env.MIT_BRAIN || 'mit_brain_test17';
const jsonlPath = path.join(brainDir, `${brainName}.jsonl`);
const backupPath = path.join(brainDir, `${brainName}_backup_${Date.now()}.jsonl`);
const cleanPath = path.join(brainDir, `${brainName}_clean.jsonl`);

console.log('JSONL Array Field Cleaner');
console.log('=========================\n');
console.log(`Input:  ${jsonlPath}`);
console.log(`Backup: ${backupPath}`);
console.log(`Output: ${cleanPath}\n`);

// Array fields that need cleaning
const arrayFields = [
  'tags', 'authors', 'mitGroups', 'mitAuthors', 'speakers', 
  'ilpKeywords', 'investors', 'leadInvestors', 'mitInvestors',
  'founders', 'mitFounders', 'keyExecutives', 'industries', 'contacts'
];

// Recursively un-stringify until we get actual values
function cleanArrayField(arr) {
  if (!Array.isArray(arr)) return arr;
  
  return arr.map(item => {
    if (typeof item !== 'string') return item;
    
    // Try to parse as JSON repeatedly until we can't anymore
    let current = item;
    let maxAttempts = 20; // Prevent infinite loop
    
    while (maxAttempts > 0) {
      try {
        const parsed = JSON.parse(current);
        
        // If it's still a string, keep going
        if (typeof parsed === 'string') {
          current = parsed;
          maxAttempts--;
          continue;
        }
        
        // If it's an array, recursively clean it
        if (Array.isArray(parsed)) {
          return cleanArrayField(parsed);
        }
        
        // Otherwise return what we got
        return parsed;
      } catch (e) {
        // Can't parse anymore - this is the final value
        return current;
      }
    }
    
    return current;
  }).flat(Infinity); // Flatten any nested arrays
}

// Read JSONL
console.log('Reading JSONL file...');
const content = fs.readFileSync(jsonlPath, 'utf8');
const lines = content.split('\n').filter(Boolean);
console.log(`Found ${lines.length} records\n`);

// Backup original
console.log('Creating backup...');
fs.copyFileSync(jsonlPath, backupPath);
console.log(`✅ Backup saved\n`);

// Clean records
console.log('Cleaning records...');
let cleanedCount = 0;
const cleanedLines = [];

lines.forEach((line, idx) => {
  if (idx % 1000 === 0) {
    process.stdout.write(`\rProcessed ${idx}/${lines.length} records...`);
  }
  
  try {
    const record = JSON.parse(line);
    let wasModified = false;
    
    // Clean each array field
    arrayFields.forEach(field => {
      if (Array.isArray(record[field]) && record[field].length > 0) {
        const original = JSON.stringify(record[field]);
        record[field] = cleanArrayField(record[field]);
        const cleaned = JSON.stringify(record[field]);
        
        if (original !== cleaned) {
          wasModified = true;
        }
      }
    });
    
    if (wasModified) {
      cleanedCount++;
    }
    
    cleanedLines.push(JSON.stringify(record));
  } catch (e) {
    console.error(`\nError processing record ${idx}: ${e.message}`);
    cleanedLines.push(line); // Keep original if can't parse
  }
});

console.log(`\rProcessed ${lines.length}/${lines.length} records\n`);
console.log(`Records modified: ${cleanedCount}\n`);

// Write cleaned JSONL
console.log('Writing cleaned JSONL...');
fs.writeFileSync(cleanPath, cleanedLines.join('\n') + '\n', 'utf8');
console.log(`✅ Clean file written\n`);

// Verify
console.log('Verification:');
console.log('=============\n');

const verifyContent = fs.readFileSync(cleanPath, 'utf8');
const verifyLines = verifyContent.split('\n').filter(Boolean);
const firstRecord = JSON.parse(verifyLines[0]);

console.log('First record sample:');
arrayFields.forEach(field => {
  if (firstRecord[field] && Array.isArray(firstRecord[field]) && firstRecord[field].length > 0) {
    const value = firstRecord[field];
    const firstItem = value[0];
    const itemType = typeof firstItem;
    
    console.log(`  ${field}:`);
    console.log(`    Type: array of ${itemType}`);
    console.log(`    First item: ${JSON.stringify(firstItem).substring(0, 80)}`);
    
    if (itemType === 'string' && firstItem.startsWith('[')) {
      console.log(`    ⚠️  Still looks stringified!`);
    } else {
      console.log(`    ✅ Looks clean!`);
    }
  }
});

console.log('\n=========================');
console.log('Cleaning Complete!');
console.log('=========================\n');
console.log('Next steps:');
console.log('1. Review the cleaned file to make sure it looks good');
console.log('2. If good, replace the original:');
console.log(`   mv ${cleanPath} ${jsonlPath}`);
console.log('3. Regenerate CSV from clean JSONL:');
console.log('   cd src && ./regenerateCSV.sh');
console.log('\nIf something went wrong:');
console.log('   Restore from backup:');
console.log(`   cp ${backupPath} ${jsonlPath}`);
