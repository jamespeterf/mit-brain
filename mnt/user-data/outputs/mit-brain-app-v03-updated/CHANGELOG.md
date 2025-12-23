# CHANGELOG - MIT Brain App

## Version 3.2 - Kind-Based Filtering (Dec 7, 2024)

### New Feature: Filter by Content Type
Added ability to filter search results by content type (kind):

**Filter Options:**
- 🎬 Video
- 📰 News  
- 📄 Academic Paper
- 🚀 Startup
- 📅 Event (for future use)

**Quick Actions:**
- "Select All" button - Checks all type filters
- "Deselect All" button - Unchecks all type filters

### How It Works
- All types are selected by default
- Uncheck types you don't want to see in results
- Search results are filtered client-side after fetching from server
- Filters apply immediately on search

### UI Changes
- Added "Filter by Type" section below search controls
- Checkboxes for each content type
- Visual filter controls with gray background

### Benefits
- Focus on specific content types
- Quickly filter out irrelevant types
- Combine with text search for precise results
- Example: Search "AI" + only "Video" = AI videos only

### Technical Details
- Client-side filtering using `filterMatchesByKind()` function
- Handles lowercase kind values
- Returns empty array if no kinds selected
- Console logging shows filter activity

## Version 3.1 - Enhanced Search & UI Refinements (Dec 7, 2024)

### UI Text Updates
- **"Find Relevant MIT News"** → **"Find Relevant MIT Knowledge"**
- **"Search Articles"** button → **"Search Knowledge Base"**
- **"Generate Email"** button → **"Generate List"**
- **"Copy Email"** button → **"Copy List"**
- **"Email Draft"** heading → **"Knowledge List"**

### Enhanced Search Functionality
Added comprehensive search across more fields:
- **ilpSummary** (score +1.0) - Highest priority
- **ilpKeywords** (score +0.8)
- **fullText** (score +0.7) - NEW!
- **tags** (score +0.6) - NEW!
- **authors** (score +0.5) - NEW!
- **title** (score +0.5)

### Benefits
- More comprehensive search results
- Better discovery of relevant content
- Search by author names
- Find articles by tags
- Full-text search capability
- Clearer UI terminology

### Technical Details
Search now handles both array and string formats for:
- ilpKeywords (existing)
- tags (new)
- authors (new)

## Version 3.0 - Rebranding & Hindi Language (Dec 7, 2024)

### Major Rebranding
- **Project renamed**: "MIT News Monitor" → "MIT Brain App"
- **Main heading**: Changed from "MIT News Monitor" to "MIT Brain"
- **UI text updated**: "Matching Articles" → "Matching Knowledge"
- **Package name**: Updated package.json from "mit-news-monitor" to "mit-brain-app"

### New Language Support
- 🇮🇳 **Hindi** (हिन्दी) - Full support added
  - Language dropdown includes Hindi option
  - Hindi language instructions with Devanagari script
  - System prompts updated with Hindi support
  - Test page includes Hindi test button
  - YouTube CC parameter: `cc_lang_pref=hi`

### UX Improvements
- **Default min score**: Changed from 0 to 1 for better quality results
  - Input field now has `value="1"` as default
  - JavaScript fallback changed from 0 to 1
  - More relevant search results by default

### Languages Now Supported (7 Total)
- 🇺🇸 English
- 🇪🇸 Spanish
- 🇧🇷 Portuguese
- 🇫🇷 French
- 🇯🇵 Japanese
- 🇰🇷 Korean
- 🇮🇳 Hindi (NEW!)

### Files Changed
- `public/index.html` - Updated title, heading, min score default, UI text, added Hindi option
- `public/app.js` - Added Hindi to YouTube language codes, updated min score fallback
- `server.js` - Added Hindi language instructions and system prompts
- `public/test-language.html` - Added Hindi test button
- `package.json` - Updated project name and description

## Version 2.8.2 - Fixed Payload Size Limit (Dec 7, 2024)

### Bug Fix
- **Increased request payload limit**: Changed from default 100kb to 10mb to handle large article selections
- Fixes "PayloadTooLargeError: request entity too large" error when selecting many articles or articles with large content
- Added urlencoded parser with same limit for completeness

### Technical Changes
- Changed `express.json()` to `express.json({ limit: '10mb' })`
- Added `express.urlencoded({ limit: '10mb', extended: true })`

### Impact
- Can now select as many articles as needed without payload errors
- Supports articles with very long content (videos with full transcripts, long papers, etc.)

## Version 2.8.1 - Critical Link Fix (Dec 7, 2024)

