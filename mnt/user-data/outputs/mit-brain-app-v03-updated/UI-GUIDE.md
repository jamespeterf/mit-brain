# UI Guide - Updated Interface

## Initial View (Before Person Selection)

```
┌─────────────────────────────────────────────────────────────┐
│ MIT Brain                                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Find Relevant MIT Knowledge                                 │
│ ┌─────────────────┐ ┌────────────┐                        │
│ │ Search phrase   │ │ Min score  │ [Search] [Clear]       │
│ └─────────────────┘ └────────────┘                        │
│                                                             │
│ Filter by Type: [Select All] [Deselect All]               │
│ ☑ Videos  ☑ News  ☑ Papers  ☑ Startups  ☑ Events        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Matching Knowledge                                          │
│ [Select All] [Deselect All]                                │
│                                                             │
│ (Search results appear here)                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Knowledge List                                              │
│                                                             │
│ Program Director: [Select a person...            ▼]        │
│                                                             │
│ (Options hidden until person selected)                      │
└─────────────────────────────────────────────────────────────┘
```

## After Selecting a Person (e.g., "Jim Flynn")

```
┌─────────────────────────────────────────────────────────────┐
│ Knowledge List                                              │
│                                                             │
│ Program Director: [Jim Flynn                      ▼]        │
│                                                             │
│ Template:    [Startup Listing                    ▼]        │
│ ILP Member:  [(Optional: tailor to member)      ▼]        │
│                                                             │
│ Tone:        [My Voice        ▼]  Language: [English  ▼]  │
│                                                             │
│              [Generate List]                                │
│                                                             │
│ Select one or more articles above, then click               │
│ "Generate List".                                            │
│                                                             │
│ [Copy List]                                                 │
│ ┌─────────────────────────────────────────────────────────┐│
│ │                                                          ││
│ │  (Generated text appears here)                           ││
│ │                                                          ││
│ └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Dropdown Options

### Program Director Dropdown
```
┌──────────────────────────┐
│ Select a person...       │ ← Default
│ Jim Flynn               │
│ Vin Verbose             │
└──────────────────────────┘
```

### Template Dropdown (Jim Flynn)
```
┌──────────────────────────┐
│ Select a template...     │ ← Default
│ Faculty Meeting Prep     │
│ Just A List             │
│ Startup Listing         │
│ Topic List              │
└──────────────────────────┘
```

### Template Dropdown (Vin Verbose)
```
┌──────────────────────────┐
│ Select a template...     │ ← Default
│ Faculty Meeting Prep     │
│ Just A List             │
│ Startup Listing         │
│ Topic List              │
└──────────────────────────┘
```

### ILP Member Dropdown (Jim Flynn's Companies)
```
┌──────────────────────────┐
│ (Optional: tailor...)    │ ← Default
│ Oshkosh Corporation      │
│ FM                      │
│ Royal Caribbean Group    │
│ Humana                  │
│ ...                     │
└──────────────────────────┘
```

### Tone Dropdown
```
┌──────────────────────────┐
│ Familiar                │ ← Default
│ Formal                  │
│ Funny                   │
│ My Voice                │ ← NEW!
└──────────────────────────┘
```

### Language Dropdown
```
┌──────────────────────────┐
│ Chinese                 │ ← NEW!
│ English                 │
│ French                  │
│ German                  │ ← NEW!
│ Hindi                   │
│ Italian                 │ ← NEW!
│ Japanese                │
│ Korean                  │
│ Portuguese              │
│ Spanish                 │
└──────────────────────────┘
```

## User Flow Example

### Step 1: Initial State
```
Program Director: [Select a person...            ▼]

(Everything else hidden)
```

### Step 2: After Selecting "Jim Flynn"
```
Program Director: [Jim Flynn                      ▼]

Template:    [Select a template...               ▼]  ← NOW VISIBLE
ILP Member:  [(Optional: tailor to member)      ▼]  ← NOW VISIBLE

