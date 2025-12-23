#!/bin/bash
# MIT Brain - Start Server
# Simple startup script for webapp

# Set the JSONL data file (in brain/ root)
export MIT_BRAIN_JSONL="mit_brain_test17.jsonl"

# Optional: Override with command line argument
if [ ! -z "$1" ]; then
  export MIT_BRAIN_JSONL="$1"
fi

# Navigate to this script's directory
cd "$(dirname "$0")"

# Start the server
echo "🧠 Starting MIT Brain Server"
echo "Data file: $MIT_BRAIN_JSONL"
echo ""
node server.js