# Quick Start Guide - MIT Brain App (Multi-Person Edition)

## Installation

1. Navigate to the project directory:
```bash
cd mit-brain-app-v03-updated
```

2. Install dependencies (if not already installed):
```bash
npm install
```

3. Set your OpenAI API key:
```bash
export OPENAI_API_KEY='your-api-key-here'
```

4. Start the server:
```bash
node server.js
```

5. Open your browser to: http://localhost:3000

## Using the App

### Step 1: Search for Knowledge
- Enter a search term (e.g., "data centers", "artificial intelligence", "batteries")
- Click "Search Knowledge Base"
- Results appear below with articles, videos, papers, startups, etc.

### Step 2: Select Relevant Content
- Check the boxes next to articles you want to include
- Use "Select All" / "Deselect All" buttons for convenience
- Filter by type: Videos, News, Academic Papers, Startups, Events

### Step 3: Choose Your Program Director
- In the "Knowledge List" section, select a program director:
  - **Jim Flynn** - Casual, direct, friendly style
  - **Vin Verbose** - Formal, detailed, polished style
- Once selected, the interface expands to show more options

### Step 4: Select a Template
- Choose from templates like:
  - **Startup Listing** - Formatted for sharing startup companies
  - **Topic List** - General research topics
  - **Faculty Meeting Prep** - Meeting preparation format
  - **Just A List** - Simple knowledge list with no wrapper text

### Step 5: Optional - Select a Member Company
- Choose a company to personalize the content for
- AI will tailor summaries to that company's interests
- Leave blank for general content

### Step 6: Choose Your Tone
- **Familiar** (default) - Warm and collegial
- **Formal** - Professional and polished
- **Funny** - Friendly with light humor
- **My Voice** - Uses the selected person's writing style from their my-voice.txt

### Step 7: Select Language
Choose from 10 languages:
- Chinese, English, French, German, Hindi
- Italian, Japanese, Korean, Portuguese, Spanish

### Step 8: Generate!
- Click "Generate List"
- AI creates personalized summaries for each article
- Template variables are filled in automatically
- Result appears in the output box below

### Step 9: Copy and Use
- Click "Copy List" to copy to clipboard
- Paste into your email client
- Edit as needed before sending

## Example Workflows

### Workflow 1: Quick Startup List
1. Search: "autonomous vehicles"
2. Filter: Check only "Startups"
3. Select relevant startups
4. Person: Jim Flynn
5. Template: Startup Listing
6. Member: Oshkosh Corporation
7. Tone: My Voice
8. Language: English
9. Generate!

Result: Personalized email about autonomous vehicle startups relevant to Oshkosh

### Workflow 2: Research Summary for International Partner
1. Search: "renewable energy"
2. Select: Mix of news, papers, and videos
3. Person: Vin Verbose  
4. Template: Topic List
5. Member: (Leave blank for general)
6. Tone: Formal
7. Language: German
8. Generate!

Result: Formal German-language summary of MIT renewable energy research

### Workflow 3: Meeting Prep Notes
1. Search: "quantum computing"
2. Select: Recent papers and news
3. Person: Jim Flynn
4. Template: Faculty Meeting Prep
5. Member: (Leave blank)
6. Tone: Familiar
7. Language: English
8. Generate!

Result: Casual, direct meeting prep notes about quantum computing

## Tips

- **Be Specific in Searches**: "solar panels" is better than "energy"
- **Mix Content Types**: Include news, papers, and startups for variety
- **Use My Voice**: Each person's style is captured in their my-voice.txt
- **Test Templates**: Each template formats content differently
- **Personalize**: Including a member company makes content much more relevant
- **Language Quality**: All 10 languages are fully supported with native speakers in mind

## Customization

### Add a New Person
1. Create folder: `/people/Your-Name/`
2. Add `my-voice.txt` with your writing style
3. Add `member-profiles.csv` with your companies
4. Create `/people/Your-Name/templates/` folder
5. Add template files
6. Restart server → You appear in dropdown!

### Add a New Template
1. Go to your templates folder: `/people/Your-Name/templates/`
2. Create new file: `my-template.txt`
3. Add content with `{{Point-of-Contact}}` and `{{knowledge-list}}` where needed
4. Save → Template appears automatically!

### Edit Your Voice
1. Edit `/people/Your-Name/my-voice.txt`
2. Save changes
3. Select "My Voice" tone when generating
4. AI follows your updated style

## Troubleshooting

**Problem**: Person dropdown is empty
- **Solution**: Check that `/people/` directory exists and has person folders

**Problem**: Templates don't appear
- **Solution**: Ensure templates are .txt files in `/people/Person-Name/templates/`

**Problem**: Members don't load
- **Solution**: Check that `member-profiles.csv` exists in person's folder

**Problem**: AI doesn't use my voice
- **Solution**: Make sure "My Voice" is selected in Tone dropdown

**Problem**: Template variables not replaced
- **Solution**: Check spelling: `{{Point-of-Contact}}` and `{{knowledge-list}}`

**Problem**: Language output is wrong
- **Solution**: Verify language selection matches desired output

## Support

For questions or issues:
1. Check the MULTI-PERSON-README.md for detailed documentation
2. Check the CHANGES-SUMMARY.md for what's new
3. Review console logs in browser (F12 → Console)
4. Review server logs in terminal

## What's New

This version adds:
- ✅ Multi-person support with individual styles
- ✅ Template system with variable replacement
- ✅ Personal voice tones (My Voice option)
- ✅ Person-specific member portfolios
- ✅ Three new languages (Chinese, German, Italian)
- ✅ Enhanced UI with dynamic person/template selection

Enjoy your personalized, multi-person MIT Brain App!
