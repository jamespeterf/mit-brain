#!/usr/bin/env node

// scrapers/scrapeNewsFromRss.js
//
// Scrape MIT News articles from multiple RSS feeds using MITBrainSchema

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { load as cheerioLoad } from 'cheerio';
import xml2js from 'xml2js';
import { createRequire } from 'module';

// Get current file's directory (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import CommonJS module (MITBrainSchema uses module.exports)
const require = createRequire(import.meta.url);
const { MITBrainSchema, fixText, normalizeDate, getRunId } = require("../shared/MITBrainSchema.cjs");

// ==================================================
// Config
// ==================================================

const MIT_NEWS_RSS_INDEX_URL = "https://news.mit.edu/rss";

const START_DATE = process.env.START_DATE ? new Date(process.env.START_DATE) : null;
if (START_DATE && START_DATE.toString() === "Invalid Date") {
  console.warn(
    `WARNING: START_DATE "${process.env.START_DATE}" is invalid. Ignoring date filter.`
  );
}

const MAX_NEWS = process.env.MAX_NEWS ? parseInt(process.env.MAX_NEWS, 10) : null;

// ==================================================
// Discover RSS feeds from index page
// ==================================================

async function discoverRssFeeds() {
  console.log(`Discovering RSS feeds from: ${MIT_NEWS_RSS_INDEX_URL}`);

  let res;
  try {
    res = await axios.get(MIT_NEWS_RSS_INDEX_URL, { timeout: 30000 });
  } catch (err) {
    console.error(`ERROR: Failed to fetch RSS index page: ${err.message}`);
    return [];
  }

  const $ = cheerioLoad(res.data);
  const feeds = [];

  // Main feed
  feeds.push({
    name: "Main Feed",
    url: "https://news.mit.edu/rss/feed"
  });

  // Extract all RSS feed links
  $('a[href*="/rss/"]').each((i, el) => {
    const href = $(el).attr('href');
    const name = fixText($(el).text());
    
    if (href && name) {
      const fullUrl = href.startsWith('http') 
        ? href 
        : `https://news.mit.edu${href}`;
      feeds.push({ name, url: fullUrl });
    }
  });

  // Links ending in .xml
  $('a[href$=".xml"]').each((i, el) => {
    const href = $(el).attr('href');
    const name = fixText($(el).text());
    
    if (href && name) {
      const fullUrl = href.startsWith('http') 
        ? href 
        : `https://news.mit.edu${href}`;
      feeds.push({ name, url: fullUrl });
    }
  });

  // Deduplicate
  const uniqueFeeds = [];
  const seenUrls = new Set();
  
  for (const feed of feeds) {
    if (!seenUrls.has(feed.url)) {
      seenUrls.add(feed.url);
      uniqueFeeds.push(feed);
    }
  }

  console.log(`Found ${uniqueFeeds.length} unique RSS feeds`);
  return uniqueFeeds;
}

// ==================================================
// RSS scraper
// ==================================================

