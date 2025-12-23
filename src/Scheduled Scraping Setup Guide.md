# Scheduled Scraping Setup Guide

## Overview

`scrapeScheduled.sh` is designed to run automatically via cron. It automatically calculates the start date based on a lookback period.

## Automatic Date Calculation

### Default Behavior
**Goes back 2 days automatically:**
```bash
# If today is 2024-12-19
# START_DATE will be: 2024-12-17
```

### How It Works
```bash
export LOOKBACK_DAYS=${LOOKBACK_DAYS:-2}  # Default: 2 days

# Automatically calculates:
# START_DATE = today - LOOKBACK_DAYS
```

### Override Options

**1. Override lookback period:**
```bash
LOOKBACK_DAYS=5 ./scrapeScheduled.sh
# Will go back 5 days instead of 2
```

**2. Override start date directly:**
```bash
START_DATE="2024-12-01" ./scrapeScheduled.sh
# Ignores LOOKBACK_DAYS, uses exact date
```

**3. Set in environment:**
```bash
export LOOKBACK_DAYS=7
./scrapeScheduled.sh
# Always goes back 7 days
```

## Cron Setup

### Daily at 8:00 AM

```bash
# Edit crontab
crontab -e

# Add this line:
0 8 * * * cd /path/to/mit-brain-app-v04/src && ./scrapeScheduled.sh
```

### Daily at 8:00 AM with custom lookback

```bash
# Edit crontab
crontab -e

# Go back 3 days instead of 2:
0 8 * * * cd /path/to/mit-brain-app-v04/src && LOOKBACK_DAYS=3 ./scrapeScheduled.sh
```

### Multiple Times Per Day

```bash
# 8 AM and 8 PM (2-day lookback)
0 8,20 * * * cd /path/to/mit-brain-app-v04/src && ./scrapeScheduled.sh

# 8 AM with 2 days, 2 PM with 1 day (more recent)
0 8 * * * cd /path/to/mit-brain-app-v04/src && LOOKBACK_DAYS=2 ./scrapeScheduled.sh
0 14 * * * cd /path/to/mit-brain-app-v04/src && LOOKBACK_DAYS=1 ./scrapeScheduled.sh
```

### Weekly (Mondays at 8 AM, go back 7 days)

```bash
0 8 * * 1 cd /path/to/mit-brain-app-v04/src && LOOKBACK_DAYS=7 ./scrapeScheduled.sh
```

## Logging

### Automatic Logging

Every run creates a timestamped log:
```bash
logs/mit_brain_test17_20241219_080000.log
```

### Log Contents

```
[2024-12-19 08:00:00] ============================================================
[2024-12-19 08:00:00] MIT Brain Scheduled Knowledge Collection
[2024-12-19 08:00:00] ============================================================
[2024-12-19 08:00:00] Brain: mit_brain_test17
[2024-12-19 08:00:00] Run ID: 20241219_080000
[2024-12-19 08:00:00] Start Date: 2024-12-17 (2 days ago)
[2024-12-19 08:00:00] Log: logs/mit_brain_test17_20241219_080000.log
[2024-12-19 08:00:00] ============================================================
...
[2024-12-19 08:15:32] ✅ Scheduled Scraping Complete!
[2024-12-19 08:15:32] Records added: 47
```

### View Recent Logs

```bash
# Latest log
ls -t logs/*.log | head -1

# View latest log
tail -f $(ls -t logs/*.log | head -1)

# Count records added today
grep "Records added:" $(ls -t logs/*.log | head -1)
```

## Statistics Tracking

The script tracks:
- Records before run
- Records after run
- Records added this run
- Start date used
- Lookback period

Example output:
```
============================================================
📊 Session Statistics
============================================================
Records before: 9247
Records after: 9294
Records added: 47

Configuration:
  📅 Start date: 2024-12-17
  ⏮  Lookback: 2 days
============================================================
```

## Email Notifications (Optional)

Uncomment in the script to get email alerts:

```bash
# In scrapeScheduled.sh (near end):
if [ $RECORDS_ADDED -gt 0 ]; then
    echo "Added ${RECORDS_ADDED} new records to MIT Brain" | \
    mail -s "MIT Brain Update: ${RECORDS_ADDED} new records" your.email@mit.edu
fi
```

## Auto-Enrichment (Optional)

Automatically run enrichment after scraping:

```bash
# In scrapeScheduled.sh (near end):
log "🔧 Starting automatic enrichment..."
./enrich.sh 2>&1 | tee -a "$LOG_FILE"
```

## Testing

