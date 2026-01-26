#!/bin/bash

# ============================================================
# MIT Brain Data Enrichment Script
# ============================================================
# This script orchestrates all data enrichment programs.
# Comment out sections you don't want to run.
#
# Configuration is loaded from ../.env file
# ============================================================

set -e  # Exit on error

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

export START_DATE="${START_DATE:-2024-09-01}"
export MIT_BRAIN="${MIT_BRAIN:-mit_brain_test17}"

# Directories
export DATA_DIR="data"
export OUTPUT_DIR="output"
export LOGS_DIR="logs"

# Generate run ID for this session (for logging)
export MIT_BRAIN_RUN_ID=$(date +"%Y%m%d_%H%M%S")

# Create directories if they don't exis
mkdir -p "$LOGS_DIR"

echo "============================================================"
echo "MIT Brain Knowledge Enrichment"
echo "============================================================"
echo "Brain: $MIT_BRAIN"
echo "Run ID: $MIT_BRAIN_RUN_ID"
echo "Log: ${LOGS_DIR}/${MIT_BRAIN}_${MIT_BRAIN_RUN_ID}.log"
echo "============================================================"
echo ""

echo ""
echo "============================================================"
echo "Step E01: Pre-Enrich"
echo "============================================================"
#MAX_EVENTS=100 OPENAI_MODEL=gpt-4o-mini node enrichers/preEnrich.js

echo ""
echo "============================================================"
echo "Step E02: Use AI to Compose ILP Summaries and Keywords"
echo "============================================================"
export PROMPT="ilpFields.txt"
node enrichers/enrichIlpFields.js

# ============================================================
# Completion
# ============================================================

echo ""
echo "============================================================"
echo "✅ Enrichment Complete!"
echo "============================================================"
echo "Data files:"
echo "  📊 CSV: ${OUTPUT_DIR}/${MIT_BRAIN}.csv"
echo "  📄 JSON: ${OUTPUT_DIR}/${MIT_BRAIN}.json"
echo ""
echo "Session log:"
echo "  📝 ${LOGS_DIR}/${MIT_BRAIN}_${MIT_BRAIN_RUN_ID}.log"
echo "============================================================"