Tone:        [Familiar        ▼]  Language: [English  ▼]  ← NOW VISIBLE

             [Generate List]                           ← NOW VISIBLE
```

### Step 3: Making Selections
```
Program Director: [Jim Flynn                      ▼]

Template:    [Startup Listing                    ▼]
ILP Member:  [Oshkosh Corporation               ▼]

Tone:        [My Voice        ▼]  Language: [English  ▼]

             [Generate List]
```

### Step 4: After Clicking "Generate List"
```
[Copy List]
┌─────────────────────────────────────────────────────────┐
│ Hi, Chris.                                              │
│                                                         │
│ I've compiled a list of MIT-connected startups that    │
│ are potentially relevant to your company. All of the   │
│ companies listed below participate in our MIT Startup  │
│ Exchange program:                                       │
│                                                         │
│ TechDrive Systems focuses on autonomous vehicle        │
│ platforms that could match Oshkosh's interest in       │
│ mobility and electrification...                        │
│                                                         │
│ BatteryNext develops next-generation battery           │
│ systems specifically for heavy-duty vehicles...        │
│                                                         │
│ Please let me know if you need more information, or    │
│ if you'd like me to connect you with any of these      │
│ companies.                                              │
│                                                         │
│ Best regards,                                           │
│ Jim                                                     │
└─────────────────────────────────────────────────────────┘
```

## Key UI Changes from Previous Version

### Before (Old Version)
```
ILP Member:  [(Optional: tailor email to member) ▼]
Tone:        [Familiar  ▼]  Language: [English     ▼]
             [Generate List]
```

### After (New Version)
```
Program Director: [Select a person...            ▼]  ← NEW!

[After person selection:]

Template:    [Select a template...               ▼]  ← NEW!
ILP Member:  [(Optional: tailor to member)      ▼]
Tone:        [My Voice  ▼]  Language: [English     ▼]  ← My Voice added
             [Generate List]
```

## Visual Indicators

### When No Person Selected
- Person dropdown shows: "Select a person..."
- All other options are **hidden**
- Generate List button is **visible** but will show error if clicked

### When Person Selected
- Person dropdown shows: selected person name
- All options become **visible**
- Member dropdown populates with that person's companies
- Template dropdown populates with that person's templates
- Tone dropdown includes "My Voice" option

### During Generation
- Progress overlay appears with spinner
- Text: "Asking AI to draft your text..."
- UI is disabled during generation

### After Generation
- Progress overlay disappears
- Generated text appears in output box
- "Copy List" button becomes functional
- Links in text are clickable

## Responsive Behavior

The interface adapts to selections:

1. **No person selected** → Minimal UI
2. **Person selected** → Full UI with person-specific data
3. **Template selected** → Template structure applied to output
4. **Member selected** → Content personalized for that member
5. **My Voice selected** → Tone matches person's writing style
6. **Language selected** → Output in chosen language

## Error States

### If Generate Clicked Without Selections
```
┌─────────────────────────────────────────────────────┐
│ Please select a program director first.             │
└─────────────────────────────────────────────────────┘
```

### If Generate Clicked Without Articles
```
┌─────────────────────────────────────────────────────┐
│ Please select at least one article.                 │
└─────────────────────────────────────────────────────┘
```

## Color Scheme

- Primary action buttons: Blue (#0065a4)
- Copy button: Green (#5d9b3d)
- Secondary buttons: Gray (#444)
- Clear button: Gray (#999)
- Links: Blue (#0065a4)
- Error text: Red (#d32f2f)
- Hint text: Gray (#555)

## Typography

- Headers: Bold, larger font
- Body text: Arial, sans-serif
- Output text: Same as body, line-height 1.6
- Placeholder text: Lighter gray

This updated interface provides a more guided, step-by-step experience while maintaining the flexibility to customize every aspect of the generated content.
