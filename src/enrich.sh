#!/bin/bash

# ============================================================
# MIT Brain Data Enrichment Script
# ============================================================
# This script orchestrates all data enrichment programs.
# Comment out sections you don't want to run.
# ============================================================

# ============================================================
# Global Configuration
# ============================================================
export START_DATE="2024-09-01"  # Filter out news older than this date

# Brain filename (without extension)
export MIT_BRAIN="mit_brain_test17"
#export MIT_BRAIN="TestBrain"

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
