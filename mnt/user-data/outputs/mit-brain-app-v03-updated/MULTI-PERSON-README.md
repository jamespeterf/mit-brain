# MIT Brain App - Multi-Person Architecture Update

## Overview
This update transforms the MIT Brain App to support multiple program directors, each with their own writing style, member portfolios, and email templates.

## New Features

### 1. Multi-Person Support
- Users select a program director from a dropdown before generating content
- Each person has their own directory under `/people/`
- Directory structure: `/people/{Person-Name}/`

### 2. Personal Voice Styles
- Each person has a `my-voice.txt` file describing their writing style
- "My Voice" added as a tone option in the UI
- AI uses the person's voice instructions when generating text

### 3. Template System
- Each person has a `/templates/` subdirectory with email templates
- Templates use `{{variable}}` syntax for placeholders:
  - `{{Point-of-Contact}}` - Replaced with member's point of contact name
  - `{{knowledge-list}}` - Replaced with AI-generated article summaries
- Templates allow consistent formatting while personalizing content

### 4. Person-Specific Member Lists
- Each person has their own `member-profiles.csv` file
- Members dropdown updates when a person is selected
- Supports different portfolios for different program directors

## Directory Structure

```
/people/
├── Jim-Flynn/
│   ├── my-voice.txt
│   ├── member-profiles.csv
│   └── templates/
│       ├── startup-listing.txt
│       ├── topic-list.txt
│       ├── faculty-meeting-prep.txt
│       └── just-a-list.txt
└── Vin-Verbose/
    ├── my-voice.txt
    ├── member-profiles.csv
    └── templates/
        ├── startup-listing.txt
        ├── topic-list.txt
        ├── faculty-meeting-prep.txt
        └── just-a-list.txt
```

## Example Files

### my-voice.txt (Jim Flynn)
```
I tend to get right to the point quickly with a friendly and relaxed tone. 
I never start emails with repetitive phrases like "I hope this email finds you well."
I rarely use words like "align," preferring words that appear more often in common speech, like "match" instead.
I almost never use long dashes.
I sometimes like to make my emails more enjoyable with humor.
The greetings in my emails are sentences like "Hello, John." instead of "Dear John," or "Hi John,"
```

### Template Example (startup-listing.txt)
```
Hi, {{Point-of-Contact}}.

I've compiled a list of MIT-connected startups that are potentially relevant to your company. All of the companies listed below participate in our MIT Startup Exchange program:

{{knowledge-list}}

Please let me know if you need more information, or if you'd like me to connect you with any of these companies.

Best regards,
Jim
```

## API Endpoints

### New Endpoints
- `GET /api/people` - List all program directors
- `GET /api/people/:personId/data` - Get person's my-voice and templates list
- `GET /api/people/:personId/templates/:templateId` - Get template content
- `POST /api/generate-template-text` - Generate text using templates

### Updated Endpoints
- `GET /api/members?personId=X` - Now accepts personId parameter to load person-specific members

## User Interface Changes

### Knowledge List Section
1. **Program Director dropdown** - Select which person to use
2. **Template dropdown** - Select email template (appears after person selection)
3. **ILP Member dropdown** - Select target company (updates based on selected person)
4. **Tone dropdown** - Now includes "My Voice" option
5. **Language dropdown** - Unchanged (Chinese, German, and Italian added)

## Workflow

1. User searches for relevant MIT knowledge
2. User selects articles from search results
3. User selects a **Program Director** from dropdown
4. System loads that person's templates and member list
5. User selects a **Template** (optional)
6. User selects an **ILP Member** (optional, for personalization)
7. User selects **Tone** (including "My Voice" option)
8. User selects **Language**
9. User clicks "Generate List"
10. System:
    - Generates AI summaries for each article
    - Uses person's voice style if "My Voice" tone selected
    - Replaces template variables if template selected
    - Returns formatted text ready to copy

## Language Support

The following languages are now fully supported:
- Chinese (Simplified)
- English
- French
- German
- Hindi
- Italian
- Japanese
- Korean
- Portuguese
- Spanish

## Adding New Program Directors

1. Create directory: `/people/New-Person-Name/`
2. Add `my-voice.txt` with their writing style
3. Add `member-profiles.csv` with their member portfolio
4. Create `/people/New-Person-Name/templates/` directory
5. Add template files (*.txt) with {{variable}} placeholders
6. Restart server - new person appears automatically in dropdown

## Adding New Templates

1. Navigate to person's templates directory
2. Create new .txt file with template name (e.g., `conference-invitation.txt`)
3. Use `{{Point-of-Contact}}` and `{{knowledge-list}}` variables as needed
4. Template appears automatically in dropdown when person is selected

## Technical Implementation

### Backend (server.js)
- New `/api/people` endpoints for managing person data
- Updated `loadMembers()` to support person-specific CSVs with caching
- Updated `toneInstruction()` to accept myVoice parameter
- New `/api/generate-template-text` endpoint for template-based generation
- Template variable replacement: `{{Point-of-Contact}}`, `{{knowledge-list}}`

### Frontend (app.js)
- New state variables: `currentPersonData`, `currentMembers`
- `handlePersonSelect()` - Loads person data and updates UI
- Updated `handleGenerateEmailClick()` - Uses new template endpoint
- Dynamic UI updates based on selected person

### UI (index.html)
- Added Program Director selector
- Added Template selector (hidden until person selected)
- Updated layout to show options after person selection
- Added "My Voice" to tone dropdown

## Testing

Run the server:
```bash
cd mit-brain-app-v03-updated
npm install
node server.js
```

Visit: http://localhost:3000

Test workflow:
1. Search for articles (e.g., "data centers")
2. Select some results
3. Choose "Jim Flynn" from Program Director
4. Choose "Startup Listing" template
5. Choose a member (optional)
6. Choose "My Voice" tone
7. Generate list
8. Verify text uses Jim's style and template format

## Notes

- Person directory names use hyphens (e.g., `Jim-Flynn`)
- Display names remove hyphens (e.g., "Jim Flynn")
- Template names are auto-formatted (e.g., `startup-listing.txt` → "Startup Listing")
- Member CSV must include "Point-of-Contact" column for template replacement
- If no template selected, only the knowledge list is generated
- My Voice only applies if "myvoice" tone is selected

## Migration from Old Version

If migrating from the previous version:
1. Create person directories for existing users
2. Move existing `member-profiles.csv` to appropriate person directory
3. Create basic templates (at minimum: `just-a-list.txt` with just `{{knowledge-list}}`)
4. Write `my-voice.txt` based on each person's typical communication style
5. Update any custom code that directly accessed member data
