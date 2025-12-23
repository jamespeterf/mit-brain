#!/usr/bin/env node

// util/preEnrich.js
// Enriches future_event records by:
// 1. Setting publishedAt to current date
// 2. Using AI to scan event URL and populate detailed fullText
//
// Uses MIT_BRAIN environment variable for brain name
// Uses MITBrainSchema for all file operations

import axios from 'axios';
import { load as cheerioLoad } from 'cheerio';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);
const { MITBrainSchema, fixText } = require('../shared/MITBrainSchema.cjs');

// -------- Config --------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAX_EVENTS = process.env.MAX_EVENTS ? parseInt(process.env.MAX_EVENTS) : null;
const DELAY_MS = process.env.DELAY_MS ? parseInt(process.env.DELAY_MS) : 1000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

if (!OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY environment variable not set");
  console.error("Set it with: export OPENAI_API_KEY='sk-...'");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// -------- Stats --------
const stats = {
  total: 0,
  processed: 0,
  skipped: 0,
  urlFetchFailed: 0,
  aiFailed: 0,
  alreadyEnriched: 0,
  testEventsRemoved: 0,
};

// -------- Utilities --------

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchUrlContent(url) {
  if (!url) return null;
  
  try {
    console.log(`  📥 Fetching: ${url}`);
    
    const res = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (s) => s < 400,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MITBrain/1.0)',
      },
    });
    
    const html = res.data;
    const $ = cheerioLoad(html);
    
    // Remove script, style, nav, header, footer
    $('script').remove();
    $('style').remove();
    $('nav').remove();
    $('header').remove();
    $('footer').remove();
    $('.navigation').remove();
    $('.menu').remove();
    $('.sidebar').remove();
    $('.footer').remove();
    
    // Get main content
    let text = $('main').text() || 
               $('article').text() || 
               $('.content').text() ||
               $('.event-details').text() ||
               $('.description').text() ||
               $('body').text();
    
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    // Limit to reasonable size
    if (text.length > 100000) {
      text = text.slice(0, 100000);
    }
    
    if (text.length > 500) {
      console.log(`  ✅ Fetched ${text.length} characters`);
      return text;
    }
    
    console.log(`  ⚠️  Fetched content too short (${text.length} chars)`);
    return null;
    
  } catch (err) {
    console.log(`  ❌ Failed to fetch: ${err.message}`);
    return null;
  }
}

async function extractEventDetailsWithAI(htmlContent, eventTitle, eventSummary) {
  try {
    console.log(`  🤖 Using AI to extract detailed description (${MODEL})...`);
    
    const prompt = `You are analyzing the content of an MIT event webpage. Extract a comprehensive, detailed description of the event that would be useful for MIT Corporate Relations (ILP) members.

EVENT TITLE: ${eventTitle}

BRIEF SUMMARY: ${eventSummary}

WEBPAGE CONTENT:
${htmlContent}

Please provide:
1. A comprehensive description of what this event is about (2-3 paragraphs)
2. Key topics that will be covered
3. Target audience and who should attend
4. Speakers/presenters (if mentioned)
5. Key takeaways or learning objectives
6. Any special requirements or prerequisites
7. Format details (panel, lecture, workshop, etc.)

Write in clear, professional language suitable for corporate executives deciding whether to attend. Focus on value proposition and relevance to industry partners.

Return ONLY the detailed description text, no preamble or meta-commentary.`;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{
        role: 'user',
        content: prompt
      }],
      max_tokens: 2000,
      temperature: 0.3,
    });
    
    const description = completion.choices[0].message.content.trim();
    
    if (description && description.length > 200) {
      console.log(`  ✅ AI generated ${description.length} character description`);
      return description;
    }
    
    console.log(`  ⚠️  AI response too short`);
    return null;
    
  } catch (err) {
    console.log(`  ❌ AI extraction failed: ${err.message}`);
    return null;
  }
}

// -------- Main --------

