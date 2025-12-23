# MIT Brain App - Documentation Index

Welcome to the updated MIT Brain App! This version supports multiple program directors, each with their own writing style, member portfolios, and customizable email templates.

## 📚 Documentation Navigation

### 🚀 For New Users
- **[QUICK-START.md](./QUICK-START.md)** - Installation and basic usage
- **[UI-GUIDE.md](./UI-GUIDE.md)** - Visual walkthrough of the interface

### 📖 For Understanding Changes
- **[CHANGES-SUMMARY.md](./CHANGES-SUMMARY.md)** - What's new in this version
- **[MULTI-PERSON-README.md](./MULTI-PERSON-README.md)** - Complete technical reference

## ⚡ Quick Facts

### New in This Version
- ✅ Multi-person support (Jim Flynn & Vin Verbose)
- ✅ Template system with variable replacement
- ✅ Personal voice styles ("My Voice" tone)
- ✅ Person-specific member portfolios
- ✅ Three new languages: Chinese, German, Italian

### Supported Languages (10 total)
Chinese • English • French • German • Hindi • Italian • Japanese • Korean • Portuguese • Spanish

### Template Types (4 per person)
- Startup Listing
- Topic List  
- Faculty Meeting Prep
- Just A List

## 🎯 Quick Links

Task | See Document | Section
--- | --- | ---
Install and run | [QUICK-START.md](./QUICK-START.md) | Installation
Learn the UI | [UI-GUIDE.md](./UI-GUIDE.md) | All sections
Add a person | [MULTI-PERSON-README.md](./MULTI-PERSON-README.md) | Adding New Program Directors
Create template | [MULTI-PERSON-README.md](./MULTI-PERSON-README.md) | Adding New Templates
Customize voice | [QUICK-START.md](./QUICK-START.md) | Customization
API reference | [MULTI-PERSON-README.md](./MULTI-PERSON-README.md) | API Endpoints
Troubleshoot | [QUICK-START.md](./QUICK-START.md) | Troubleshooting

## 📂 Project Structure

```
mit-brain-app-v03-updated/
├── server.js                    # Backend
├── public/
│   ├── index.html              # UI
│   └── app.js                  # Frontend
└── people/                      # Multi-person support
    ├── Jim-Flynn/
    │   ├── my-voice.txt
    │   ├── member-profiles.csv
    │   └── templates/
    └── Vin-Verbose/
        ├── my-voice.txt
        ├── member-profiles.csv
        └── templates/
```

## 🚀 Getting Started

```bash
cd mit-brain-app-v03-updated
npm install
export OPENAI_API_KEY='your-key'
node server.js
# Visit http://localhost:3000
```

**Ready to begin? → [QUICK-START.md](./QUICK-START.md)**