### Test manually before setting up cron:

```bash
cd src/

# Test with default (2 days)
./scrapeScheduled.sh

# Test with 1 day
LOOKBACK_DAYS=1 ./scrapeScheduled.sh

# Test with specific date
START_DATE="2024-12-01" ./scrapeScheduled.sh
```

### Check what cron will do:

```bash
# Simulate cron environment
cd /path/to/mit-brain-app-v04/src && ./scrapeScheduled.sh
```

## Monitoring

### Check if cron is running:

```bash
# View cron jobs
crontab -l

# Check cron logs (macOS)
log show --predicate 'process == "cron"' --last 1h

# Check cron logs (Linux)
grep CRON /var/log/syslog
```

### Check last run:

```bash
# Latest log file
ls -lth logs/*.log | head -1

# When it ran
ls -lth logs/*.log | head -1 | awk '{print $6, $7, $8}'

# What it did
tail logs/$(ls -t logs/*.log | head -1)
```

## Use Cases

### Case 1: Daily Updates (Conservative)
**Scenario:** Scrape content from last 2 days every morning
```bash
# Crontab:
0 8 * * * cd /path/to/src && ./scrapeScheduled.sh
# Uses default LOOKBACK_DAYS=2
```

### Case 2: Aggressive Updates
**Scenario:** Scrape content from last day twice daily
```bash
# Crontab:
0 8,20 * * * cd /path/to/src && LOOKBACK_DAYS=1 ./scrapeScheduled.sh
```

### Case 3: Weekly Comprehensive
**Scenario:** Full week scrape every Monday
```bash
# Crontab:
0 8 * * 1 cd /path/to/src && LOOKBACK_DAYS=7 ./scrapeScheduled.sh
```

### Case 4: Mixed Strategy
**Scenario:** Daily recent + weekly comprehensive
```bash
# Daily: last 2 days
0 8 * * * cd /path/to/src && LOOKBACK_DAYS=2 ./scrapeScheduled.sh

# Weekly: last 7 days (catches anything missed)
0 9 * * 1 cd /path/to/src && LOOKBACK_DAYS=7 ./scrapeScheduled.sh
```

## Cron Template

Copy and customize:

```bash
# MIT Brain Scheduled Scraping
# Runs daily at 8:00 AM, scrapes content from last 2 days

# CHANGE THIS PATH to your actual path:
PROJECT_PATH="/Users/jimflynn/Documents/Vibe Coding/mit-brain-app-v04"

# Default (2 days lookback):
0 8 * * * cd ${PROJECT_PATH}/src && ./scrapeScheduled.sh >> ${PROJECT_PATH}/logs/cron.log 2>&1

# Or with custom lookback:
# 0 8 * * * cd ${PROJECT_PATH}/src && LOOKBACK_DAYS=3 ./scrapeScheduled.sh >> ${PROJECT_PATH}/logs/cron.log 2>&1
```

## Environment Variables in Cron

Cron doesn't inherit your shell environment. Make sure your `.env` file is at project root:

```bash
# Project structure for cron:
mit-brain-app-v04/
├── .env                    ← API keys here
└── src/
    └── scrapeScheduled.sh  ← Reads ../../.env
```

The script will automatically find `.env` at project root.

## Troubleshooting

### Cron runs but nothing happens
**Check:**
```bash
# 1. Script has execute permission
ls -l scrapeScheduled.sh
# Should show: -rwxr-xr-x

# 2. Path in crontab is absolute
crontab -l
# Should use full path: /Users/jimflynn/.../src

# 3. .env file exists
ls -l ../.env
```

### "Command not found" errors
**Add PATH to crontab:**
```bash
PATH=/usr/local/bin:/usr/bin:/bin
0 8 * * * cd /path/to/src && ./scrapeScheduled.sh
```

### Logs not created
**Check logs directory:**
```bash
mkdir -p ../logs
chmod 755 ../logs
```

## Summary

✅ **Automatic date calculation** - Goes back 2 days by default  
✅ **Easy override** - `LOOKBACK_DAYS=5 ./scrapeScheduled.sh`  
✅ **Comprehensive logging** - Timestamped logs with statistics  
✅ **Cron-ready** - Designed for automated execution  
✅ **Flexible** - Daily, weekly, or custom schedules  

**Recommended setup for daily use:**
```bash
# Add to crontab -e:
0 8 * * * cd /Users/jimflynn/Documents/Vibe\ Coding/mit-brain-app-v04/src && ./scrapeScheduled.sh
```

Perfect for "set it and forget it" daily updates! 🎯