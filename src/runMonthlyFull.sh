#!/bin/bash

# ============================================================
# MIT Brain - Monthly Full Scrape (1st of each month)
# ============================================================
# This script does a COMPLETE scrape ignoring date filters
# to catch any videos added to old playlists
#
# Run from: src/ directory
# Schedule: Monthly on 1st at 2:00 AM via cron
# ============================================================

# ============================================================
# Global Configuration
# ============================================================

# Brain filename (without extension)
export MIT_BRAIN="mit_brain_test17"

# Directories (relative to project root)
export INPUT_DIR="../input"
export BRAIN_DIR="../brain"
export LOGS_DIR="../logs"

# Email notification settings
NOTIFICATION_EMAIL=${NOTIFICATION_EMAIL:-""}

# Archive settings
ARCHIVE_KEEP_COUNT=${ARCHIVE_KEEP_COUNT:-30}

# Webapp reload URL (if webapp is running)
WEBAPP_URL=${WEBAPP_URL:-"http://localhost:3000"}

# Generate run ID for this session
export MIT_BRAIN_RUN_ID=$(date +"%Y%m%d_%H%M%S")

# Create directories
mkdir -p "$BRAIN_DIR"
mkdir -p "$LOGS_DIR"

# Create log file
LOG_FILE="${LOGS_DIR}/monthly_full_${MIT_BRAIN}_${MIT_BRAIN_RUN_ID}.log"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "============================================================"
log "MIT Brain - Monthly Full Scrape (Comprehensive)"
log "============================================================"
log "Brain: $MIT_BRAIN"
log "Run ID: $MIT_BRAIN_RUN_ID"
log "Mode: FULL SCRAPE (checks all playlists, respects START_DATE)"
log "Log: ${LOG_FILE}"
log "============================================================"
log ""

# Track initial record count
BRAIN_FILE="${BRAIN_DIR}/${MIT_BRAIN}.jsonl"
if [ -f "$BRAIN_FILE" ]; then
    INITIAL_COUNT=$(wc -l < "$BRAIN_FILE")
    log "Initial record count: ${INITIAL_COUNT}"
else
    INITIAL_COUNT=0
    log "Creating new brain file"
    touch "$BRAIN_FILE"
fi
log ""

# ============================================================
# STEP 1: Archive Current Brain
# ============================================================

log "============================================================"
log "Step 0: Archive Current Brain"
log "============================================================"
./archiveBrain.sh "$ARCHIVE_KEEP_COUNT" 2>&1 | tee -a "$LOG_FILE"
log ""

# ============================================================
# STEP 2: FULL SCRAPE (All scrapers, no date filters)
# ============================================================

log "============================================================"
log "Step F01: MIT News RSS Feeds (FULL)"
log "============================================================"
# Note: START_DATE still respected to avoid ancient content
# FULL_SCRAPE just disables early exit optimization
node scrapers/scrapeNewsFromRss.js 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step F02: External Media Coverage (FULL)"
log "============================================================"
node scrapers/scrapeExternalNews.js 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step F03: Academic Papers (Extended)"
log "============================================================"
export MAX_PAPERS=500  # More papers for monthly run
export OPENALEX_INSTITUTION_ID="I63966007"  # MIT
node scrapers/scrapePapers.js 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step F04: ILP YouTube Videos (FULL, with auto token refresh)"
log "============================================================"
export PLAYLIST_FILE="ilpPlaylists.csv"
export FULL_SCRAPE=true  # Ignore date filters
./scrapeIlpVideosAuto.sh 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step F05: Public MIT YouTube Channels (FULL)"
log "============================================================"
export CHANNEL_FILE="publicYouTubeChannels.txt"
export FULL_SCRAPE=true  # Ignore date filters
node scrapers/scrapePublicYouTube.js 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step F06: Download YouTube Captions"
log "============================================================"
python3 scrapers/downloadYoutubeSrts.py 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step F07: Load Captions into Brain"
log "============================================================"
node scrapers/loadSrts.js 2>&1 | tee -a "$LOG_FILE"
log ""

# ============================================================
# STEP 3: Calculate Statistics
# ============================================================

AFTER_SCRAPING_COUNT=$(wc -l < "$BRAIN_FILE")
RECORDS_ADDED=$((AFTER_SCRAPING_COUNT - INITIAL_COUNT))

log "============================================================"
log "📊 Full Scraping Session Statistics"
log "============================================================"
log "Records before: ${INITIAL_COUNT}"
log "Records after scraping: ${AFTER_SCRAPING_COUNT}"
log "Records added: ${RECORDS_ADDED}"
log ""

