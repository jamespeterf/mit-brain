#!/usr/bin/env node

// scrapers/scrapePapers.js - PRODUCTION VERSION with Enhanced ACS Bot Detection Evasion
//
// Optimized for speed and practical data collection:
// - Filters out non-paper types (datasets, software, pull requests, etc.)
// - 10 abstract sources including ACS with realistic browser simulation
// - Cookie jar + user-agent rotation + randomized delays for ACS
// - Full text extraction DISABLED by default (too slow, mostly fails)
// - NO title fallback (handled in enrichment phase)
// - SSRN: Handles both direct URLs and DOI redirects, fetches from .abstract-text div
// - ACS: Realistic browser simulation with cookies, rotating user agents, homepage visit
// - summarySource field tracks where each abstract came from (for debugging)
// - Clear reporting on papers missing ALL fields (summary, fullText, tags)

import "dotenv/config";
import axios from "axios";
import { fileURLToPath } from "url";
import path from "path";
import { createRequire } from "module";
import { load as cheerioLoad } from "cheerio";
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);
const {
  MITBrainSchema,
  fixText,
  normalizeDate,
  getRunId,
} = require("../shared/MITBrainSchema.cjs");

// -------- Config --------

// Parse command line arguments for MAX_PAPERS
// Supports: node script.js 100
//       or: node script.js --max-papers 100
//       or: MAX_PAPERS=100 node script.js
function getMaxPapers() {
  const args = process.argv.slice(2);
  
  // Check for --max-papers flag
  const maxPapersIndex = args.findIndex(arg => arg === '--max-papers' || arg === '--max');
  if (maxPapersIndex !== -1 && args[maxPapersIndex + 1]) {
    return parseInt(args[maxPapersIndex + 1], 10);
  }
  
  // Check for positional argument (first non-flag argument)
  const positional = args.find(arg => !arg.startsWith('-') && !isNaN(parseInt(arg, 10)));
  if (positional) {
    return parseInt(positional, 10);
  }
  
  // Fall back to environment variable or default
  return process.env.MAX_PAPERS ? parseInt(process.env.MAX_PAPERS, 10) : 300;
}

const START_DATE_STR = process.env.START_DATE || null;
const MAX_PAPERS = getMaxPapers();
const OPENALEX_INSTITUTION_ID = process.env.OPENALEX_INSTITUTION_ID || "I63966007";

const ENABLE_FULLTEXT = process.env.ENABLE_FULLTEXT === "true"; // default: FALSE (too slow)
const ENABLE_HTML_SCRAPING = process.env.ENABLE_HTML_SCRAPING !== "false"; // default: true
const ENABLE_NLP_KEYWORDS = process.env.ENABLE_NLP_KEYWORDS !== "false"; // default: true
const POLITE_EMAIL = process.env.MIT_EMAIL || "your-email@mit.edu";

const API_DELAY_MS = 200;

// -------- Browser Simulation Setup --------

// Create axios client with cookie jar support
const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

// Realistic user agents to rotate through
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0'
];

let userAgentIndex = 0;

function getRotatingUserAgent() {
  const ua = USER_AGENTS[userAgentIndex];
  userAgentIndex = (userAgentIndex + 1) % USER_AGENTS.length;
  return ua;
}

function getRealisticHeaders(userAgent, referer = 'https://www.google.com/') {
  const headers = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'DNT': '1',
  };
  
  if (referer) {
    headers['Referer'] = referer;
  }
  
  // Add Sec-CH-UA headers for Chrome user agents
  if (userAgent.includes('Chrome')) {
    headers['Sec-CH-UA'] = '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"';
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = userAgent.includes('Windows') ? '"Windows"' : '"macOS"';
  }
  
  return headers;
}

// Show help if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
MIT Brain Paper Scraper - Production Version with Enhanced Browser Simulation

Usage:
  node scrapePapers.js [options] [max-papers]

Options:
  --max-papers N, --max N   Maximum papers to scrape (default: 300)
  --help, -h                Show this help message

Examples:
  node scrapePapers.js 100              # Scrape 100 papers (fastest)
  node scrapePapers.js --max-papers 50  # Scrape 50 papers
  MAX_PAPERS=1000 node scrapePapers.js  # Scrape 1000 papers
  START_DATE=2024-11-01 node scrapePapers.js 200  # 200 papers since Nov 2024

Environment Variables:
  MAX_PAPERS          Maximum papers to scrape
  START_DATE          Start date (YYYY-MM-DD)
  ENABLE_FULLTEXT     Enable full text extraction (slow, default: false)
  ENABLE_HTML_SCRAPING  Enable HTML scraping (default: true)
  ENABLE_NLP_KEYWORDS Enable NLP keyword extraction (default: true)
  MIT_EMAIL           Email for polite API access

