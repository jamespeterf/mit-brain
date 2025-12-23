#!/usr/bin/env node

// scrapers/scrapeExternalNews.js
//
// Scrape external news articles about MIT from "In the Media" pages
// https://news.mit.edu/in-the-media
//
// These are high-quality external articles that MIT has flagged/curated.
// 
// Process:
// 1. Scrape listing page to get source, summary, date, and MIT detail page URL
// 2. Follow MIT detail page to get actual external article URL
// 3. Store external URL in schema (title left as placeholder for enrichment)

import 'dotenv/config';
import { fileURLToPath } from 'url';
import path from 'path';
import axios from 'axios';
import { load as cheerioLoad } from 'cheerio';
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

const BASE_URL = "https://news.mit.edu/in-the-media";
const MAX_PAGES = process.env.MAX_PAGES ? parseInt(process.env.MAX_PAGES, 10) : 1000;

const START_DATE = process.env.START_DATE ? new Date(process.env.START_DATE) : null;
if (START_DATE && START_DATE.toString() === "Invalid Date") {
  console.warn(
    `WARNING: START_DATE "${process.env.START_DATE}" is invalid. Ignoring date filter.`
  );
}

// ==================================================
// Fetch external article URL from MIT detail page
// ==================================================

async function fetchExternalUrl(mitDetailUrl) {
  try {
    const res = await axios.get(mitDetailUrl, { timeout: 30000 });
    const $ = cheerioLoad(res.data);
    
    // Extract the external article URL
    const $externalLink = $("a.news-clip--source-url--link").first();
    if ($externalLink.length) {
      return $externalLink.attr("href");
    }
    
    // Fallback: look for any external link in the main content
    const $anyExternal = $("a[href^='http']").first();
    if ($anyExternal.length) {
      return $anyExternal.attr("href");
    }
    
    return null;
  } catch (err) {
    console.warn(`    Warning: Failed to fetch detail page ${mitDetailUrl}: ${err.message}`);
    return null;
  }
}

// ==================================================
// Scrape a single listing page
// ==================================================

async function scrapePage(pageNum) {
  const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?page=${pageNum}`;
  console.log(`\nScraping page ${pageNum}: ${url}`);

  let res;
  try {
    res = await axios.get(url, { timeout: 30000 });
  } catch (err) {
    console.error(
      `ERROR: Failed to fetch page ${pageNum}: ${err.message} ${
        err.response && err.response.status
          ? `(status ${err.response.status})`
          : ""
      }`
    );
    return { articles: [], hasMore: false };
  }

  const $ = cheerioLoad(res.data);
  const articles = [];

  // Find all article items
  const items = $("article, .views-row, .item-list > .item");
  
  if (items.length === 0) {
    console.log(`  No articles found on page ${pageNum}`);
    return { articles: [], hasMore: false };
  }

  console.log(`  Found ${items.length} items on page ${pageNum}`);

  // Extract data from each item
  for (let idx = 0; idx < items.length; idx++) {
    const $item = $(items[idx]);
    
    // Extract source/outlet (publication name)
    const $outlet = $item.find("h3.page--itm--views--list-item---outlet, h2, h3").first();
    const publication = fixText($outlet.text());
    
    // Extract summary
    const $summary = $item.find("div.page--itm--views--list-item--descr, .description, p").first();
    const summary = fixText($summary.text());
    
    // Extract date
    const $date = $item.find("time").first();
    const rawDate = $date.attr("datetime") || fixText($date.text());
    
    // Extract MIT detail page URL (the "Learn more" link)
    let mitDetailUrl = "";
    const $learnMore = $item.find("a[href*='/news-clip/']").first();
    if ($learnMore.length) {
      const href = $learnMore.attr("href");
      mitDetailUrl = href.startsWith("http") ? href : `https://news.mit.edu${href}`;
    }
    
    // Only process if we have a detail page URL
    if (!mitDetailUrl) {
      console.log(`    Skipping item ${idx + 1}: No detail page URL found`);
      continue;
    }
    
    // Only add if we have meaningful content
    if (publication || summary) {
      articles.push({
        publication,
        summary,
        rawDate,
        mitDetailUrl
      });
    }
  }

  // Check for next page
  const hasNextPage = $("a[rel='next'], .pager-next a, .pager__item--next a").length > 0;

  console.log(`  Extracted ${articles.length} articles from page ${pageNum}`);
  
  return {
    articles,
    hasMore: hasNextPage && articles.length > 0
  };
}

