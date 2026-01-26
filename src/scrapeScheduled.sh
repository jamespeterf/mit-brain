#!/bin/bash

# ============================================================
# MIT Brain Daily Scheduled Script
# ============================================================
# This script runs daily via cron to:
#   1. Scrape new content (videos, news, papers)
#   2. Pre-enrich new records
#   3. Enrich with AI-generated ILP summaries and keywords
#
# NOTE: MIT People, Events, and Startups are loaded on-demand
#       via the Admin page, NOT by this scheduled script.
#
# Configuration is loaded from ../.env file
# ============================================================

# Note: We don't use 'set -e' because individual scraper failures
# should not stop the entire pipeline. Each step handles its own errors.

# ============================================================
# Load Configuration from .env
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ -f "$ENV_FILE" ]; then
    echo "📂 Loading configuration from $ENV_FILE"
    set -a  # automatically export all variables
    source "$ENV_FILE"
    set +a
else
    echo "⚠️  Warning: .env file not found at $ENV_FILE"
    echo "   Using default values..."
fi

# ============================================================
# Global Configuration (defaults if not in .env)
# ============================================================

export MIT_BRAIN="${MIT_BRAIN:-mit_brain_test17}"

# For daily runs, only look back 2 days for new content
# This prevents re-scraping the entire history every day
LOOKBACK_DAYS="${LOOKBACK_DAYS:-2}"
export START_DATE=$(date -v-${LOOKBACK_DAYS}d +%Y-%m-%d 2>/dev/null || date -d "${LOOKBACK_DAYS} days ago" +%Y-%m-%d)
echo "📅 Looking back ${LOOKBACK_DAYS} days (START_DATE: $START_DATE)"

# Limit pages for scrapers that paginate (prevents scraping entire history)
export MAX_PAGES="${MAX_PAGES:-10}"

# Directories
export DATA_DIR="data"
export OUTPUT_DIR="output"
export LOGS_DIR="logs"

# Generate run ID for this session (for logging)
export MIT_BRAIN_RUN_ID=$(date +"%Y%m%d_%H%M%S")

# Create directories if they don't exist
mkdir -p "$DATA_DIR"
mkdir -p "$OUTPUT_DIR/csv"
mkdir -p "$OUTPUT_DIR/jsonl"
mkdir -p "$OUTPUT_DIR/captions"
mkdir -p "$LOGS_DIR"

# Log file for this run
LOG_FILE="${LOGS_DIR}/${MIT_BRAIN}_${MIT_BRAIN_RUN_ID}.log"

# Redirect all output to log file while also showing on console
exec > >(tee -a "$LOG_FILE") 2>&1

echo "============================================================"
echo "MIT Brain Daily Scheduled Run"
echo "============================================================"
echo "Started: $(date)"
echo "Brain: $MIT_BRAIN"
echo "Run ID: $MIT_BRAIN_RUN_ID"
echo "Log: $LOG_FILE"
echo "============================================================"
echo ""

# ============================================================
# Initialize Brain File
# ============================================================

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
# PHASE 1: SCRAPING
# ============================================================

echo ""
echo "########################################################"
echo "# PHASE 1: SCRAPING NEW CONTENT"
echo "########################################################"
echo ""

# ------------------------------------------------------------
# YouTube Videos - ILP and STEX Playlists
# ------------------------------------------------------------
export PLAYLIST_FILE="ilpPlaylists.csv"

echo "============================================================"
echo "Step S01: Scraping ILP and STEX YouTube Videos"
echo "============================================================"
if [ -f "$DATA_DIR/$PLAYLIST_FILE" ]; then
    node scrapers/scrapeIlpVideos.js || echo "⚠️  S01 failed, continuing..."
else
    echo "⏭️  Skipped: $DATA_DIR/$PLAYLIST_FILE not found"
fi

# ------------------------------------------------------------
# YouTube Videos - Public MIT Channels
# ------------------------------------------------------------
export CHANNEL_FILE="publicYouTubeChannels.txt"

