#!/bin/bash

# ============================================================
# MIT Brain - Scheduled Scrapers (Daily Automated)
# ============================================================
# This script runs automatically via cron
# Scrapes content that updates regularly
#
# Run from: src/ directory
# Schedule: Daily at 8:00 AM via cron
# ============================================================

# ============================================================
# Global Configuration
# ============================================================

# Lookback period (days) - how far back to scrape
export LOOKBACK_DAYS=${LOOKBACK_DAYS:-2}  # Default: 2 days

# Calculate start date automatically
if [ -z "$START_DATE" ]; then
    if date -v -1d > /dev/null 2>&1; then
        # macOS (BSD date)
        export START_DATE=$(date -v -${LOOKBACK_DAYS}d +"%Y-%m-%d")
    else
        # Linux (GNU date)
        export START_DATE=$(date -d "${LOOKBACK_DAYS} days ago" +"%Y-%m-%d")
    fi
fi

# Brain filename (without extension)
export MIT_BRAIN="mit_brain_test17"

# Directories (relative to project root)
export INPUT_DIR="../input"
export BRAIN_DIR="../brain"
export LOGS_DIR="../logs"

# Email notification settings
NOTIFICATION_EMAIL=${NOTIFICATION_EMAIL:-""}  # Set via environment or cron

# Archive settings
ARCHIVE_KEEP_COUNT=${ARCHIVE_KEEP_COUNT:-30}  # Keep last 30 archives

# Webapp reload URL (if webapp is running)
WEBAPP_URL=${WEBAPP_URL:-"http://localhost:3000"}

# Generate run ID for this session
export MIT_BRAIN_RUN_ID=$(date +"%Y%m%d_%H%M%S")

# Create directories
mkdir -p "$BRAIN_DIR"
mkdir -p "$LOGS_DIR"

# Create log file
LOG_FILE="${LOGS_DIR}/scheduled_${MIT_BRAIN}_${MIT_BRAIN_RUN_ID}.log"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "============================================================"
log "MIT Brain - Scheduled Scrapers (Automated Daily Run)"
log "============================================================"
log "Brain: $MIT_BRAIN"
log "Run ID: $MIT_BRAIN_RUN_ID"
log "Start Date: $START_DATE (${LOOKBACK_DAYS} days ago)"
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
# STEP 1: Archive Current Brain (Before Scraping)
# ============================================================

log "============================================================"
log "Step 0: Archive Current Brain"
log "============================================================"
./archiveBrain.sh "$ARCHIVE_KEEP_COUNT" 2>&1 | tee -a "$LOG_FILE"
log ""

# ============================================================
# STEP 2: SCHEDULED SCRAPERS (Run Daily)
# ============================================================

log "============================================================"
log "Step S01: MIT News RSS Feeds"
log "============================================================"
node scrapers/scrapeNewsFromRss.js 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step S02: External Media Coverage"
log "============================================================"
node scrapers/scrapeExternalNews.js 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step S03: Academic Papers (Recent)"
log "============================================================"
export MAX_PAPERS=100  # Limit for daily runs (avoid quota issues)
export OPENALEX_INSTITUTION_ID="I63966007"  # MIT
node scrapers/scrapePapers.js 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step S04: ILP YouTube Videos (with auto token refresh)"
log "============================================================"
export PLAYLIST_FILE="ilpPlaylists.csv"
./scrapeIlpVideosAuto.sh 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step S05: Public MIT YouTube Channels"
log "============================================================"
export CHANNEL_FILE="publicYouTubeChannels.txt"
node scrapers/scrapePublicYouTube.js 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step S06: Download YouTube Captions"
log "============================================================"
python3 scrapers/downloadYoutubeSrts.py 2>&1 | tee -a "$LOG_FILE"
log ""

log "============================================================"
log "Step S07: Load Captions into Brain"
log "============================================================"
node scrapers/loadSrts.js 2>&1 | tee -a "$LOG_FILE"
log ""

# ============================================================
# STEP 3: Calculate Scraping Statistics
# ============================================================

AFTER_SCRAPING_COUNT=$(wc -l < "$BRAIN_FILE")
RECORDS_ADDED=$((AFTER_SCRAPING_COUNT - INITIAL_COUNT))