Features:
  - Filters out datasets, software, pull requests, GitHub issues, etc.
  - ACS browser simulation: cookies, rotating user agents, randomized delays
  - SSRN HTML fetching with DOI redirect handling
  - summarySource field tracks where each abstract came from
  - Check CSV/JSONL output to debug which sources provide good/bad data

Dependencies:
  npm install tough-cookie axios-cookiejar-support
`);
  process.exit(0);
}

console.log(`Full text extraction: ${ENABLE_FULLTEXT ? "ENABLED (slow)" : "DISABLED (fast)"}`);
console.log(`HTML scraping: ${ENABLE_HTML_SCRAPING}`);
console.log(`NLP keyword extraction: ${ENABLE_NLP_KEYWORDS}`);
console.log(`ACS HTML fetching: ENABLED (with browser simulation)`);
console.log(`SSRN HTML fetching: ENABLED (handles DOI redirects)`);
console.log(`Type filtering: ENABLED (excludes datasets, software, pull requests)`);
console.log(`Debug tracking: summarySource field ENABLED`);

// -------- Stats --------
const stats = {
  total: 0,
  skippedTypes: 0,
  openalexAbstract: 0,
  semanticScholar: 0,
  crossref: 0,
  pubmed: 0,
  arxiv: 0,
  europePmc: 0,
  htmlMeta: 0,
  pdfExtract: 0,
  core: 0,
  tagsFromNLP: 0,
  noAbstract: 0,
  ssrnParsed: 0,
  ssrnFailed: 0,
  acsParsed: 0,
  acsFailed: 0,
  
  // Critical field tracking
  hasAllThree: 0,      // summary + fullText + tags
  missingOne: 0,       // has 2 out of 3
  missingTwo: 0,       // has 1 out of 3
  missingAllThree: 0,  // has 0 out of 3 (critical - needs title-based AI)
};

// -------- Utilities --------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await delay(baseDelay * Math.pow(2, i));
    }
  }
}

function extractDoi(url) {
  if (!url) return null;
  const m = url.match(/doi\.org\/(.+?)(?:$|[?#])/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function extractArxivId(url) {
  if (!url) return null;
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/i);
  return m ? m[1] : null;
}

function extractPmid(url) {
  if (!url) return null;
  const m = url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i);
  return m ? m[1] : null;
}

function reconstructAbstract(index) {
  if (!index || typeof index !== "object") return "";
  const positions = [];
  let maxPos = -1;
  for (const [word, idxs] of Object.entries(index)) {
    if (!Array.isArray(idxs)) continue;
    for (const i of idxs) {
      positions[i] = word;
      if (i > maxPos) maxPos = i;
    }
  }
  const out = [];
  for (let i = 0; i <= maxPos; i++) {
    out.push(positions[i] || "");
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

// -------- Simple NLP Keyword Extraction --------

function extractKeywordsSimple(text) {
  if (!text || !ENABLE_NLP_KEYWORDS) return [];
  
  const words = text.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);
  
  const stopWords = new Set([
    'this', 'that', 'these', 'those', 'then', 'than', 'them', 'they',
    'their', 'there', 'what', 'when', 'where', 'which', 'while', 'with',
    'have', 'from', 'been', 'were', 'more', 'into', 'such', 'also',
    'other', 'some', 'only', 'about', 'after', 'before', 'between'
  ]);
  
  const wordFreq = {};
  words.forEach(w => {
    if (!stopWords.has(w)) {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    }
  });
  
  return Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

// -------- API Sources --------

async function fetchArxiv(arxivId) {
  if (!arxivId) return null;
  
  try {
    await delay(API_DELAY_MS);
    const res = await retryWithBackoff(async () => {
      return await axios.get(
        `http://export.arxiv.org/api/query`,
        {
          params: { id_list: arxivId },
          timeout: 10000,
        }
      );
    });
    
    const xml = res.data;
    const summaryMatch = xml.match(/<summary>([\s\S]*?)<\/summary>/i);
    const categoriesMatch = xml.matchAll(/<category[^>]*term="([^"]+)"/g);
    
    const abstract = summaryMatch ? summaryMatch[1].replace(/<[^>]+>/g, "").trim() : null;
    const categories = [...categoriesMatch].map(m => m[1]);
    
    return { abstract, categories };
  } catch (err) {
    return null;
  }
}