echo ""
echo "============================================================"
echo "Step S02: Scraping Public MIT YouTube Channels"
echo "============================================================"
if [ -f "$DATA_DIR/$CHANNEL_FILE" ]; then
    node scrapers/scrapePublicYouTube.js || echo "⚠️  S02 failed, continuing..."
else
    echo "⏭️  Skipped: $DATA_DIR/$CHANNEL_FILE not found"
fi

# ------------------------------------------------------------
# YouTube Captions
# ------------------------------------------------------------
echo ""
echo "============================================================"
echo "Step S03: Downloading YouTube Captions"
echo "============================================================"
python3 scrapers/downloadYoutubeSrts.py || echo "⚠️  S03 failed, continuing..."

echo ""
echo "============================================================"
echo "Step S04: Loading Captions into MIT Brain"
echo "============================================================"
node scrapers/loadSrts.js || echo "⚠️  S04 failed, continuing..."

# ------------------------------------------------------------
# News - MIT RSS Feeds
# ------------------------------------------------------------
echo ""
echo "============================================================"
echo "Step S05: Scraping MIT News RSS Feeds"
echo "============================================================"
node scrapers/scrapeNewsFromRss.js || echo "⚠️  S05 failed, continuing..."

# ------------------------------------------------------------
# News - External Media Coverage
# ------------------------------------------------------------
echo ""
echo "============================================================"
echo "Step S06: Scraping External Media Coverage"
echo "============================================================"
node scrapers/scrapeExternalNews.js || echo "⚠️  S06 failed, continuing..."

# ------------------------------------------------------------
# Academic Papers
# ------------------------------------------------------------
export MAX_PAPERS=6700  # ~1 year of papers
export OPENALEX_INSTITUTION_ID="I63966007"  # MIT's OpenAlex ID

echo ""
echo "============================================================"
echo "Step S07: Scraping Academic Papers & Scholarly Articles"
echo "============================================================"
node scrapers/scrapePapers.js || echo "⚠️  S07 failed, continuing..."

echo ""
echo "########################################################"
echo "# PHASE 1 COMPLETE: Scraping finished"
echo "########################################################"
echo ""

# ============================================================
# PHASE 2: PRE-ENRICHMENT
# ============================================================

echo ""
echo "########################################################"
echo "# PHASE 2: PRE-ENRICHMENT"
echo "########################################################"
echo ""

echo "============================================================"
echo "Step E01: Pre-Enrich (prepare records for AI enrichment)"
echo "============================================================"
OPENAI_MODEL=gpt-4o-mini node enrichers/preEnrich.js || echo "⚠️  E01 failed, continuing..."

echo ""
echo "########################################################"
echo "# PHASE 2 COMPLETE: Pre-enrichment finished"
echo "########################################################"
echo ""

# ============================================================
# PHASE 3: AI ENRICHMENT
# ============================================================

echo ""
echo "########################################################"
echo "# PHASE 3: AI ENRICHMENT"
echo "########################################################"
echo ""

echo "============================================================"
echo "Step E02: AI-Generate ILP Summaries and Keywords"
echo "============================================================"
export PROMPT="ilpFields.txt"
node enrichers/enrichIlpFields.js || echo "⚠️  E02 failed, continuing..."

echo ""
echo "########################################################"
echo "# PHASE 3 COMPLETE: AI enrichment finished"
echo "########################################################"
echo ""

# ============================================================
# COMPLETION
# ============================================================

echo ""
echo "============================================================"
echo "✅ DAILY SCHEDULED RUN COMPLETE!"
echo "============================================================"
echo "Finished: $(date)"
echo ""
echo "Data files:"
echo "  📄 Brain: ${OUTPUT_DIR}/jsonl/${MIT_BRAIN}.jsonl"
echo "  📹 Captions: ${OUTPUT_DIR}/captions/*.srt"
echo ""
echo "Session log:"
echo "  📝 $LOG_FILE"
echo ""
echo "NOTE: MIT People, Events, and Startups are loaded"
echo "      on-demand via the Admin page."
echo "============================================================"