async function preEnrichEvents() {
  const brainName = process.env.MIT_BRAIN || 'mit_brain';
  
  console.log("============================================================");
  console.log("Pre-Enrichment: Future Events (OpenAI)");
  console.log("============================================================");
  console.log(`Brain name: ${brainName}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Max events to process: ${MAX_EVENTS || 'ALL'}`);
  console.log(`Delay between requests: ${DELAY_MS}ms`);
  console.log("");
  
  // Get file path based on brain name
  const jsonlPath = path.join(process.cwd(), 'output', 'jsonl', `${brainName}.jsonl`);
  
  console.log("📚 Reading existing records...");
  console.log(`   File: ${jsonlPath}`);
  
  if (!fs.existsSync(jsonlPath)) {
    console.error("❌ No existing data found");
    console.error("Run the events scraper first to load events.");
    process.exit(1);
  }
  
  // Read JSONL file (MITBrainSchema doesn't export readJSONL, so we read manually)
  const fileContent = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = fileContent.trim().split('\n').filter(line => line.trim());
  const allRecords = lines.map(line => JSON.parse(line));
  
  console.log(`   Total records: ${allRecords.length}`);
  
  // Filter out test events
  const testEvents = allRecords.filter(r => 
    r.source === "TEST" || 
    r.sourceType === "test" ||
    (r.url && r.url.includes('test.mit.edu'))
  );
  
  const cleanRecords = allRecords.filter(r => 
    r.source !== "TEST" && 
    r.sourceType !== "test" &&
    (!r.url || !r.url.includes('test.mit.edu'))
  );
  
  if (testEvents.length > 0) {
    console.log(`   🗑️  Filtering out ${testEvents.length} test events`);
    stats.testEventsRemoved = testEvents.length;
  }
  
  // Separate by record type
  const futureEvents = cleanRecords.filter(r => r.kind === "future_event");
  const otherRecords = cleanRecords.filter(r => r.kind !== "future_event");
  
  console.log(`   Future events: ${futureEvents.length}`);
  console.log(`   Other records: ${otherRecords.length}`);
  console.log("");
  
  if (futureEvents.length === 0) {
    console.log("✅ No future events to enrich");
    return;
  }
  
  // Current date for publishedAt
  const currentDate = new Date().toISOString().split('T')[0];
  
  // Process events
  console.log("🔄 Processing events...\n");
  
  const enrichedEvents = [];
  
  for (let i = 0; i < futureEvents.length; i++) {
    const event = futureEvents[i];
    stats.total++;
    
    // Check if we've hit max
    if (MAX_EVENTS && stats.processed >= MAX_EVENTS) {
      console.log(`\n⏸️  Reached MAX_EVENTS limit (${MAX_EVENTS})`);
      // Add remaining events unchanged
      for (let j = i; j < futureEvents.length; j++) {
        enrichedEvents.push(futureEvents[j]);
      }
      break;
    }
    
    console.log(`\n[${i + 1}/${futureEvents.length}] "${event.title}"`);
    console.log(`  URL: ${event.url || 'NO URL'}`);
    
    // Check if already enriched
    if (event.fullText && event.fullText.length > 500) {
      console.log(`  ⏭️  Already enriched (${event.fullText.length} chars) - skipping`);
      stats.alreadyEnriched++;
      enrichedEvents.push(event);
      continue;
    }
    
    // Skip if no URL or synthetic URL
    if (!event.url || event.url.startsWith('https://events.mit.edu/')) {
      console.log(`  ⏭️  Synthetic URL - skipping`);
      stats.skipped++;
      enrichedEvents.push(event);
      continue;
    }
    
    // Fetch URL content
    const htmlContent = await fetchUrlContent(event.url);
    
    if (!htmlContent) {
      console.log(`  ⏭️  Couldn't fetch content - keeping original`);
      stats.urlFetchFailed++;
      enrichedEvents.push(event);
      await delay(DELAY_MS);
      continue;
    }
    
    // Extract details with AI
    const detailedDescription = await extractEventDetailsWithAI(
      htmlContent,
      event.title,
      event.summary || ''
    );
    
    if (!detailedDescription) {
      console.log(`  ⏭️  AI extraction failed - keeping original`);
      stats.aiFailed++;
      enrichedEvents.push(event);
      await delay(DELAY_MS);
      continue;
    }
    
    // Create enriched event
    const enrichedEvent = {
      ...event,
      publishedAt: currentDate,
      fullText: fixText(detailedDescription),
    };
    
    enrichedEvents.push(enrichedEvent);
    stats.processed++;
    
    console.log(`  ✅ Enriched successfully`);
    
    // Rate limiting
    await delay(DELAY_MS);
  }
  
  // Write back using MITBrainSchema
  console.log("\n============================================================");
  console.log("💾 Writing records via MITBrainSchema...");
  
  // Create schema instance (will use MIT_BRAIN env var)
  const schema = new MITBrainSchema();
  
  // CRITICAL: Tell schema we're providing all records explicitly
  // Don't let it auto-load from file (which might include test events)
  schema._existingRecordsLoaded = true;
  schema._existingRecordsByUrl.clear();
  schema.existingUrls.clear();
  
  // Write all clean records
  const allCleanRecords = [...otherRecords, ...enrichedEvents];
  
  console.log(`   Writing ${allCleanRecords.length} records...`);
  console.log(`     - Other records: ${otherRecords.length}`);
  console.log(`     - Events: ${enrichedEvents.length}`);
  
  schema.writeBatch(allCleanRecords);
  
  console.log(`   Flushing to disk...`);
  schema.flush();
  
  console.log("   ✅ Write complete");
  
  // Print statistics
  console.log("\n============================================================");
  console.log("STATISTICS");
  console.log("============================================================");
  if (stats.testEventsRemoved > 0) {
    console.log(`Test events removed:          ${stats.testEventsRemoved}`);
  }
  console.log(`Total future events:          ${stats.total}`);
  console.log(`Successfully enriched:        ${stats.processed}`);
  console.log(`Already enriched (skipped):   ${stats.alreadyEnriched}`);
  console.log(`No URL (skipped):             ${stats.skipped}`);
  console.log(`URL fetch failed:             ${stats.urlFetchFailed}`);
  console.log(`AI extraction failed:         ${stats.aiFailed}`);
  console.log(`Total records written:        ${allCleanRecords.length}`);
  console.log("============================================================\n");
}

// Run
preEnrichEvents().catch(err => {
  console.error("\n❌ Fatal error:", err);
  console.error(err.stack);
  process.exit(1);
});