async function fetchEuropePmc(pmid, doi, title) {
  try {
    await delay(API_DELAY_MS);
    
    let query = '';
    if (pmid) {
      query = `EXT_ID:${pmid}`;
    } else if (doi) {
      query = `DOI:"${doi}"`;
    } else if (title) {
      query = `TITLE:"${title}"`;
    } else {
      return null;
    }
    
    const res = await retryWithBackoff(async () => {
      return await axios.get(
        'https://www.ebi.ac.uk/europepmc/webservices/rest/search',
        {
          params: {
            query,
            format: 'json',
            resultType: 'core',
          },
          timeout: 10000,
        }
      );
    });
    
    const results = res.data?.resultList?.result;
    if (!results || results.length === 0) return null;
    
    const paper = results[0];
    return {
      abstract: paper.abstractText || null,
      keywords: paper.keywordList?.keyword || [],
    };
  } catch (err) {
    return null;
  }
}

async function fetchCore(doi, title) {
  if (!doi && !title) return null;
  
  try {
    await delay(API_DELAY_MS);
    
    const searchTerm = doi || title;
    const res = await retryWithBackoff(async () => {
      return await axios.get(
        'https://api.core.ac.uk/v3/search/works',
        {
          params: {
            q: searchTerm,
            limit: 1,
          },
          timeout: 10000,
        }
      );
    });
    
    const results = res.data?.results;
    if (!results || results.length === 0) return null;
    
    return results[0].abstract || null;
  } catch (err) {
    return null;
  }
}

async function fetchSSRNAbstract(url) {
  if (!url) return null;
  
  // Check if this is an SSRN paper (direct URL or DOI)
  const isSSRN = url.includes('papers.ssrn.com') || 
                 url.includes('doi.org/10.2139/ssrn') ||
                 url.includes('/10.2139/ssrn');
  
  if (!isSSRN) return null;
  
  // If it's a DOI, convert to actual SSRN URL
  let ssrnUrl = url;
  if (url.includes('doi.org') || url.includes('/10.2139/ssrn')) {
    // Extract SSRN ID from DOI like: 10.2139/ssrn.5801322 or 10.2139/ssrn-5801322
    const ssrnIdMatch = url.match(/ssrn[.\-](\d+)/i);
    if (ssrnIdMatch) {
      ssrnUrl = `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${ssrnIdMatch[1]}`;
      console.log(`    🔄 Converted DOI to SSRN URL: ${ssrnUrl}`);
    } else {
      // Can't extract ID, try following the redirect
      console.log(`    🔄 Following DOI redirect: ${url}`);
      try {
        await delay(API_DELAY_MS);
        const redirectRes = await axios.get(url, {
          maxRedirects: 5,
          validateStatus: (s) => s < 400,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MITBrain/1.0; +mailto:' + POLITE_EMAIL + ')',
          },
        });
        ssrnUrl = redirectRes.request.res.responseUrl || url;
        console.log(`    🔄 Redirected to: ${ssrnUrl}`);
      } catch (err) {
        console.log(`    ❌ Failed to follow redirect: ${err.message}`);
        return null;
      }
    }
  }
  
  try {
    console.log(`    🔍 Fetching SSRN page: ${ssrnUrl}`);
    
    await delay(API_DELAY_MS);
    
    const res = await axios.get(ssrnUrl, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (s) => s < 400,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MITBrain/1.0; +mailto:' + POLITE_EMAIL + ')',
      },
    });
    
    const html = res.data;
    const $ = cheerioLoad(html);
    
    // SSRN has a consistent structure: <div class="abstract-text">
    const abstractDiv = $('.abstract-text');
    
    if (abstractDiv.length > 0) {
      // Remove the <h3>Abstract</h3> header if present
      abstractDiv.find('h3').remove();
      
      // Get the text content
      let abstract = abstractDiv.text().trim();
      
      // Clean up whitespace
      abstract = abstract.replace(/\s+/g, ' ').trim();
      
      if (abstract.length > 100) {
        console.log(`    ✅ Extracted SSRN abstract from HTML (${abstract.length} chars)`);
        return abstract;
      }
    }
    
    console.log(`    ⚠️ SSRN page fetched but no .abstract-text div found`);
    return null;
    
  } catch (err) {
    console.log(`    ❌ Failed to fetch SSRN page: ${err.message}`);
    return null;
  }
}