log "============================================================"
log "📊 Scraping Session Statistics"
log "============================================================"
log "Records before: ${INITIAL_COUNT}"
log "Records after scraping: ${AFTER_SCRAPING_COUNT}"
log "Records added: ${RECORDS_ADDED}"
log ""

# ============================================================
# STEP 4: ENRICHMENT (Run after scheduled scrapers)
# ============================================================

log "============================================================"
log "Starting Automated Enrichment..."
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
# STEP 6: Reload Webapp (Hot Reload)
# ============================================================

log "============================================================"
log "Step 6: Reload Webapp"
log "============================================================"

# Check if webapp is running
if curl -s "${WEBAPP_URL}/api/status" > /dev/null 2>&1; then
    log "Webapp detected at ${WEBAPP_URL}"
    log "Triggering hot reload..."
    
    RELOAD_RESPONSE=$(curl -s -X POST "${WEBAPP_URL}/api/reload")
    
    if echo "$RELOAD_RESPONSE" | grep -q '"success":true'; then
        log "✅ Webapp reloaded successfully"
        # Extract counts from JSON response
        NEW_COUNT=$(echo "$RELOAD_RESPONSE" | grep -o '"newCount":[0-9]*' | cut -d: -f2)
        ADDED_COUNT=$(echo "$RELOAD_RESPONSE" | grep -o '"addedCount":[0-9]*' | cut -d: -f2)
        log "   New count: ${NEW_COUNT}"
        log "   Added: ${ADDED_COUNT}"
    else
        log "⚠️  Webapp reload returned unexpected response"
        log "   Response: ${RELOAD_RESPONSE}"
    fi
else
    log "ℹ️  Webapp not detected at ${WEBAPP_URL} (this is OK if webapp is not running)"
fi
log ""

# ============================================================
# STEP 7: Send Email Notification
# ============================================================

if [ -n "$NOTIFICATION_EMAIL" ] && [ "$RECORDS_ADDED" -gt 0 ]; then
    log "============================================================"
    log "Step 7: Send Email Notification"
    log "============================================================"
    
    EMAIL_SUBJECT="MIT Brain Update: ${RECORDS_ADDED} new records"
    EMAIL_BODY="MIT Brain Daily Update Complete

Scraping Results:
- Records added: ${RECORDS_ADDED}
- Total records: ${FINAL_COUNT}
- Start date filter: ${START_DATE}

Statistics:
- Initial count: ${INITIAL_COUNT}
- After scraping: ${AFTER_SCRAPING_COUNT}
- After enrichment: ${FINAL_COUNT}

Webapp Status:
- Reloaded: $(curl -s "${WEBAPP_URL}/api/status" > /dev/null 2>&1 && echo "Yes" || echo "Not running")

Log file: ${LOG_FILE}

---
MIT Brain Automated Daily Run
$(date)
"
    
    # Send email (requires mail/sendmail to be configured)
    if command -v mail >/dev/null 2>&1; then
        echo "$EMAIL_BODY" | mail -s "$EMAIL_SUBJECT" "$NOTIFICATION_EMAIL"
        log "✅ Email notification sent to: $NOTIFICATION_EMAIL"
    else
        log "⚠️  Mail command not available, skipping email notification"
        log "   Install mailutils: apt-get install mailutils (Linux) or configure mail (macOS)"
    fi
    log ""
fi

# ============================================================
# STEP 8: Final Summary
# ============================================================

log "============================================================"
log "✅ Scheduled Scraping & Enrichment Complete!"
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
log "Configuration:"
log "  Start date: ${START_DATE}"
log "  Lookback: ${LOOKBACK_DAYS} days"
log "  Archives kept: ${ARCHIVE_KEEP_COUNT}"
log ""
log "Webapp:"
log "  URL: ${WEBAPP_URL}"
log "  Reloaded: $(curl -s "${WEBAPP_URL}/api/status" > /dev/null 2>&1 && echo "Yes" || echo "Not detected")"
log ""
log "Session log: ${LOG_FILE}"
log "============================================================"

exit 0