// ==================================================
// Main scraping function
// ==================================================

async function scrapeExternalNews() {
  console.log("MIT External News (In the Media) scraper starting.");
  console.log(`Will scrape up to ${MAX_PAGES} pages.`);

  if (START_DATE && START_DATE.toString() !== "Invalid Date") {
    console.log(`Using START_DATE filter: ${process.env.START_DATE}`);
  }

  // Initialize schema
  const schema = new MITBrainSchema();

  let currentPage = 0;
  let totalArticles = 0;

  // Scrape pages starting from page 1
  for (let page = 1; page <= MAX_PAGES; page++) {
    currentPage = page;
    
    const { articles, hasMore } = await scrapePage(page);

    if (articles.length === 0) {
      console.log(`\nNo articles found on page ${page}. Stopping.`);
      break;
    }

    // Track if we hit articles before START_DATE
    let hitOldArticles = false;

    // Process each article
    for (const article of articles) {
      // Apply date filter if specified
      if (START_DATE && START_DATE.toString() !== "Invalid Date" && article.rawDate) {
        const articleDate = new Date(article.rawDate);
        if (!isNaN(articleDate) && articleDate < START_DATE) {
          console.log(`  Hit article before START_DATE: ${article.publication}`);
          hitOldArticles = true;
          break; // Stop processing this page
        }
      }

      // Fetch the external article URL by following the MIT detail page
      console.log(`  Processing: ${article.publication}`);
      const externalUrl = await fetchExternalUrl(article.mitDetailUrl);
      
      if (!externalUrl) {
        console.warn(`    Warning: Could not extract external URL from ${article.mitDetailUrl}`);
        continue;
      }

      console.log(`    External URL: ${externalUrl.slice(0, 80)}...`);

      // Check for duplicate using external URL
      if (schema.isDuplicate(externalUrl, true)) {  // true = track as skipped
        console.log(`    Skip (duplicate)`);
        continue;
      }

      // Create record matching the schema
      const record = {
        kind: "article",
        source: article.publication || "External Media",
        sourceType: "external_news",
        title: article.publication || "External Media",
        url: externalUrl,
        publishedAt: normalizeDate(article.rawDate),
        rawDate: article.rawDate || "",
        summary: article.summary || "",
        fullText: "", // External articles - we don't scrape full text
        tags: [],
        authors: [],
        mitGroups: [],
        mitAuthors: [],
        eventName: "",
        ilpSummary: "",
        ilpKeywords: ""
      };

      // Write using schema
      const result = schema.write(record);
      if (result.written) {
        totalArticles++;
        console.log(`    ✓ Written (${totalArticles} total)`);
      }

      // Rate limiting between detail page fetches
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Stop if we hit articles before START_DATE (since they're chronological)
    if (hitOldArticles) {
      console.log(`\nReached articles before START_DATE (${process.env.START_DATE}). Stopping.`);
      break;
    }

    // Stop if no more pages
    if (!hasMore) {
      console.log(`\nNo more pages found after page ${page}. Stopping.`);
      break;
    }

    // Rate limiting between pages
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\nScraped ${currentPage} pages total.`);
  
  // Flush to disk (writes both CSV and JSONL)
  console.log("\n💾 Writing CSV and JSONL files...");
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
    await scrapeExternalNews();
  } catch (err) {
    console.error("Fatal error in scrapeExternalNews:", err);
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

export { scrapeExternalNews };