async function fetchACSAbstract(url, doi) {
  // Check if this is an ACS paper
  const isACS = (url && (url.includes('pubs.acs.org') || url.includes('doi.org/10.1021'))) ||
                (doi && doi.startsWith('10.1021'));
  
  if (!isACS) return null;
  
  // Construct ACS URL
  let acsUrl = url;
  if (!url || !url.includes('pubs.acs.org')) {
    const doiToUse = doi || extractDoi(url);
    if (doiToUse) {
      acsUrl = `https://pubs.acs.org/doi/${doiToUse}`;
      console.log(`    🔄 Converted to ACS URL: ${acsUrl}`);
    } else {
      return null;
    }
  }
  
  try {
    console.log(`    🔍 Fetching ACS page: ${acsUrl}`);
    
    const userAgent = getRotatingUserAgent();
    
    // Step 1: Visit ACS homepage first to get cookies (simulate real browsing)
    await delay(API_DELAY_MS + Math.random() * 200); // Random delay 200-400ms
    
    try {
      await client.get('https://pubs.acs.org/', {
        timeout: 10000,
        headers: getRealisticHeaders(userAgent, null),
        validateStatus: (s) => s < 500,
      });
      console.log(`    🍪 Got cookies from ACS homepage`);
    } catch (homeErr) {
      // If homepage fails, continue anyway
      console.log(`    ⚠️ Homepage request failed, continuing...`);
    }
    
    // Step 2: Now fetch the actual paper page with cookies
    await delay(500 + Math.random() * 500); // Random delay 500-1000ms (realistic reading time)
    
    const res = await client.get(acsUrl, {
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (s) => s < 400,
      headers: getRealisticHeaders(userAgent, 'https://pubs.acs.org/'),
    });
    
    const html = res.data;
    const $ = cheerioLoad(html);
    
    // ACS has a consistent structure: <p class="articleBody_abstractText">
    const abstractP = $('p.articleBody_abstractText');
    
    if (abstractP.length > 0) {
      // Get the HTML content first
      let abstract = abstractP.html();
      
      // Strip HTML tags but preserve text
      abstract = abstract
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (abstract.length > 100) {
        console.log(`    ✅ Extracted ACS abstract from HTML (${abstract.length} chars)`);
        return abstract;
      }
    }
    
    console.log(`    ⚠️ ACS page fetched but no .articleBody_abstractText found`);
    return null;
    
  } catch (err) {
    if (err.response?.status === 403) {
      console.log(`    ⚠️ ACS returned 403 (access blocked) - skipping ACS, will try other sources`);
    } else if (err.response?.status === 429) {
      console.log(`    ⚠️ ACS rate limiting (429) - backing off`);
    } else {
      console.log(`    ❌ Failed to fetch ACS page: ${err.message}`);
    }
    return null;
  }
}

async function fetchHtmlMeta(url) {
  if (!url || !ENABLE_HTML_SCRAPING) return null;
  
  try {
    const res = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (s) => s < 400,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MITBrain/1.0; +mailto:' + POLITE_EMAIL + ')',
      },
    });
    
    const html = res.data;
    const $ = cheerioLoad(html);
    
    const metaDesc = $('meta[name="description"]').attr('content') ||
                    $('meta[property="og:description"]').attr('content') ||
                    $('meta[name="dc.description"]').attr('content');
    
    const abstract = 
      $('.abstract').first().text() ||
      $('[class*="abstract"]').first().text() ||
      $('[id*="abstract"]').first().text() ||
      metaDesc;
    
    if (abstract && abstract.length > 100) {
      return abstract.replace(/\s+/g, ' ').trim();
    }
  } catch (err) {
    // Silent fail
  }
  return null;
}

async function fetchSemanticScholar(doi, arxivId, title) {
  try {
    await delay(API_DELAY_MS);
    
    let url = null;
    let params = { fields: "title,abstract,fieldsOfStudy" };
    
    if (doi) {
      url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}`;
    } else if (arxivId) {
      url = `https://api.semanticscholar.org/graph/v1/paper/ARXIV:${arxivId}`;
    } else if (title) {
      const searchRes = await axios.get(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        {
          params: { query: title, limit: 1, fields: params.fields },
          timeout: 10000,
        }
      );
      const paper = searchRes.data?.data?.[0];
      return {
        abstract: paper?.abstract || null,
        fieldsOfStudy: paper?.fieldsOfStudy || [],
      };
    }
    
    if (url) {
      const res = await axios.get(url, { params, timeout: 10000 });
      return {
        abstract: res.data?.abstract || null,
        fieldsOfStudy: res.data?.fieldsOfStudy || [],
      };
    }
  } catch (err) {
    // Silent fail
  }
  return { abstract: null, fieldsOfStudy: [] };
}

