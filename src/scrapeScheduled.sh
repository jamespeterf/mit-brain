#!/bin/bash

# ============================================================
# MIT Brain Data Collection Script
# ============================================================
# This script orchestrates scheduled MIT Brain data collection scrapers.
# Comment out sections you don't want to run.
#
# REQUIRED ENVIRONMENT VARIABLES (set before running):
#   YOUTUBE_API_KEY - For public YouTube channel scraping (Step S02)
#                     Get from: https://console.cloud.google.com/
# ============================================================

# ============================================================
# Global Configuration
# ============================================================

export START_DATE="2024-09-01"  # Filter out news older than this date

# Brain filename (without extension)
export MIT_BRAIN="mit_brain_test17"

# Directories
export DATA_DIR="data"
export OUTPUT_DIR="output"
export LOGS_DIR="logs"

# Generate run ID for this session (for logging)
export MIT_BRAIN_RUN_ID=$(date +"%Y%m%d_%H%M%S")

# Create directories if they don't exist
mkdir -p "$OUTPUT_DIR/csv"
mkdir -p "$OUTPUT_DIR/jsonl"
mkdir -p "$OUTPUT_DIR/captions"
mkdir -p "$LOGS_DIR"

echo "============================================================"
echo "MIT Brain Knowledge Collection"
echo "============================================================"
echo "Brain: $MIT_BRAIN"
echo "Run ID: $MIT_BRAIN_RUN_ID"
echo "Log: ${LOGS_DIR}/${MIT_BRAIN}_${MIT_BRAIN_RUN_ID}.log"
echo "============================================================"
echo ""

# ============================================================
# Initialize Brain File
# ============================================================

# Create empty brain file if it doesn't exist
BRAIN_FILE="${OUTPUT_DIR}/jsonl/${MIT_BRAIN}.jsonl"

if [ ! -f "$BRAIN_FILE" ]; then
    echo "📝 Initializing new brain file: $BRAIN_FILE"
    mkdir -p "${OUTPUT_DIR}/jsonl"
    touch "$BRAIN_FILE"
    echo "✅ Created empty brain file"
else
    echo "📝 Using existing brain file: $BRAIN_FILE"
fi
echo ""

# ============================================================
# YouTube Videos Configuration
# ============================================================
# Playlist scraping
#export SCRAPE_ALL_PLAYLISTS=true
export PLAYLIST_FILE="ilpPlaylists.csv"  # File in DATA_DIR
# export YOUTUBE_PLAYLIST_ID="PLJvJ-6UyehQDPreynfUJ1iqr0YMV41TBW"  # Uncomment to scrape single playlist

echo "============================================================"
echo "Step S01: Scraping ILP and STEX YouTube Videos"
echo "============================================================"
#node scrapers/scrapeIlpVideos.js

# ============================================================
# Public YouTube Channels Configuration
# ============================================================
# export YOUTUBE_API_KEY="YOUR_API_KEY_HERE"  # Set your YouTube Data API key
export CHANNEL_FILE="publicYouTubeChannels.txt"  # File in DATA_DIR
# export MAX_CHANNELS=5  # Uncomment to limit number of channels
# export MAX_PLAYLISTS=10  # Uncomment to limit playlists per channel
# export MAX_VIDEOS=100  # Uncomment to limit videos per channel

echo ""
echo "============================================================"
echo "Step S02: Scraping Public MIT YouTube Channels"
echo "============================================================"
#node scrapers/scrapePublicYouTube.js
YOUTUBE_API_KEY="AIzaSyBhHk5Vwl8JOUemyf2AfJIcPfX1NDD-xnQ" node scrapers/testVideo.js

# Download captions
echo ""
echo "============================================================"
echo "Step 03: Downloading YouTube Captions - No Brain updates"
echo "============================================================"
python3 scrapers/downloadYoutubeSrts.py

# Load captions into CSV/JSON
echo ""
echo "============================================================"
echo "Step 04: Loading Captions into MIT Brain"
echo "============================================================"
node scrapers/loadSrts.js

# ============================================================
# News Scraping Configuration
# ============================================================

echo ""
echo "============================================================"
echo "Step S05: Scraping MIT News RSS Feeds"
echo "============================================================"
#node scrapers/scrapeNewsFromRss.js

echo ""
echo "============================================================"
echo "Step S06: Scraping External Media Coverage"
echo "============================================================"
#node scrapers/scrapeExternalNews.js

# ============================================================
# Startups Configuration
# ============================================================

export STARTUP_CSV_FILE="mit_startup_exchange.csv"  # File in DATA_DIR
# export UPDATE_MODE="true"  # Uncomment to overwrite existing startups

echo ""
echo "============================================================"
echo "Step S07: Importing Startups"
echo "============================================================"
#node scrapers/scrapeStartups.js

# ============================================================
# Papers Configuration
# ============================================================

export MAX_PAPERS=6700  # ~1 year of papers
export OPENALEX_INSTITUTION_ID="I63966007"  # MIT's OpenAlex ID

echo ""
echo "============================================================"
echo "Step S08: Scraping Academic Papers & Scholarly Articles"
echo "============================================================"
#node scrapers/scrapePapers.js

echo ""
echo "============================================================"
echo "Step S09: Scraping Events"
echo "============================================================"
#node scrapers/scrapeEvents.mjs  data/events.xlsx 

# ============================================================
# MIT Persons Configuration
# ============================================================
export MAX_PERSONS=50  # Uncomment to limit for testing

echo ""
echo "============================================================"
echo "Step S10: Scraping MIT Persons Directory"
echo "============================================================"
#node scrapers/scrapeMITPersons.js


# Optional Repair Brain
#node util/repairBrain.js

# Optional: repair titles for external news
#node util/repair_external_news_titles.js

# Optional: Create test brain with 10 records of each kind
#node util/createTestBrain.js 100

# ============================================================
# Completion
# ============================================================

echo ""
echo "============================================================"
echo "✅ Scraping Complete!"
echo "============================================================"
echo "Data files:"
echo "  📊 CSV: ${OUTPUT_DIR}/csv/${MIT_BRAIN}.csv"
echo "  📄 JSON: ${OUTPUT_DIR}/json/${MIT_BRAIN}.json"
echo "  📹 Captions: ${OUTPUT_DIR}/captions/*.srt"
echo ""
echo "Session log:"
echo "  📝 ${LOGS_DIR}/${MIT_BRAIN}_${MIT_BRAIN_RUN_ID}.log"
echo "============================================================"