### Bug Fixes
- **Fixed clickable links**: Removed `contenteditable="true"` from emailOutput div which was preventing links from being clickable
- **Fixed link underline**: Updated CSS to show underlines on links by default instead of only on hover
- **Added extensive logging**: Console now shows detailed information about URLs and link generation for debugging

### Issues Resolved
- Links in generated emails are now actually clickable
- Links are visibly underlined to indicate they're clickable
- Clicking a title now opens the article URL as expected

### Technical Changes
- Removed `contenteditable="true"` attribute from `#emailOutput` div in index.html
- Changed CSS `#emailOutput a` from `text-decoration: none;` to `text-decoration: underline;`
- Added hover state with darker blue color
- Added console logging for article URLs, link HTML, and final DOM link count

## Version 2.8 - Email Format Improvements (Dec 7, 2024)

### UI/UX Improvements
- **Underlined hyperlinks**: Article titles in generated emails now have underline decoration to be clearly identifiable as clickable links
- **Removed keywords**: ILP keywords (🔑) no longer appear in generated emails for cleaner, more professional appearance
  - Keywords still visible in article search results
  - Keywords still used by AI for personalization
  - Just not displayed in final email output

### Changes
- Changed title link style from `text-decoration: none;` to `text-decoration: underline;`
- Removed ILP keywords display section from email generation

### Benefits
- More obvious that titles are clickable
- Cleaner email appearance
- Better matches standard email formatting conventions

## Version 2.7 - YouTube Closed Captions Auto-Selection (Dec 7, 2024)

### New Feature: Automatic CC Language Parameters
- YouTube video URLs now automatically include `cc_lang_pref` parameter for non-English languages
- When generating emails in Spanish, Portuguese, French, Japanese, or Korean, video links will open with appropriate closed captions pre-selected
- Improves accessibility and user experience for international members

### Language Code Mapping
- Spanish → `cc_lang_pref=es`
- Portuguese → `cc_lang_pref=pt`
- French → `cc_lang_pref=fr`
- Japanese → `cc_lang_pref=ja`
- Korean → `cc_lang_pref=ko`

### Technical Implementation
- Added `getYouTubeLangCode()` helper function
- Added `addYouTubeCCParam()` function to modify video URLs
- Only modifies URLs for videos (kind === "video")
- Only modifies YouTube URLs (youtube.com or youtu.be)
- Console logging shows when CC parameter is added

### Example
Before: `https://youtube.com/watch?v=abc123`
After (Spanish): `https://youtube.com/watch?v=abc123&cc_lang_pref=es`

## Version 2.6.1 - Translation Fix for French/Japanese/Korean (Dec 7, 2024)

### Bug Fixes
- Strengthened language instructions for French, Japanese, and Korean
- Added native language instructions to system prompts
- All six languages now translate correctly

## Version 2.6 - Added French, Japanese, and Korean (Dec 7, 2024)

### New Languages
- 🇫🇷 **French** (français)
- 🇯🇵 **Japanese** (日本語)
- 🇰🇷 **Korean** (한국어)

### Changes
- Added French, Japanese, and Korean to language dropdown
- Added language instructions with proper Unicode support for Japanese and Korean
- Included appropriate business formality (keigo for Japanese, honorifics for Korean)
- Updated test page to include all six languages

### Languages Now Supported
- 🇺🇸 English
- 🇪🇸 Spanish
- 🇧🇷 Portuguese
- 🇫🇷 French
- 🇯🇵 Japanese
- 🇰🇷 Korean

## Version 2.5.2 - Debug Tools (Dec 7, 2024)

### Debug Features
- Added extensive console logging for troubleshooting
- Created test page at `/test-language.html`
- Added test API endpoint for isolated translation testing
- Strengthened language instruction prompts

## Version 2.5 - Multi-Language Support (Dec 7, 2024)

### New Feature
- **Language selector**: Generate emails in English, Spanish, or Portuguese
- Added language dropdown in email generation panel
- Full email content (intro + summaries) generated in selected language
- Professional business language appropriate for corporate communication

### Technical Changes
- Added `languageInstruction()` helper function
- Updated `/api/member-intro` to accept and use language parameter
- Updated `/api/member-article-summaries` to accept and use language parameter
- Frontend captures language selection and passes to backend

### Languages Supported
- 🇺🇸 English (default)
- 🇪🇸 Spanish
- 🇧🇷 Portuguese (Brazilian)

## Version 2.4 - HTML Email Format & Styling (Dec 7, 2024)