async function fetchCrossref(doi) {
  if (!doi) return null;
  
  try {
    await delay(API_DELAY_MS);
    const res = await retryWithBackoff(async () => {
      return await axios.get(
        `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
        {
          params: { mailto: POLITE_EMAIL },
          timeout: 10000,
        }
      );
    });
    
    const item = res.data?.message;
    return item?.abstract || null;
  } catch (err) {
    return null;
  }
}

async function fetchPubMed(pmid, title) {
  try {
    await delay(API_DELAY_MS);
    
    let pmidToFetch = pmid;
    
    if (!pmidToFetch && title) {
      const searchRes = await retryWithBackoff(async () => {
        return await axios.get(
          "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
          {
            params: {
              db: "pubmed",
              retmode: "json",
              term: title,
              retmax: 1,
              email: POLITE_EMAIL,
            },
            timeout: 10000,
          }
        );
      });
      pmidToFetch = searchRes.data?.esearchresult?.idlist?.[0];
    }
    
    if (!pmidToFetch) return null;

    const fetchRes = await retryWithBackoff(async () => {
      return await axios.get(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
        {
          params: {
            db: "pubmed",
            id: pmidToFetch,
            retmode: "xml",
            email: POLITE_EMAIL,
          },
          timeout: 10000,
        }
      );
    });

    const xml = fetchRes.data;
    const abstractMatch = xml.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/i);
    const keywordMatches = xml.matchAll(/<Keyword[^>]*>(.*?)<\/Keyword>/gi);
    
    return {
      abstract: abstractMatch ? abstractMatch[1].replace(/<[^>]+>/g, "").trim() : null,
      keywords: [...keywordMatches].map(m => m[1]),
    };
  } catch (err) {
    return { abstract: null, keywords: [] };
  }
}

// -------- Record Enrichment --------

async function enrichRecord(record, work) {
  const doi = extractDoi(record.url || work.doi);
  const arxivId = extractArxivId(record.url || record.pdfUrl);
  const pmid = extractPmid(record.url || record.pdfUrl);
  const title = record.title;
  
  let abstract = record.summary; // Start with OpenAlex abstract
  let summarySource = record.summarySource || ""; // Track source
  let additionalTags = new Set(record.tags);
  let sources = [];
  
  // If no abstract from OpenAlex, try all sources
  if (!abstract || abstract.length < 100) {
    console.log(`  📄 "${title.slice(0, 60)}..." - No/short abstract, trying all sources...`);
    
    // Try SSRN (handles both direct URLs and DOI redirects)
    if (!abstract && record.url) {
      const ssrnAbstract = await fetchSSRNAbstract(record.url);
      if (ssrnAbstract) {
        abstract = ssrnAbstract;
        summarySource = "SSRN HTML";
        sources.push('SSRN HTML');
        stats.ssrnParsed++;
      } else if (record.url.includes('ssrn') || (record.doi && record.doi.includes('ssrn'))) {
        stats.ssrnFailed++;
      }
    }
    
    // Try ACS (American Chemical Society)
    /*
    if (!abstract && (record.url || record.doi)) {
      const acsAbstract = await fetchACSAbstract(record.url, record.doi);
      if (acsAbstract) {
        abstract = acsAbstract;
        summarySource = "ACS HTML";
        sources.push('ACS HTML');
        stats.acsParsed++;
      } else if ((record.url && record.url.includes('acs.org')) || (record.doi && record.doi.startsWith('10.1021'))) {
        stats.acsFailed++;
      }
    }
    */
    
    // Try arXiv
    if (!abstract && arxivId) {
      const arxivData = await fetchArxiv(arxivId);
      if (arxivData?.abstract) {
        abstract = arxivData.abstract;
        summarySource = "arXiv";
        sources.push('arXiv');
        stats.arxiv++;
        
        if (arxivData.categories) {
          arxivData.categories.forEach(c => additionalTags.add(c));
        }
      }
    }
    
    // Try Semantic Scholar
    if (!abstract) {
      const ssData = await fetchSemanticScholar(doi, arxivId, title);
      if (ssData?.abstract) {
        abstract = ssData.abstract;
        summarySource = "Semantic Scholar";
        sources.push('Semantic Scholar');
        stats.semanticScholar++;
        
        if (ssData.fieldsOfStudy) {
          ssData.fieldsOfStudy.forEach(f => additionalTags.add(f));
        }
      }
    }
    
    // Try Europe PMC
    if (!abstract) {
      const epmcData = await fetchEuropePmc(pmid, doi, title);
      if (epmcData?.abstract) {
        abstract = epmcData.abstract;
        summarySource = "Europe PMC";
        sources.push('Europe PMC');
        stats.europePmc++;
        
        if (epmcData.keywords) {
          epmcData.keywords.forEach(k => additionalTags.add(k));
        }
      }
    }
    
    // Try Crossref
    if (!abstract && doi) {
      const crossrefAbstract = await fetchCrossref(doi);
      if (crossrefAbstract) {
        abstract = crossrefAbstract;
        summarySource = "Crossref";
        sources.push('Crossref');
        stats.crossref++;
      }
    }
    
    // Try PubMed
    if (!abstract) {
      const pubmedData = await fetchPubMed(pmid, title);
      if (pubmedData?.abstract) {
        abstract = pubmedData.abstract;
        summarySource = "PubMed";
        sources.push('PubMed');
        stats.pubmed++;
        
        if (pubmedData.keywords) {
          pubmedData.keywords.forEach(k => additionalTags.add(k));
        }
      }
    }
    
    // Try CORE
    if (!abstract) {
      const coreAbstract = await fetchCore(doi, title);
      if (coreAbstract) {
        abstract = coreAbstract;
        summarySource = "CORE";
        sources.push('CORE');
        stats.core++;
      }
    }
    
    // Try HTML meta extraction (for non-SSRN/ACS sites)
    if (!abstract && (record.url || record.pdfUrl) && !record.url?.includes('ssrn') && !record.url?.includes('acs.org')) {
      const htmlAbstract = await fetchHtmlMeta(record.url || record.pdfUrl);
      if (htmlAbstract) {
        abstract = htmlAbstract;
        summarySource = "HTML meta";
        sources.push('HTML meta');
        stats.htmlMeta++;
      }
    }
    
    if (sources.length > 0) {
      console.log(`    ✅ Got abstract from ${sources.join(', ')} (${abstract.length} chars)`);
    } else {
      summarySource = "NONE";
      stats.noAbstract++;
      console.log(`    ⚠️  No abstract found from any source`);
    }
  } else {
    stats.openalexAbstract++;
  }
  
  // Update record
  if (abstract) {
    record.summary = fixText(abstract);
    record.summarySource = summarySource;
  } else {
    record.summarySource = summarySource || "NONE";
  }
  
  // Extract NLP keywords if we have text
  if (ENABLE_NLP_KEYWORDS) {
    const textForKeywords = record.summary || title;
    if (textForKeywords) {
      const nlpKeywords = extractKeywordsSimple(textForKeywords);
      if (nlpKeywords.length > 0) {
        nlpKeywords.forEach(k => additionalTags.add(k));
        stats.tagsFromNLP++;
      }
    }
  }
  
  // Update tags
  record.tags = Array.from(additionalTags).filter(Boolean);
  
  // Count which critical fields we have (summary, fullText, tags)
  // Note: fullText is only counted if it's NOT just a duplicate of summary
  const hasSummary = Boolean(record.summary && record.summary.length > 0);
  const hasFullText = Boolean(
    record.fullText && 
    record.fullText.length > 0 && 
    record.fullText !== record.summary
  );
  const hasTags = Boolean(record.tags && record.tags.length > 0);
  
  const fieldCount = [hasSummary, hasFullText, hasTags].filter(Boolean).length;
  
  if (fieldCount === 3) {
    stats.hasAllThree++;
  } else if (fieldCount === 2) {
    stats.missingOne++;
  } else if (fieldCount === 1) {
    stats.missingTwo++;
  } else {
    stats.missingAllThree++;
    console.log(`    🚨 CRITICAL: No summary, fullText, OR tags - needs title-based AI enrichment`);
  }
  
  return record;
}

// -------- OpenAlex Work to Record --------

function openAlexWorkToRecord(work) {
  const title = fixText(work.display_name || "");
  const pubDate = work.publication_date || work.from_publication_date || "";
  const publishedAt = normalizeDate(pubDate);

  let url = "";
  let doi = "";
  if (work.doi) {
    doi = work.doi.replace(/^https?:\/\/doi.org\//i, "");
    url = `https://doi.org/${doi}`;
  } else if (work.id) {
    url = work.id;
  }

  const primaryLocation = work.primary_location || null;

  // -------- Abstract from OpenAlex --------
  let abstract = "";
  let summarySource = "";
  
  if (typeof work.abstract === "string" && work.abstract.trim()) {
    abstract = fixText(work.abstract);
    summarySource = "OpenAlex:abstract";
  } else if (work.abstract_inverted_index) {
    abstract = fixText(reconstructAbstract(work.abstract_inverted_index));
    summarySource = "OpenAlex:inverted_index";
  } else if (typeof work.summary === "string" && work.summary.trim()) {
    abstract = fixText(work.summary);
    summarySource = "OpenAlex:summary";
  }
  
  // Note: If OpenAlex gave us garbage or nothing, enrichRecord will detect
  // publisher-specific DOIs/URLs and fetch clean abstracts directly
  // -------- END Abstract --------

  const tagSet = new Set();
  if (Array.isArray(work.concepts)) {
    work.concepts.forEach((c) => {
      if (c && c.display_name) tagSet.add(fixText(c.display_name));
    });
  }
  if (Array.isArray(work.mesh)) {
    work.mesh.forEach((m) => {
      if (m.descriptor_name) tagSet.add(fixText(m.descriptor_name));
      if (m.qualifier_name) tagSet.add(fixText(m.qualifier_name));
    });
  }
  const tags = Array.from(tagSet);

  const authors = [];
  const mitAuthors = [];
  if (Array.isArray(work.authorships)) {
    work.authorships.forEach((auth) => {
      if (!auth || !auth.author) return;
      const name = fixText(auth.author.display_name || "");
      if (!name) return;

      authors.push(name);

      const institutions = auth.institutions || [];
      const hasMitAff = institutions.some((inst) => {
        if (!inst || !inst.display_name) return false;
        const s = inst.display_name.toLowerCase();
        return (
          s.includes("massachusetts institute of technology") ||
          s === "mit" ||
          s.includes("computer science and artificial intelligence laboratory") ||
          s.includes("csail") ||
          s.includes("lincoln laboratory") ||
          s.includes("mit media lab")
        );
      });

      if (hasMitAff) mitAuthors.push(name);
    });
  }

  const venue =
    work.host_venue && work.host_venue.display_name
      ? fixText(work.host_venue.display_name)
      : "";

  const citationCount =
    typeof work.cited_by_count === "number" ? work.cited_by_count : 0;

  let pdfUrl = "";
  const bestOa = work.best_oa_location || null;
  if (bestOa && bestOa.pdf_url) {
    pdfUrl = bestOa.pdf_url;
  } else if (work.oa_url) {
    pdfUrl = work.oa_url;
  } else if (bestOa && bestOa.landing_page_url) {
    pdfUrl = bestOa.landing_page_url;
  } else if (primaryLocation && primaryLocation.landing_page_url) {
    pdfUrl = primaryLocation.landing_page_url;
  }

  let grants = [];
  if (Array.isArray(work.grants)) {
    grants = work.grants
      .map((g) => {
        const funderName = g.funder_display_name || "";
        const awardId = g.award_id || "";
        const funderId = g.funder || "";
        if (!funderName && !awardId && !funderId) return null;
        return { funderName, awardId, funderId };
      })
      .filter(Boolean);
  }

  return {
    kind: "paper",
    source: "OpenAlex",
    sourceType: "paper",

    title,
    url,
    publishedAt,
    rawDate: pubDate,

    summary: abstract,
    summarySource,
    fullText: "",

    tags,
    authors,
    mitGroups: [],
    mitAuthors,
    eventName: venue,

    ilpSummary: "",
    ilpKeywords: "",

    venue,
    doi,
    citationCount,
    pdfUrl,
    grants,
  };
}

// -------- Main --------

export async function scrapePapersFromOpenAlex() {
  const runId = getRunId();
  const schema = new MITBrainSchema();

  console.log("============================================================");
  console.log("Step 07: Scraping Papers (PRODUCTION + Enhanced Browser Sim)");
  console.log("============================================================");
  console.log(`Run ID:       ${runId}`);
  console.log(`START_DATE:   ${START_DATE_STR || "(none)"}`);
  console.log(`MAX_PAPERS:   ${MAX_PAPERS}`);
  console.log(`Institution:  ${OPENALEX_INSTITUTION_ID}`);
  console.log("");

  let cursor = "*";
  let page = 1;
  let total = 0;

  const baseUrl = "https://api.openalex.org/works";

  // Exclude non-paper types
  const disallowedTypes = new Set([
    "dataset",
    "data",
    "software",
    "standard",
    "other",
    "paratext",           // Pull requests, issues, etc.
    "component",
    "peer-review",
    "reference-entry",
    "grant",
    "supplementary-material"
  ]);

  while (cursor && total < MAX_PAPERS) {
    const filterParts = [`institutions.id:${OPENALEX_INSTITUTION_ID}`];
    if (START_DATE_STR) {
      filterParts.push(`from_publication_date:${START_DATE_STR}`);
    }

    const params = {
      filter: filterParts.join(","),
      sort: "publication_date:desc",
      per_page: 200,
      cursor,
    };

    console.log(
      `\nFetching OpenAlex page ${page} (cursor=${cursor.slice(0, 10)}..., total so far=${total})`
    );

    const res = await axios.get(baseUrl, { params });
    const data = res.data || {};
    const works = Array.isArray(data.results) ? data.results : [];

    if (!works.length) {
      console.log("No more results returned by OpenAlex.");
      break;
    }

    const records = [];
    for (const work of works) {
      // Check if we've hit the limit BEFORE processing
      if (total >= MAX_PAPERS) {
        console.log(`\nReached MAX_PAPERS limit (${MAX_PAPERS}). Stopping.`);
        break;
      }
      
      // Skip non-paper types
      const workType = (work.type || "").toLowerCase();
      if (workType && disallowedTypes.has(workType)) {
        stats.skippedTypes++;
        console.log(`  ⏭️  Skipping ${workType}: ${work.display_name?.slice(0, 60)}...`);
        continue;
      }
      
      const record = openAlexWorkToRecord(work);
      const enriched = await enrichRecord(record, work);
      records.push(enriched);
      stats.total++;
      total++;
    }

    schema.writeBatch(records);

    // Check if we hit the limit during processing
    if (total >= MAX_PAPERS) {
      console.log(`Reached MAX_PAPERS cap (${MAX_PAPERS}).`);
      break;
    }

    cursor = data.meta && data.meta.next_cursor;
    if (!cursor) {
      console.log("Reached end of OpenAlex cursor results.");
      break;
    }

    page += 1;
  }

  console.log("\n============================================================");
  console.log("ENRICHMENT STATISTICS");
  console.log("============================================================");
  console.log(`Total papers processed:           ${stats.total}`);
  console.log(`Skipped non-paper types:          ${stats.skippedTypes}`);
  console.log(`\nPUBLISHER-SPECIFIC HTML FETCHING:`);
  console.log(`  SSRN papers parsed successfully: ${stats.ssrnParsed}`);
  console.log(`  SSRN fetch failed:               ${stats.ssrnFailed}`);
  console.log(`  ACS papers parsed successfully:  ${stats.acsParsed}`);
  console.log(`  ACS fetch failed:                ${stats.acsFailed}`);
  console.log(`\nABSTRACT SOURCES:`);
  console.log(`  OpenAlex had abstract:          ${stats.openalexAbstract} (${((stats.openalexAbstract / stats.total) * 100).toFixed(1)}%)`);
  console.log(`  arXiv API:                      ${stats.arxiv}`);
  console.log(`  Semantic Scholar:               ${stats.semanticScholar}`);
  console.log(`  Europe PMC:                     ${stats.europePmc}`);
  console.log(`  Crossref:                       ${stats.crossref}`);
  console.log(`  PubMed:                         ${stats.pubmed}`);
  console.log(`  CORE API:                       ${stats.core}`);
  console.log(`  HTML meta:                      ${stats.htmlMeta}`);
  console.log(`  No abstract found:              ${stats.noAbstract} (${((stats.noAbstract / stats.total) * 100).toFixed(1)}%)`);
  console.log(`\nKEYWORDS:`);
  console.log(`  Papers with NLP keywords:       ${stats.tagsFromNLP}`);
  console.log(`\n============================================================`);
  console.log(`FINAL SUMMARY (3 critical fields for AI enrichment)`);
  console.log(`============================================================`);
  console.log(`NOTE: summary = abstract, fullText = actual paper content`);
  console.log(`      (fullText only counted if different from summary)`);
  console.log(`------------------------------------------------------------`);
  console.log(`Total Papers:                           ${stats.total}`);
  console.log(`Papers with all three fields:           ${stats.hasAllThree} (${((stats.hasAllThree / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Papers missing ONE of three:            ${stats.missingOne} (${((stats.missingOne / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Papers missing TWO of three:            ${stats.missingTwo} (${((stats.missingTwo / stats.total) * 100).toFixed(1)}%)`);
  console.log(`🚨 Papers missing ALL THREE:            ${stats.missingAllThree} (${((stats.missingAllThree / stats.total) * 100).toFixed(1)}%)`);
  console.log(`\n✅ Ready for AI enrichment:             ${stats.total - stats.missingAllThree} (${(((stats.total - stats.missingAllThree) / stats.total) * 100).toFixed(1)}%)`);
  console.log(`🔧 Needs title-based AI enrichment:     ${stats.missingAllThree} (${((stats.missingAllThree / stats.total) * 100).toFixed(1)}%)`);
  console.log(`\n📊 DEBUG: Check 'summarySource' in JSONL output to see where abstracts came from`);
  console.log(`    (summarySource may not appear in CSV depending on MITBrainSchema config)`);
  console.log("============================================================\n");

  console.log("Writing output files...");
  schema.flush();

  schema.printSanityCheck();
  //schema.printContentReadinessCheck();
  schema.printSummary();

  return total;
}

scrapePapersFromOpenAlex().catch((err) => {
  console.error("Fatal error in scrapePapers:", err);
  process.exit(1);
});