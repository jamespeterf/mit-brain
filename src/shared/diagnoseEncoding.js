#!/usr/bin/env node

// Check JSONL encoding to diagnose the issue

const fs = require('fs');
const path = require('path');

const brainDir = process.env.BRAIN_DIR || path.join(__dirname, '..', 'brain');
const brainName = process.env.MIT_BRAIN || 'mit_brain_test17';
const jsonlPath = path.join(brainDir, `${brainName}.jsonl`);

console.log('Checking JSONL encoding...');
console.log(`File: ${jsonlPath}\n`);

if (!fs.existsSync(jsonlPath)) {
  console.error('JSONL file not found!');
  process.exit(1);
}

const content = fs.readFileSync(jsonlPath, 'utf8');
const lines = content.split('\n').filter(Boolean);

console.log(`Total records: ${lines.length}\n`);

// Check first record
const firstRecord = JSON.parse(lines[0]);

console.log('First record field types:');
console.log('========================\n');

const arrayFields = ['tags', 'authors', 'mitGroups', 'mitAuthors', 'speakers', 'ilpKeywords'];

arrayFields.forEach(field => {
  if (firstRecord[field] !== undefined) {
    const value = firstRecord[field];
    const type = Array.isArray(value) ? 'array' : typeof value;
    
    console.log(`${field}:`);
    console.log(`  Type: ${type}`);
    console.log(`  Value: ${JSON.stringify(value).substring(0, 200)}`);
    
    if (typeof value === 'string') {
      console.log(`  ❌ PROBLEM: This should be an array, not a string!`);
      
      // Try to parse it
      try {
        const parsed = JSON.parse(value);
        console.log(`  Can be parsed to: ${JSON.stringify(parsed).substring(0, 100)}`);
      } catch (e) {
        console.log(`  Cannot parse as JSON`);
      }
    } else if (Array.isArray(value)) {
      console.log(`  ✅ OK: Properly stored as array`);
      if (value.length > 0 && typeof value[0] === 'string' && value[0].startsWith('[')) {
        console.log(`  ⚠️  WARNING: Array contains stringified arrays!`);
      }
    }
    console.log('');
  }
});

// Check a random record in the middle
if (lines.length > 100) {
  const midRecord = JSON.parse(lines[Math.floor(lines.length / 2)]);
  
  console.log('\n\nMiddle record check:');
  console.log('===================\n');
  
  arrayFields.forEach(field => {
    if (midRecord[field] !== undefined) {
      const value = midRecord[field];
      const type = Array.isArray(value) ? 'array' : typeof value;
      console.log(`${field}: ${type} - ${JSON.stringify(value).substring(0, 100)}`);
    }
  });
}

console.log('\n\nConclusion:');
console.log('===========\n');
console.log('If you see "PROBLEM" above, the issue is:');
console.log('1. A scraper is JSON.stringify()ing arrays before passing to schema.write()');
console.log('2. OR an enricher is doing it');
console.log('\nIf all fields show "OK", then the problem is only in CSV export.');