### New Features
- **HTML-formatted emails**: Rich HTML output with styled article boxes
- **Dates in emails**: Each article now shows its publication date
- **Black keywords**: Changed from blue (#0066cc) to black (#333) to avoid looking like links

### Improvements
- Professional email formatting with visual hierarchy
- Clickable article titles in generated emails
- Source type badges included in email output
- Better readability and scannability
- Copy with formatting preserved

### Technical Changes
- Rewrote email generation to build HTML
- Updated CSS for HTML content display
- Added max-height and scrolling for long emails
- Enhanced copy function to preserve formatting

## Version 2.3 - ILP Fields and Source Type Display (Dec 7, 2024)

### New Features
- **Source type badges**: Display `[NEWS]`, `[PAPER]`, `[VIDEO]`, `[STARTUP]` badges on articles
- **ILP Summary display**: Shows `ilpSummary` instead of generic `summary` field
- **ILP Keywords display**: Shows `ilpKeywords` with 🔑 icon in blue italics
- **Enhanced OpenAI prompts**: Uses `ilpSummary` and `ilpKeywords` for email generation

### Benefits
- Immediately see article source type
- More relevant, ILP-focused content displayed
- Better keyword visibility for scanning
- Improved AI-generated email quality

## Version 2.2 - __dirname Initialization Fix (Dec 6, 2024)

### Issue Fixed
Fixed `ReferenceError: Cannot access '__dirname' before initialization` by moving `__dirname` initialization to the top of server.js, before its first use.

### Changes
- Moved `__filename` and `__dirname` setup to lines 16-18 (after imports)
- Removed duplicate initialization that was at line 114-115

## Version 2.1 - Array Handling Fix (Dec 6, 2024)

### Issue Fixed
Fixed `TypeError: (article.ilpKeywords || "").toLowerCase is not a function` by adding support for both array and string formats in the `ilpKeywords` field.

### Changes
- Updated search function to handle `ilpKeywords` as either array or string
- Works with both `["keyword1", "keyword2"]` and `"keyword1, keyword2"` formats

## Version 2.0 - JSONL Search Implementation

### What Changed

**Search Implementation:**
- ✅ Removed dependency on `mit-news-search.js` module
- ✅ Implemented direct JSONL file reading (`mit_brain_test01.jsonl`)
- ✅ Articles loaded into memory on server startup
- ✅ Search now focuses on `ilpSummary` and `ilpKeywords` fields
- ✅ Relevance scoring system implemented

### Search Scoring

The search function assigns scores based on where matches are found:
- **ilpSummary** match: +1.0 points
- **ilpKeywords** match: +0.8 points (handles both arrays and strings)
- **title** match: +0.5 points (fallback)

Results are sorted by total relevance score (highest first).

**Important:** The search function automatically handles `ilpKeywords` whether it's:
- An array: `["keyword1", "keyword2", "keyword3"]`
- A string: `"keyword1, keyword2, keyword3"`

### JSONL Format

Each line in `mit_brain_test01.jsonl` should be a complete JSON object:

```json
{
  "title": "Article title",
  "url": "https://news.mit.edu/article-url",
  "date": "2024-11-15",
  "summary": "Brief summary for display",
  "ilpSummary": "Detailed ILP-focused summary (SEARCHED)",
  "ilpKeywords": ["keyword1", "keyword2", "keyword3"],
  "keywords": "general, keywords",
  "industries": "Industry1, Industry2",
  "techThemes": "Theme1, Theme2",
  "mitUnit": "MIT Department",
  "ilpAudiences": "Audience types",
  "source": "MIT News"
}
```

**Note:** `ilpKeywords` can be either an array `["kw1", "kw2"]` or a string `"kw1, kw2"`. Both are supported.

### Sample Data

A sample `mit_brain_test01.jsonl` with 5 articles is included:
1. AI model for climate prediction
2. Solid-state battery technology
3. Quantum error correction
4. Warehouse robotics
5. Data center cooling

### Testing

Two test scripts are provided:

**test-members.js** - Verify CSV member loading
```bash
node test-members.js
```

**test-search.js** - Verify JSONL search functionality
```bash
node test-search.js
```

Expected output: Successfully loads articles and demonstrates search results for various queries.

### Migration Notes

**If you have existing data:**
1. Replace `mit_brain_test01.jsonl` with your actual MIT Brain JSONL export
2. Ensure each record has `ilpSummary` and `ilpKeywords` fields
3. Other fields (title, url, date, etc.) should match your existing schema

**Breaking Changes:**
- No longer uses `mit-news-search.js` module
- Search is now synchronous (not async)
- Requires `mit_brain_test01.jsonl` to exist for search to work

### Performance

- Articles loaded once on server startup
- In-memory search is very fast (< 1ms for typical queries)
- No external dependencies for search
- Server restart required to reload new JSONL data

### Next Steps

1. Replace sample JSONL with your actual MIT Brain data
2. Verify search works with `node test-search.js`
3. Start server and test through web interface
4. Adjust scoring weights if needed (edit server.js search function)
