#!/bin/bash

# Extract All YouTube Credentials
# Handles both token.json and credentials.json
# Usage: ./extract-all-youtube-credentials.sh

echo "============================================================"
echo "YouTube Credentials Extractor"
echo "============================================================"
echo ""

# Files to check
TOKEN_FILE="token.json"
CREDENTIALS_FILE="credentials.json"
ENV_FILE=".env"

# Results
FOUND_CREDENTIALS=false
FOUND_TOKEN=false

# ============================================================
# Extract from credentials.json (OAuth Client ID/Secret)
# ============================================================

if [ -f "$CREDENTIALS_FILE" ]; then
    echo "📄 Found: $CREDENTIALS_FILE"
    FOUND_CREDENTIALS=true
    
    if command -v jq >/dev/null 2>&1; then
        # Try different JSON structures
        CLIENT_ID=$(jq -r '.installed.client_id // .web.client_id // .client_id // empty' "$CREDENTIALS_FILE" 2>/dev/null)
        CLIENT_SECRET=$(jq -r '.installed.client_secret // .web.client_secret // .client_secret // empty' "$CREDENTIALS_FILE" 2>/dev/null)
    else
        # Fallback to grep
        CLIENT_ID=$(grep -o '"client_id":"[^"]*"' "$CREDENTIALS_FILE" | head -1 | cut -d'"' -f4)
        CLIENT_SECRET=$(grep -o '"client_secret":"[^"]*"' "$CREDENTIALS_FILE" | head -1 | cut -d'"' -f4)
    fi
    
    if [ -n "$CLIENT_ID" ]; then
        echo "   ✅ Found Client ID"
    fi
    if [ -n "$CLIENT_SECRET" ]; then
        echo "   ✅ Found Client Secret"
    fi
    echo ""
else
    echo "⚠️  credentials.json not found"
    echo ""
fi

# ============================================================
# Extract from token.json (Refresh Token)
# ============================================================

if [ -f "$TOKEN_FILE" ]; then
    echo "📄 Found: $TOKEN_FILE"
    FOUND_TOKEN=true
    
    if command -v jq >/dev/null 2>&1; then
        REFRESH_TOKEN=$(jq -r '.refresh_token // .refreshToken // empty' "$TOKEN_FILE" 2>/dev/null)
        # Also get client credentials from token.json if not found in credentials.json
        if [ -z "$CLIENT_ID" ]; then
            CLIENT_ID=$(jq -r '.client_id // .clientId // empty' "$TOKEN_FILE" 2>/dev/null)
        fi
        if [ -z "$CLIENT_SECRET" ]; then
            CLIENT_SECRET=$(jq -r '.client_secret // .clientSecret // empty' "$TOKEN_FILE" 2>/dev/null)
        fi
    else
        # Fallback to grep
        REFRESH_TOKEN=$(grep -o '"refresh_token":"[^"]*"' "$TOKEN_FILE" | cut -d'"' -f4)
        if [ -z "$REFRESH_TOKEN" ]; then
            REFRESH_TOKEN=$(grep -o '"refreshToken":"[^"]*"' "$TOKEN_FILE" | cut -d'"' -f4)
        fi
    fi
    
    if [ -n "$REFRESH_TOKEN" ]; then
        echo "   ✅ Found Refresh Token"
    else
        echo "   ⚠️  No refresh token in file"
    fi
    echo ""
else
    echo "⚠️  token.json not found"
    echo ""
fi

# ============================================================
# Summary
# ============================================================

echo "============================================================"
echo "Extracted Credentials Summary"
echo "============================================================"
echo ""

if [ -n "$CLIENT_ID" ]; then
    echo "✅ CLIENT ID:"
    echo "   $CLIENT_ID"
    echo ""
else
    echo "❌ Client ID not found"
    echo ""
fi

if [ -n "$CLIENT_SECRET" ]; then
    echo "✅ CLIENT SECRET:"
    echo "   $CLIENT_SECRET"
    echo ""
else
    echo "❌ Client Secret not found"
    echo ""
fi

if [ -n "$REFRESH_TOKEN" ]; then
    echo "✅ REFRESH TOKEN:"
    echo "   $REFRESH_TOKEN"
    echo ""
else
    echo "❌ Refresh Token not found"
    echo ""
fi

# ============================================================
# Generate .env entries
# ============================================================

echo "============================================================"
echo "Add these to your .env file:"
echo "============================================================"
echo ""