async function fetchRssItems(feedUrl, feedName) {
  console.log(`\nFetching RSS feed: ${feedName}`);
  console.log(`URL: ${feedUrl}`);

  let res;
  try {
    res = await axios.get(feedUrl, { timeout: 30000 });
  } catch (err) {
    console.error(`ERROR: Failed to fetch RSS: ${err.message}`);
    return [];
  }

  let xml = res.data;

  // Sanitize bare '&'
  xml = xml.replace(/&(?![a-zA-Z]+;|#[0-9]+;|#x[0-9a-fA-F]+;)/g, "&amp;");

  const parser = new xml2js.Parser({
    explicitArray: false,
    strict: false
  });

  let feed;
  try {
    feed = await parser.parseStringPromise(xml);
  } catch (err) {
    console.error(`ERROR: Failed to parse RSS XML: ${err.message}`);
    return [];
  }

  // Find channel
  let channel = null;
  if (feed.rss && feed.rss.channel) {
    channel = feed.rss.channel;
  } else if (feed.RSS && feed.RSS.channel) {
    channel = feed.RSS.channel;
  } else if (feed.RSS && feed.RSS.CHANNEL) {
    channel = feed.RSS.CHANNEL;
  } else if (feed.feed) {
    channel = feed.feed;
  }

  if (!channel) {
    console.warn(`RSS parse succeeded but channel is missing for ${feedName}`);
    return [];
  }

  let items = [];
  if (channel.item) {
    items = Array.isArray(channel.item) ? channel.item : [channel.item];
  } else if (channel.ITEM) {
    items = Array.isArray(channel.ITEM) ? channel.ITEM : [channel.ITEM];
  } else if (channel.entry) {
    items = Array.isArray(channel.entry) ? channel.entry : [channel.entry];
  }

  console.log(`  RSS returned ${items.length} items.`);

  // Map items
  let mapped = items.map((item) => {
    const title = fixText(item.title || item.TITLE || "");
    const url = (item.link || item.LINK || "").trim();

    const rawDate =
      item.pubDate ||
      item.PUBDATE ||
      item["dc:date"] ||
      item["dc:date."] ||
      item.updated ||
      "";

    const summaryHtml = item.description || item.DESCRIPTION || item.summary || "";
    const $ = cheerioLoad(summaryHtml);
    const summary = fixText($.text());

    // Extract author and mitGroup
    let author = "";
    let mitGroup = "";
    
    let creatorText = "";
    if (item["dc:creator"]) {
      creatorText = fixText(item["dc:creator"]);
    } else if (item["DC:CREATOR"]) {
      creatorText = fixText(item["DC:CREATOR"]);
    } else if (item.creator) {
      creatorText = fixText(item.creator);
    } else if (item.CREATOR) {
      creatorText = fixText(item.CREATOR);
    }
    
    if (creatorText.includes(" | ")) {
      const parts = creatorText.split(" | ");
      author = parts[0].trim();
      mitGroup = parts[1].trim();
    } else if (creatorText) {
      mitGroup = creatorText;
    }

    // Extract tags
    const tags = [];
    const categoryData = item.category || item.CATEGORY;
    
    if (categoryData) {
      if (Array.isArray(categoryData)) {
        categoryData.forEach(cat => {
          const tagText = typeof cat === 'string' ? cat : (cat._ || cat);
          if (tagText) tags.push(fixText(tagText));
        });
      } else {
        const tagText = typeof categoryData === 'string' ? categoryData : (categoryData._ || categoryData);
        if (tagText) tags.push(fixText(tagText));
      }
    }

    return {
      title,
      url,
      rawDate,
      summary,
      author,
      mitGroup,
      tags,
      feedName
    };
  });

  // Filter by date
  if (START_DATE && START_DATE.toString() !== "Invalid Date") {
    mapped = mapped.filter((it) => {
      if (!it.rawDate) return true;
      const d = new Date(it.rawDate);
      if (isNaN(d)) return true;
      return d >= START_DATE;
    });
  }

  // Cap if needed
  if (MAX_NEWS && mapped.length > MAX_NEWS) {
    mapped = mapped.slice(0, MAX_NEWS);
  }

  console.log(`  ✓ ${mapped.length} items after filters`);
  return mapped;
}

// ==================================================
// Article detail scraper (IMPROVED FILTERING)
// ==================================================

async function scrapeArticleDetail(url) {
  let res;
  try {
    res = await axios.get(url, { timeout: 30000 });
  } catch (err) {
    console.warn(`Warning: failed to fetch article page: ${err.message}`);
    return {
      fullText: "",
      authors: [],
      tags: [],
      mitGroups: []
    };
  }

  const $ = cheerioLoad(res.data);

  // FULL TEXT - Use original working selectors
  const paragraphs = [];
  const bodySelectors = [
    ".field--name-body .field__item p",
    "div[property='schema:articleBody'] p",
    ".article-body p",
    ".article__content p",
    ".node-article .field__item p",
    ".content p",
    "article p"
  ];

  bodySelectors.forEach((sel) => {
    $(sel).each((i, el) => {
      const t = fixText($(el).text());
      if (t) paragraphs.push(t);
    });
  });

  let fullText = paragraphs.join(" ");
  
  // SIMPLE FIX: Just remove the unwanted text patterns after capture
  fullText = fullText.replace(/Previous image\s+Next image\s*/gi, "");
  fullText = fullText.replace(/Next image\s+Previous image\s*/gi, "");
  fullText = fullText.replace(/Images for download on the MIT News office website are made available to non-commercial entities, press and the general public under a Creative Commons Attribution Non-Commercial No Derivatives license\.\s*/gi, "");
  fullText = fullText.replace(/You may not alter the images provided, other than to crop them to size\.\s*/gi, "");
  fullText = fullText.replace(/A credit line must be used when reproducing images; if one is not provided below, credit the images to "MIT\."\s*/gi, "");
  fullText = fullText.trim();

  // AUTHORS
  const authors = new Set();
  const authorSelectors = [
    ".byline a",
    ".byline span",
    ".field--name-field-author a",
    ".author-name",
    "span[property='schema:author'] a",
    "span[property='schema:author']",
    ".article__byline a",
    ".article__authors a",
    ".article__authors .person",
    ".author",
    ".node-author"
  ];

  authorSelectors.forEach((sel) => {
    $(sel).each((i, el) => {
      const t = fixText($(el).text());
      if (t) authors.add(t);
    });
  });

  // TAGS
  const tags = new Set();
  const tagSelectors = [
    ".tags a",
    ".field--name-field-tags a",
    ".article__tags a",
    ".article__tags-list a",
    "ul.terms-list li a",
    "a[rel='tag']"
  ];

  tagSelectors.forEach((sel) => {
    $(sel).each((i, el) => {
      const t = fixText($(el).text());
      if (t) tags.add(t);
    });
  });

  // MIT GROUPS
  const mitGroups = new Set();
  const mitGroupSelectors = [
    ".field--name-field-primary-group a",
    ".field--name-field-related-departments a",
    ".field--name-field-related-labs a",
    ".field--name-field-related-centers a",
    ".field--name-field-school a",
    ".field--name-field-campus-groups a"
  ];

  mitGroupSelectors.forEach((sel) => {
    $(sel).each((i, el) => {
      const t = fixText($(el).text());
      if (t) mitGroups.add(t);
    });
  });

  return {
    fullText,
    authors: Array.from(authors),
    tags: Array.from(tags),
    mitGroups: Array.from(mitGroups)
  };
}

// ==================================================
// Main scraping function
// ==================================================

async function scrapeNewsFromRss() {
  console.log("MIT News RSS scraper starting.");

  if (START_DATE && START_DATE.toString() !== "Invalid Date") {
    console.log(`Using START_DATE filter: ${process.env.START_DATE}`);
  } else if (process.env.START_DATE) {
    console.log(`Ignoring invalid START_DATE "${process.env.START_DATE}".`);
  }

  // Initialize schema
  const runId = getRunId();
  const schema = new MITBrainSchema(runId);

  // Discover feeds
  const feeds = await discoverRssFeeds();
  
  if (!feeds.length) {
    console.log("No RSS feeds found!");
    return;
  }

  console.log(`\nWill process ${feeds.length} RSS feeds\n`);

  // Process each feed
  for (let feedIdx = 0; feedIdx < feeds.length; feedIdx++) {
    const feed = feeds[feedIdx];
    console.log(`\n========================================`);
    console.log(`Feed ${feedIdx + 1}/${feeds.length}: ${feed.name}`);
    console.log(`========================================`);

    const rssItems = await fetchRssItems(feed.url, feed.name);

    for (let i = 0; i < rssItems.length; i++) {
      const item = rssItems[i];

      console.log(`  [${i + 1}/${rssItems.length}] ${item.title}`);

      // Check if duplicate before scraping
      if (schema.isDuplicate(item.url, true)) {  // true = track as skipped
        console.log(`    → Skip (duplicate)`);
        continue;
      }

      // Scrape article details
      let detail = {
        fullText: "",
        authors: [],
        tags: [],
        mitGroups: []
      };

      try {
        detail = await scrapeArticleDetail(item.url);
      } catch (err) {
        console.warn(`    Warning: error scraping detail: ${err.message}`);
      }

      // Create record
      const record = {
        kind: "article",
        source: "MIT News",
        sourceType: "news",
        title: item.title,
        url: item.url,
        publishedAt: normalizeDate(item.rawDate || ""),
        rawDate: item.rawDate || "",
        summary: item.summary || "",
        fullText: detail.fullText || "",
        tags: item.tags || [],
        authors: item.author ? [item.author] : [],
        mitGroups: item.mitGroup ? [item.mitGroup] : detail.mitGroups || [],
        mitAuthors: item.author ? [item.author] : [],
        eventName: "",
        ilpSummary: "",
        ilpKeywords: "",
        rssFeed: feed.name
      };

      // Write using schema
      const result = schema.write(record);
      if (result.written) {
        console.log(`    → Written`);
      }
    }
  }

  // Flush to disk (writes both CSV and JSON)
  console.log("\n💾 Writing CSV and JSON files...");
  schema.flush();
  
  // Run sanity check
  schema.printSanityCheck();
  
  // Print summary
  schema.printSummary();
}

// ==================================================
// Entrypoint
// ==================================================

async function main() {
  try {
    await scrapeNewsFromRss();
  } catch (err) {
    console.error("Fatal error in scrapeNewsFromRss:", err);
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

export { scrapeNewsFromRss };