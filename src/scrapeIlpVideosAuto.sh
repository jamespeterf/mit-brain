#!/bin/bash

# Wrapper script for scrapeIlpVideos.js that auto-refreshes OAuth token

echo "============================================================"
echo "ILP YouTube Scraper (with auto token refresh)"
echo "============================================================"
echo ""

# Auto-refresh token before scraping
echo "🔄 Checking YouTube OAuth token..."
node scrapers/autoRefreshYoutubeToken.js

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Token refresh failed!"
    echo "   You may need to re-authenticate manually:"
    echo "   node scrapers/getYoutubeRefreshToken.js"
    exit 1
fi

echo ""
echo "✅ Token ready, starting scraper..."
echo ""

# Run the actual scraper
node scrapers/scrapeIlpVideos.js

exit $?