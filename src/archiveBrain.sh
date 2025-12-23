#!/bin/bash

# ============================================================
# MIT Brain - Archive Utility
# ============================================================
# Archives brain JSONL and CSV files with timestamp
# Keeps last X versions, deletes older ones
#
# Usage:
#   ./archiveBrain.sh [keep_count]
#
# Arguments:
#   keep_count: Number of archives to keep (default: 30)
#
# Example:
#   ./archiveBrain.sh      # Keep last 30
#   ./archiveBrain.sh 90   # Keep last 90
# ============================================================

# Configuration
BRAIN_NAME=${MIT_BRAIN:-"mit_brain_test17"}
BRAIN_DIR=${BRAIN_DIR:-"../brain"}
ARCHIVE_DIR="${BRAIN_DIR}/archives"
KEEP_COUNT=${1:-30}  # Default: keep 30 archives

# Create archive directory
mkdir -p "$ARCHIVE_DIR"

# Generate timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Source files
JSONL_FILE="${BRAIN_DIR}/${BRAIN_NAME}.jsonl"
CSV_FILE="${BRAIN_DIR}/${BRAIN_NAME}.csv"

echo "============================================================"
echo "MIT Brain Archive Utility"
echo "============================================================"
echo "Brain: $BRAIN_NAME"
echo "Archive directory: $ARCHIVE_DIR"
echo "Keep count: $KEEP_COUNT"
echo "Timestamp: $TIMESTAMP"
echo "============================================================"
echo ""

# Check if brain files exist
if [ ! -f "$JSONL_FILE" ]; then
    echo "❌ Error: Brain JSONL file not found: $JSONL_FILE"
    exit 1
fi

# Archive JSONL (always exists)
echo "📦 Archiving JSONL..."
JSONL_ARCHIVE="${ARCHIVE_DIR}/${BRAIN_NAME}_${TIMESTAMP}.jsonl"
cp "$JSONL_FILE" "$JSONL_ARCHIVE"

if [ -f "$JSONL_ARCHIVE" ]; then
    JSONL_SIZE=$(du -h "$JSONL_ARCHIVE" | cut -f1)
    JSONL_LINES=$(wc -l < "$JSONL_ARCHIVE")
    echo "   ✅ Archived: ${JSONL_ARCHIVE}"
    echo "      Size: ${JSONL_SIZE}"
    echo "      Records: ${JSONL_LINES}"
else
    echo "   ❌ Failed to archive JSONL"
    exit 1
fi

# Archive CSV (if exists)
if [ -f "$CSV_FILE" ]; then
    echo ""
    echo "📦 Archiving CSV..."
    CSV_ARCHIVE="${ARCHIVE_DIR}/${BRAIN_NAME}_${TIMESTAMP}.csv"
    cp "$CSV_FILE" "$CSV_ARCHIVE"
    
    if [ -f "$CSV_ARCHIVE" ]; then
        CSV_SIZE=$(du -h "$CSV_ARCHIVE" | cut -f1)
        echo "   ✅ Archived: ${CSV_ARCHIVE}"
        echo "      Size: ${CSV_SIZE}"
    else
        echo "   ⚠️  Failed to archive CSV"
    fi
else
    echo ""
    echo "⚠️  CSV file not found, skipping: $CSV_FILE"
fi

# Clean up old archives
echo ""
echo "🗑️  Cleaning old archives (keeping ${KEEP_COUNT} most recent)..."

# Count current archives
JSONL_ARCHIVE_COUNT=$(ls -1 "${ARCHIVE_DIR}"/${BRAIN_NAME}_*.jsonl 2>/dev/null | wc -l | tr -d ' ')
CSV_ARCHIVE_COUNT=$(ls -1 "${ARCHIVE_DIR}"/${BRAIN_NAME}_*.csv 2>/dev/null | wc -l | tr -d ' ')

echo "   Current JSONL archives: ${JSONL_ARCHIVE_COUNT}"
echo "   Current CSV archives: ${CSV_ARCHIVE_COUNT}"

# Delete old JSONL archives
if [ "$JSONL_ARCHIVE_COUNT" -gt "$KEEP_COUNT" ]; then
    DELETE_COUNT=$((JSONL_ARCHIVE_COUNT - KEEP_COUNT))
    echo "   Deleting ${DELETE_COUNT} old JSONL archives..."
    
    ls -t "${ARCHIVE_DIR}"/${BRAIN_NAME}_*.jsonl | tail -n +$((KEEP_COUNT + 1)) | while read file; do
        echo "      - $(basename "$file")"
        rm "$file"
    done
fi

# Delete old CSV archives
if [ "$CSV_ARCHIVE_COUNT" -gt "$KEEP_COUNT" ]; then
    DELETE_COUNT=$((CSV_ARCHIVE_COUNT - KEEP_COUNT))
    echo "   Deleting ${DELETE_COUNT} old CSV archives..."
    
    ls -t "${ARCHIVE_DIR}"/${BRAIN_NAME}_*.csv | tail -n +$((KEEP_COUNT + 1)) | while read file; do
        echo "      - $(basename "$file")"
        rm "$file"
    done
fi

# Final counts
FINAL_JSONL_COUNT=$(ls -1 "${ARCHIVE_DIR}"/${BRAIN_NAME}_*.jsonl 2>/dev/null | wc -l | tr -d ' ')
FINAL_CSV_COUNT=$(ls -1 "${ARCHIVE_DIR}"/${BRAIN_NAME}_*.csv 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo "============================================================"
echo "✅ Archive Complete"
echo "============================================================"
echo "JSONL archives: ${FINAL_JSONL_COUNT}"
echo "CSV archives: ${FINAL_CSV_COUNT}"
echo "Archive directory: ${ARCHIVE_DIR}"
echo "============================================================"

# List recent archives
echo ""
echo "Recent archives:"
ls -lth "${ARCHIVE_DIR}"/${BRAIN_NAME}_*.jsonl | head -5

exit 0