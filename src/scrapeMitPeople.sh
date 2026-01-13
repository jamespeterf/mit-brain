#!/bin/bash
# ============================================================
# MIT Brain - MIT People Scraper
# ============================================================
# Scrapes MIT people profiles from mitPeople.xlsx into MIT Brain
#
# Usage:
#   ./scrapeMitPeople.sh              # Fast mode (no AI)
#   ./scrapeMitPeople.sh --with-ai    # AI-enhanced mode
#   ./scrapeMitPeople.sh --test       # Test with 10 records
# ============================================================

# ============================================================
# Global Configuration
# ============================================================

# Brain filename (without extension)
export MIT_BRAIN="mit_brain_test17"

# Directories
export DATA_DIR="data"
export OUTPUT_DIR="output"
export BRAIN_DIR="output"  # MITBrainSchema uses BRAIN_DIR env var
export INPUT_DIR="data"     # MITBrainSchema uses INPUT_DIR env var
export LOGS_DIR="logs"

# Generate run ID for this session (for logging)
export MIT_BRAIN_RUN_ID=$(date +"%Y%m%d_%H%M%S")

# Create directories if they don't exist
mkdir -p "$OUTPUT_DIR"
mkdir -p "$LOGS_DIR"

# Parse command line arguments
WITH_AI=false
TEST_MODE=false

for arg in "$@"; do
  case $arg in
    --with-ai)
      WITH_AI=true
      ;;
    --test)
      TEST_MODE=true
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: ./scrapeMitPeople.sh [--with-ai] [--test]"
      exit 1
      ;;
  esac
done

echo "============================================================"
echo "MIT Brain - MIT People Scraper"
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
BRAIN_FILE="${OUTPUT_DIR}/${MIT_BRAIN}.jsonl"

if [ ! -f "$BRAIN_FILE" ]; then
    echo "📝 Initializing new brain file: $BRAIN_FILE"
    mkdir -p "${OUTPUT_DIR}"
    touch "$BRAIN_FILE"
    echo "✅ Created empty brain file"
else
    echo "📝 Using existing brain file: $BRAIN_FILE"
fi
echo ""

# ============================================================
# Step 01: Scraping MIT People
# ============================================================

echo "============================================================"
echo "Step 01: Scraping MIT People"
echo "============================================================"

# Build the command
CMD="node scrapers/scrapeMitPeople.js"

if [ "$TEST_MODE" = true ]; then
    echo "🧪 Test mode: Processing 10 records only"
    CMD="$CMD --limit 50"
fi

if [ "$WITH_AI" = false ]; then
    echo "⚡ Fast mode: Skipping AI (uses existing URLs)"
    CMD="$CMD --skip-ai"
else
    echo "🤖 AI mode: URL lookup + bio generation enabled"
    if [ -z "$OPENAI_API_KEY" ]; then
        echo "⚠️  Warning: OPENAI_API_KEY not set, falling back to fast mode"
        CMD="$CMD --skip-ai"
    fi
fi

echo "Running: $CMD"
echo ""

# Execute the scraper
eval $CMD

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ MIT People scraping completed successfully"
else
    echo ""
    echo "❌ MIT People scraping failed"
    exit 1
fi

# ============================================================
# Completion
# ============================================================

echo ""
echo "============================================================"
echo "✅ Scraping Complete!"
echo "============================================================"
echo "Data files:"
echo "  📄 JSONL: ${OUTPUT_DIR}/${MIT_BRAIN}.jsonl"
echo "  📊 CSV: ${OUTPUT_DIR}/${MIT_BRAIN}.csv"
echo ""
echo "Session log:"
echo "  📝 ${LOGS_DIR}/${MIT_BRAIN}_${MIT_BRAIN_RUN_ID}.log"
echo "============================================================"
echo ""
echo "Next steps:"
echo "  1. Review the data: cat ${OUTPUT_DIR}/${MIT_BRAIN}.jsonl | tail -5 | jq ."
echo "  2. Restart server to load new people"
echo "  3. Search for people in web interface"
echo "============================================================"
