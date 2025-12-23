# MIT News Monitor

A tool for searching MIT news articles and generating member-tailored email drafts.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Create a `.env` file in the project root with your OpenAI API key:

```
OPENAI_API_KEY=your_api_key_here
```

### 3. Ensure Required Files

Make sure you have:
- `member-profiles.csv` in the project root (ILP member data)
- `mit_brain_test01.jsonl` in the project root (article database)

## Directory Structure

```
mit-news-monitor/
├── server.js              # Backend server (now with JSONL search)
├── member-profiles.csv    # ILP member data
├── mit_brain_test01.jsonl # Article database (searches ilpSummary & ilpKeywords)
├── package.json           # Dependencies
├── .env                   # Environment variables (you create this)
├── test-members.js        # Test script for CSV loading
├── test-search.js         # Test script for JSONL search
└── public/                # Frontend files
    ├── index.html         # Main UI
    └── app.js             # Frontend JavaScript
```

## Running the Server

```bash
npm start
```

Then open your browser to: http://localhost:3000

## Usage

### JSONL Article Format

The server loads articles from `mit_brain_test01.jsonl`. Each line should be a JSON object with these fields:

```json
{
  "title": "Article title",
  "url": "https://news.mit.edu/...",
  "date": "2024-11-15",
  "summary": "Brief summary",
  "ilpSummary": "Detailed ILP-focused summary (SEARCHABLE)",
  "ilpKeywords": ["keyword1", "keyword2", "keyword3"],
  "keywords": "general keywords",
  "industries": "Industry tags",
  "techThemes": "Technology themes",
  "mitUnit": "MIT department",
  "source": "MIT News"
}
```

**Note:** `ilpKeywords` can be either:
- An array of strings: `["keyword1", "keyword2", "keyword3"]`
- A comma-separated string: `"keyword1, keyword2, keyword3"`

Both formats are supported by the search function.

**Search behavior:**
- Searches the `ilpSummary` field (weight: 1.0)
- Searches the `ilpKeywords` field (weight: 0.8) - works with arrays or strings
- Also searches `title` as fallback (weight: 0.5)
- Results sorted by relevance score

### Using the Application

1. **Search Articles**: Enter a search phrase (e.g., "data centers") and optionally a minimum score
2. **Select Articles**: Check the articles you want to include in your email
3. **Choose Member & Tone**: 
   - Select an ILP member from the dropdown (optional - makes email more tailored)
   - Choose a tone (Familiar, Formal, or Funny)
4. **Generate Email**: Click "Generate Email" to create a personalized draft
5. **Copy & Use**: Click "Copy Email" to copy the draft to your clipboard

## Features

- **JSONL-based article database** - Fast in-memory search across all MIT Brain articles
- **Smart search** - Searches ilpSummary and ilpKeywords with relevance scoring
- **Member-specific personalization** - Uses member focus areas from CSV to tailor content
- Multiple tone options (Familiar, Formal, Funny)
- AI-generated introductions and article summaries
- Easy copy-to-clipboard functionality
- Real-time search results with relevance scoring

## Troubleshooting

### No search results
- Check that `mit_brain_test01.jsonl` exists in the project root
- Check the server console for JSONL parsing errors
- Verify your search phrase matches content in ilpSummary or ilpKeywords
- Try lowering the minimum score threshold

### Members dropdown is empty
- Check that `member-profiles.csv` exists in the project root
- Check the server console for CSV parsing errors
- Verify the CSV has the correct column headers

### Server won't start
- Make sure you have Node.js 18+ installed
- Run `npm install` to install dependencies
- Check that port 3000 is available

### Email generation fails
- Verify your OPENAI_API_KEY is set in `.env`
- Check the server console for API errors
- Ensure you have selected at least one article

### Testing the search
Run the test script to verify search is working:
```bash
node test-search.js
```