if [ -n "$CLIENT_ID" ] || [ -n "$CLIENT_SECRET" ] || [ -n "$REFRESH_TOKEN" ]; then
    echo "# YouTube OAuth (for private/unlisted ILP videos)"
    
    if [ -n "$CLIENT_ID" ]; then
        echo "YOUTUBE_CLIENT_ID=$CLIENT_ID"
    fi
    
    if [ -n "$CLIENT_SECRET" ]; then
        echo "YOUTUBE_CLIENT_SECRET=$CLIENT_SECRET"
    fi
    
    if [ -n "$REFRESH_TOKEN" ]; then
        echo "YOUTUBE_REFRESH_TOKEN=$REFRESH_TOKEN"
    fi
    
    echo ""
else
    echo "❌ No credentials found to add"
    echo ""
fi

# ============================================================
# Check for API Key in .env
# ============================================================

if [ -f "$ENV_FILE" ]; then
    if grep -q "YOUTUBE_API_KEY" "$ENV_FILE"; then
        API_KEY=$(grep "YOUTUBE_API_KEY" "$ENV_FILE" | cut -d'=' -f2)
        echo "============================================================"
        echo "✅ Found in existing .env:"
        echo "============================================================"
        echo ""
        echo "YOUTUBE_API_KEY=$API_KEY"
        echo ""
        echo "You already have the API key for public videos!"
        echo ""
    else
        echo "============================================================"
        echo "⚠️  Missing: YOUTUBE_API_KEY"
        echo "============================================================"
        echo ""
        echo "You also need an API key for public MIT videos."
        echo ""
        echo "To get it:"
        echo "  1. Go to: https://console.cloud.google.com/apis/credentials"
        echo "  2. Create API Key"
        echo "  3. Add to .env: YOUTUBE_API_KEY=AIza..."
        echo ""
    fi
fi

# ============================================================
# Offer to append to .env
# ============================================================

if [ -f "$ENV_FILE" ] && [ -n "$CLIENT_ID" ]; then
    echo "============================================================"
    read -p "Append OAuth credentials to .env? (y/n): " APPEND
    echo "============================================================"
    
    if [ "$APPEND" = "y" ] || [ "$APPEND" = "Y" ]; then
        # Check if already exists
        if grep -q "YOUTUBE_CLIENT_ID" "$ENV_FILE"; then
            echo ""
            echo "⚠️  .env already contains YOUTUBE_CLIENT_ID"
            read -p "Overwrite existing OAuth credentials? (y/n): " OVERWRITE
            
            if [ "$OVERWRITE" = "y" ] || [ "$OVERWRITE" = "Y" ]; then
                # Remove old entries
                sed -i.bak '/YOUTUBE_CLIENT_ID/d' "$ENV_FILE"
                sed -i.bak '/YOUTUBE_CLIENT_SECRET/d' "$ENV_FILE"
                sed -i.bak '/YOUTUBE_REFRESH_TOKEN/d' "$ENV_FILE"
                echo "   Removed old entries"
            else
                echo "   Skipping append"
                exit 0
            fi
        fi
        
        # Append new entries
        echo "" >> "$ENV_FILE"
        echo "# YouTube OAuth (extracted $(date))" >> "$ENV_FILE"
        [ -n "$CLIENT_ID" ] && echo "YOUTUBE_CLIENT_ID=$CLIENT_ID" >> "$ENV_FILE"
        [ -n "$CLIENT_SECRET" ] && echo "YOUTUBE_CLIENT_SECRET=$CLIENT_SECRET" >> "$ENV_FILE"
        [ -n "$REFRESH_TOKEN" ] && echo "YOUTUBE_REFRESH_TOKEN=$REFRESH_TOKEN" >> "$ENV_FILE"
        
        echo ""
        echo "✅ Added to $ENV_FILE"
        echo ""
        
        # Show what's in .env now
        echo "Your .env now contains:"
        grep "YOUTUBE" "$ENV_FILE"
        echo ""
    fi
fi

# ============================================================
# Next Steps
# ============================================================

echo "============================================================"
echo "Next Steps:"
echo "============================================================"
echo ""

if [ -n "$REFRESH_TOKEN" ]; then
    echo "✅ Test token refresh:"
    echo "   cd src/scrapers/"
    echo "   node refreshYoutubeToken.js"
    echo ""
fi

if ! grep -q "YOUTUBE_API_KEY" "$ENV_FILE" 2>/dev/null; then
    echo "⚠️  Get API Key for public videos:"
    echo "   https://console.cloud.google.com/apis/credentials"
    echo ""
fi

echo "✅ Run scrapers:"
echo "   cd src/"
echo "   ./runScheduled.sh"
echo ""

echo "============================================================"
echo "✅ Done!"
echo "============================================================"