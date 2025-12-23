#!/usr/bin/env node
/**
 * MIT Persons Scraper (for scrape.sh pipeline)
 * 
 * Scrapes MIT directory and enriches with OpenAlex publication data.
 * Outputs to MIT Brain JSONL format.
 * 
 * Environment Variables:
 *   MIT_BRAIN - Brain filename (without extension)
 *   OUTPUT_DIR - Output directory
 *   LOGS_DIR - Logs directory
 *   MAX_PERSONS - Optional limit (for testing)
 * 
 * Usage:
 *   node scrapers/scrapeMITPersons.js
 *   MAX_PERSONS=50 node scrapers/scrapeMITPersons.js  # Test mode
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration from environment
const MIT_BRAIN = process.env.MIT_BRAIN || 'mit_brain_test17';
const BRAIN_DIR = process.env.BRAIN_DIR || '../brain';
const MAX_PERSONS = process.env.MAX_PERSONS ? parseInt(process.env.MAX_PERSONS) : null;

const MIT_DIRECTORY_URL = 'https://ilp.mit.edu/search/faculty';
const OPENALEX_BASE = 'https://api.openalex.org';
const MIT_INSTITUTION_ID = 'I63966007';
const ITEMS_PER_PAGE = 100;

class MITPersonsScraper {
  constructor() {
    this.persons = [];
    this.stats = {
      scraped: 0,
      enriched: 0,
      notFoundInOpenAlex: 0,
      errors: 0
    };
  }

  /**
   * Main entry point
   */
  async run() {
    console.log('🚀 Starting MIT Persons Scraper\n');

    try {
      // Step 1: Scrape directory
      await this.scrapeDirectory();

      // Step 2: Enrich with OpenAlex
      await this.enrichWithOpenAlex();

      // Step 3: Load existing brain
      const existingBrain = await this.loadExistingBrain();

      // Step 4: Merge persons into brain
      const mergedBrain = this.mergeToBrain(existingBrain);

      // Step 5: Save updated brain
      await this.saveBrain(mergedBrain);

      // Step 6: Print summary
      this.printSummary();

      console.log('\n✅ MIT Persons scraping complete!\n');
      return 0;

    } catch (error) {
      console.error('\n❌ Fatal error:', error.message);
      console.error(error.stack);
      return 1;
    }
  }

  /**
   * Scrape MIT directory
   */
  async scrapeDirectory() {
    console.log('📋 Step 1: Scraping MIT Directory...\n');

    let page = 0;
    let hasMore = true;

    while (hasMore) {
      console.log(`  📄 Fetching page ${page}...`);

      const url = `${MIT_DIRECTORY_URL}?sort_by=field_last_name&items_per_page=${ITEMS_PER_PAGE}&page=${page}`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`  ❌ HTTP ${response.status}`);
          break;
        }

        const html = await response.text();
        const persons = this.parsePersonsPage(html);

        console.log(`  ✅ Found ${persons.length} people`);

        if (persons.length === 0) {
          hasMore = false;
          break;
        }

        this.persons.push(...persons);
        this.stats.scraped += persons.length;

        if (MAX_PERSONS && this.stats.scraped >= MAX_PERSONS) {
          console.log(`  ⚠️  Reached limit of ${MAX_PERSONS} people`);
          this.persons = this.persons.slice(0, MAX_PERSONS);
          hasMore = false;
          break;
        }

        if (persons.length < ITEMS_PER_PAGE) {
          hasMore = false;
        }

        page++;
        await this.sleep(500);

      } catch (error) {
        console.error(`  ❌ Error on page ${page}:`, error.message);
        break;
      }
    }

    console.log(`\n  ✅ Scraped ${this.stats.scraped} people from directory\n`);
  }

  /**
   * Parse persons from HTML page
   */
  parsePersonsPage(html) {
    const $ = cheerio.load(html);
    const persons = [];

    // Try common selectors
    const selectors = ['.views-row', '.node--type-faculty', 'article'];

    let $items = null;
    for (const selector of selectors) {
      $items = $(selector);
      if ($items.length > 0) break;
    }

    if (!$items || $items.length === 0) {
      return persons;
    }

    $items.each((i, item) => {
      const $item = $(item);
      const person = this.extractPersonData($, $item);
      if (person && person.title) {
        persons.push(person);
      }
    });

    return persons;
  }

  /**
   * Extract person data from item
   */
  extractPersonData($, $item) {
    const name = this.extractText($, $item, ['h2 a', 'h3 a', 'h2', 'h3']);
    if (!name) return null;

    const url = this.extractHref($, $item, ['h2 a', 'h3 a']);
    const titles = this.extractTexts($, $item, ['.field--name-field-title', '.faculty-title']);
    const departments = this.extractTexts($, $item, ['.field--name-field-department', '.department']);
    const researchAreas = this.extractTexts($, $item, ['.field--name-field-research-areas a', '.research-area']);
    const email = this.extractEmail($, $item);
    const websites = this.extractWebsites($, $item, url);

    return {
      url: url || `https://ilp.mit.edu/person/${this.slugify(name)}`,
      title: name,
      kind: 'mit_person',
      personType: this.determinePersonType(titles),
      academicTitles: titles,
      departments: departments,
      primaryDepartment: departments[0] || 'MIT',
      labs: [],
      researchGroups: [],
      researchAreas: researchAreas,
      expertise: '',
      biography: '',
      email: email || '',
      phone: '',
      officeLocation: '',
      websites: websites,
      publications: 0,
      citationCount: 0,
      hIndex: 0,
      i10Index: 0,
      orcidId: '',
      openAlexId: '',
      googleScholarUrl: '',
      linkedInUrl: websites.find(w => w.includes('linkedin.com')) || '',
      wikipediaUrl: websites.find(w => w.includes('wikipedia.org')) || '',
      date: new Date().toISOString().split('T')[0],
      source: 'MIT Directory',
      sourceType: 'directory',
      mitUnit: departments[0] || 'MIT',
      ilpSummary: '',
      ilpKeywords: [],
      industries: '',
      techThemes: '',
      ilpAudiences: '',
      scrapedDate: new Date().toISOString(),
      lastVerified: new Date().toISOString(),
      active: true,
      emeritus: titles.some(t => t.toLowerCase().includes('emeritus'))
    };
  }

  /**
   * Enrich all persons with OpenAlex data
   */
  async enrichWithOpenAlex() {
    console.log('🔬 Step 2: Enriching with OpenAlex...\n');

    for (let i = 0; i < this.persons.length; i++) {
      const person = this.persons[i];
      console.log(`  [${i + 1}/${this.persons.length}] ${person.title}`);

      try {
        const enriched = await this.enrichPerson(person);
        this.persons[i] = enriched;

        if (enriched._openalexFound) {
          console.log(`    ✅ ${enriched.publications} pubs, ${enriched.citationCount} citations`);
          this.stats.enriched++;
        } else {
          console.log(`    ⚠️  Not found in OpenAlex`);
          this.stats.notFoundInOpenAlex++;
        }
      } catch (error) {
        console.log(`    ❌ ${error.message}`);
        this.stats.errors++;
      }

      await this.sleep(200);
    }

    console.log(`\n  ✅ Enriched ${this.stats.enriched} with OpenAlex data\n`);
  }

  /**
   * Enrich single person with OpenAlex
   */
  async enrichPerson(person) {
    const query = encodeURIComponent(person.title);
    
    // Build URL with optional mailto for polite pool
    let url = `${OPENALEX_BASE}/authors?search=${query}&filter=last_known_institutions.id:${MIT_INSTITUTION_ID}&per_page=3`;
    
    // Add MIT email for OpenAlex polite pool (faster responses)
    if (process.env.MIT_EMAIL) {
      url += `&mailto=${process.env.MIT_EMAIL}`;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) return { ...person, _openalexFound: false };

      const data = await response.json();
      if (!data.results || data.results.length === 0) {
        return { ...person, _openalexFound: false };
      }

      const author = data.results[0];

      // Extract research areas from concepts
      const researchAreas = (author.x_concepts || [])
        .filter(c => c.score > 30)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(c => c.display_name);

      return {
        ...person,
        publications: author.works_count || 0,
        citationCount: author.cited_by_count || 0,
        hIndex: author.summary_stats?.h_index || 0,
        i10Index: author.summary_stats?.i10_index || 0,
        orcidId: author.orcid ? author.orcid.replace('https://orcid.org/', '') : '',
        openAlexId: author.id || '',
        researchAreas: person.researchAreas.length > 0 ? person.researchAreas : researchAreas,
        _openalexFound: true
      };
    } catch (error) {
      return { ...person, _openalexFound: false };
    }
  }

  /**
   * Load existing brain JSONL
   * (scrape.sh ensures file exists)
   */
  async loadExistingBrain() {
    const jsonlPath = path.join(BRAIN_DIR, `${MIT_BRAIN}.jsonl`);

    const content = await fs.readFile(jsonlPath, 'utf8');
    
    // Handle empty file (newly created by scrape.sh)
    if (!content.trim()) {
      console.log(`  ℹ️  Brain file is empty - starting fresh`);
      return [];
    }
    
    const lines = content.split('\n').filter(line => line.trim());
    const brain = lines.map(line => JSON.parse(line));
    
    console.log(`  ℹ️  Loaded ${brain.length} existing records from ${jsonlPath}`);
    return brain;
  }

  /**
   * Merge persons into brain (replace existing MIT persons)
   */
  mergeToBrain(existingBrain) {
    console.log('🔀 Step 3: Merging into brain...\n');

    // Remove old MIT persons
    const withoutPersons = existingBrain.filter(item => item.kind !== 'mit_person');

    console.log(`  Removed ${existingBrain.length - withoutPersons.length} old MIT person records`);
    console.log(`  Adding ${this.persons.length} new MIT person records`);

    // Add new persons
    return [...withoutPersons, ...this.persons];
  }

  /**
   * Save brain to JSONL
   */
  async saveBrain(brain) {
    console.log('\n💾 Step 4: Saving brain...\n');

    const jsonlPath = path.join(OUTPUT_DIR, 'jsonl', `${MIT_BRAIN}.jsonl`);
    const lines = brain.map(item => JSON.stringify(item));
    await fs.writeFile(jsonlPath, lines.join('\n') + '\n');

    console.log(`  ✅ Saved ${brain.length} records to ${jsonlPath}\n`);
  }

  /**
   * Print summary
   */
  printSummary() {
    console.log('='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`MIT persons scraped: ${this.stats.scraped}`);
    console.log(`Enriched with OpenAlex: ${this.stats.enriched}`);
    console.log(`Not found in OpenAlex: ${this.stats.notFoundInOpenAlex}`);
    if (this.stats.errors > 0) {
      console.log(`Errors: ${this.stats.errors}`);
    }

    // Person types
    const typeCounts = {};
    for (const person of this.persons) {
      typeCounts[person.personType] = (typeCounts[person.personType] || 0) + 1;
    }
    console.log('\nBy person type:');
    for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
  }

  // Helper methods
  extractText($, $item, selectors) {
    for (const sel of selectors) {
      const text = $item.find(sel).first().text().trim();
      if (text) return text;
    }
    return '';
  }

  extractTexts($, $item, selectors) {
    const texts = [];
    for (const sel of selectors) {
      $item.find(sel).each((i, el) => {
        const text = $(el).text().trim();
        if (text) texts.push(text);
      });
    }
    return texts;
  }

  extractHref($, $item, selectors) {
    for (const sel of selectors) {
      const href = $item.find(sel).first().attr('href');
      if (href) {
        return href.startsWith('http') ? href : `https://ilp.mit.edu${href}`;
      }
    }
    return '';
  }

  extractEmail($, $item) {
    const mailto = $item.find('a[href^="mailto:"]').first().attr('href');
    if (mailto) return mailto.replace('mailto:', '');

    const text = $item.text();
    const match = text.match(/[\w\.-]+@[\w\.-]+\.edu/);
    return match ? match[0] : '';
  }

  extractWebsites($, $item, primaryUrl) {
    const websites = primaryUrl ? [primaryUrl] : [];

    $item.find('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const fullUrl = href.startsWith('http') ? href :
                      href.startsWith('/') ? `https://ilp.mit.edu${href}` : null;

      if (fullUrl && !websites.includes(fullUrl)) {
        if (fullUrl.includes('mit.edu') ||
            fullUrl.includes('linkedin.com') ||
            fullUrl.includes('wikipedia.org') ||
            fullUrl.includes('scholar.google.com') ||
            fullUrl.includes('orcid.org')) {
          websites.push(fullUrl);
        }
      }
    });

    return websites;
  }

  determinePersonType(titles) {
    if (!titles || titles.length === 0) return 'researcher';

    const text = titles.join(' ').toLowerCase();

    if (text.includes('professor')) return 'faculty';
    if (text.includes('research scientist') || text.includes('principal research')) return 'research_scientist';
    if (text.includes('executive director') || text.includes('managing director')) return 'executive_director';
    if (text.includes('program manager') || text.includes('education manager')) return 'program_manager';
    if (text.includes('principal investigator')) return 'principal_investigator';
    if (text.includes('lecturer') || text.includes('instructor')) return 'lecturer';
    if (text.includes('postdoc')) return 'postdoc';
    if (text.includes('senior scientist') || text.includes('staff scientist')) return 'senior_scientist';

    return 'researcher';
  }

  slugify(text) {
    return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run scraper
const scraper = new MITPersonsScraper();
scraper.run().then(code => process.exit(code));