# ============================================================
# STEP 4: ENRICHMENT
# ============================================================

log "============================================================"
log "Starting Enrichment..."
log "============================================================"
log ""

log "============================================================"
log "Step E01: Enrich ILP Fields for All Record Types"
log "============================================================"
export PROMPT="ilpFields.txt"
node enrichers/enrichIlpFields.js 2>&1 | tee -a "$LOG_FILE"
log ""

# ============================================================
# STEP 5: Final Statistics
# ============================================================

FINAL_COUNT=$(wc -l < "$BRAIN_FILE")

log "============================================================"
log "📊 Final Statistics"
log "============================================================"
log "Initial count: ${INITIAL_COUNT}"
log "After scraping: ${AFTER_SCRAPING_COUNT}"
log "After enrichment: ${FINAL_COUNT}"
log "Records added: ${RECORDS_ADDED}"
log ""

# ============================================================
# STEP 6: Reload Webapp
# ============================================================

log "============================================================"
log "Step 6: Reload Webapp"
log "============================================================"

if curl -s "${WEBAPP_URL}/api/status" > /dev/null 2>&1; then
    log "Webapp detected at ${WEBAPP_URL}"
    log "Triggering hot reload..."
    
    RELOAD_RESPONSE=$(curl -s -X POST "${WEBAPP_URL}/api/reload")
    
    if echo "$RELOAD_RESPONSE" | grep -q '"success":true'; then
        log "✅ Webapp reloaded successfully"
        NEW_COUNT=$(echo "$RELOAD_RESPONSE" | grep -o '"newCount":[0-9]*' | cut -d: -f2)
        ADDED_COUNT=$(echo "$RELOAD_RESPONSE" | grep -o '"addedCount":[0-9]*' | cut -d: -f2)
        log "   New count: ${NEW_COUNT}"
        log "   Added: ${ADDED_COUNT}"
    else
        log "⚠️  Webapp reload returned unexpected response"
    fi
else
    log "ℹ️  Webapp not detected at ${WEBAPP_URL}"
fi
log ""

# ============================================================
# STEP 7: Send Email Notification
# ============================================================

if [ -n "$NOTIFICATION_EMAIL" ]; then
    log "============================================================"
    log "Step 7: Send Email Notification"
    log "============================================================"
    
    EMAIL_SUBJECT="MIT Brain Monthly Full Scrape: ${RECORDS_ADDED} new records"
    EMAIL_BODY="MIT Brain Monthly Full Scrape Complete

This is the comprehensive monthly scrape (runs 1st of each month).
All content checked regardless of date.

Scraping Results:
- Records added: ${RECORDS_ADDED}
- Total records: ${FINAL_COUNT}
- Mode: FULL SCRAPE (no date filters)

Statistics:
- Initial count: ${INITIAL_COUNT}
- After scraping: ${AFTER_SCRAPING_COUNT}
- After enrichment: ${FINAL_COUNT}

Webapp Status:
- Reloaded: $(curl -s "${WEBAPP_URL}/api/status" > /dev/null 2>&1 && echo "Yes" || echo "Not running")

Log file: ${LOG_FILE}

---
MIT Brain Monthly Full Scrape
$(date)
"
    
    if command -v mail >/dev/null 2>&1; then
        echo "$EMAIL_BODY" | mail -s "$EMAIL_SUBJECT" "$NOTIFICATION_EMAIL"
        log "✅ Email notification sent to: $NOTIFICATION_EMAIL"
    else
        log "⚠️  Mail command not available, skipping email notification"
    fi
    log ""
fi

# ============================================================
# STEP 8: Final Summary
# ============================================================

log "============================================================"
log "✅ Monthly Full Scrape Complete!"
log "============================================================"
log "Brain file: ${BRAIN_FILE}"
log ""
log "Scraping:"
log "  Records before: ${INITIAL_COUNT}"
log "  Records added: ${RECORDS_ADDED}"
log "  Records after scraping: ${AFTER_SCRAPING_COUNT}"
log ""
log "Enrichment:"
log "  Final record count: ${FINAL_COUNT}"
log ""
log "Mode:"
log "  FULL SCRAPE (comprehensive monthly check)"
log "  Archives kept: ${ARCHIVE_KEEP_COUNT}"
log ""
log "Webapp:"
log "  URL: ${WEBAPP_URL}"
log "  Reloaded: $(curl -s "${WEBAPP_URL}/api/status" > /dev/null 2>&1 && echo "Yes" || echo "Not detected")"
log ""
log "Session log: ${LOG_FILE}"
log "============================================================"

exit 0