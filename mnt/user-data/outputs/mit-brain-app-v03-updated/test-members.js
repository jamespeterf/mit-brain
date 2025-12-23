// test-members.js
// Quick test to verify member CSV loading works

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) {
    console.warn("⚠️ CSV is empty");
    return { header: [], rows: [] };
  }

  const header = lines[0].split(",").map((h) => h.trim());
  console.log(`📋 CSV header (${header.length} columns):`, header);
  
  const rows = lines.slice(1).map((line, idx) => {
    const cols = line.split(",");
    const row = {};
    header.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    return row;
  });

  console.log(`📊 Parsed ${rows.length} rows from CSV`);
  return { header, rows };
}

async function testMembers() {
  const membersCsvPath = path.join(__dirname, "member-profiles.csv");
  console.log(`📂 Loading members from: ${membersCsvPath}`);
  
  try {
    const content = await fs.readFile(membersCsvPath, "utf8");
    console.log(`✅ Read CSV file (${content.length} bytes)`);
    
    const { rows } = parseCsv(content);

    const members = rows
      .map((row, idx) => {
        const memberName = (row["Member"] || "").trim();
        if (!memberName) {
          console.warn(`⚠️ Row ${idx + 2} skipped: no member name`);
          return null;
        }

        const commonName1 = (row["Common Name 1"] || "").trim();
        const commonName2 = (row["Common Name 2"] || "").trim();

        const phrases = [];
        for (let i = 1; i <= 10; i++) {
          const v = (row[`Key Phrase ${i}`] || "").trim();
          if (v) phrases.push(v);
        }

        return {
          memberName,
          commonName1,
          commonName2,
          phrases,
        };
      })
      .filter(Boolean);

    console.log(`\n✅ Successfully loaded ${members.length} members\n`);
    
    // Display first 3 members as examples
    members.slice(0, 3).forEach((m, i) => {
      console.log(`${i + 1}. ${m.memberName}`);
      console.log(`   Common names: ${m.commonName1 || '(none)'}, ${m.commonName2 || '(none)'}`);
      console.log(`   Key phrases (${m.phrases.length}): ${m.phrases.slice(0, 5).join(', ')}${m.phrases.length > 5 ? '...' : ''}`);
      console.log();
    });
    
    if (members.length > 3) {
      console.log(`... and ${members.length - 3} more members`);
    }
    
    return members;
  } catch (err) {
    console.error("❌ Error loading member-profiles.csv:", err.message);
    console.error("   Path:", membersCsvPath);
    return [];
  }
}

// Run the test
testMembers();
