#!/usr/bin/env node

// Auto-refresh YouTube OAuth token if needed
// Handles token expiration automatically without user interaction

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Credentials are in src/scrapers/ (same directory as this script)
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

async function refreshToken() {
  console.log('🔄 Auto-refreshing YouTube OAuth token...\n');

  // Check if files exist
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('❌ Error: credentials.json not found');
    console.error(`   Expected: ${CREDENTIALS_PATH}`);
    process.exit(1);
  }

  if (!fs.existsSync(TOKEN_PATH)) {
    console.error('❌ Error: token.json not found');
    console.error(`   Expected: ${TOKEN_PATH}`);
    console.error('\n   Run the manual auth script first to generate initial token:');
    console.error('   node scrapers/getYoutubeRefreshToken.js');
    process.exit(1);
  }

  try {
    // Load credentials
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const { client_id, client_secret } = credentials.installed || credentials.web;

    // Load existing token
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));

    if (!token.refresh_token) {
      console.error('❌ Error: No refresh_token found in token.json');
      console.error('   Re-run manual auth to get a new token:');
      console.error('   node scrapers/getYoutubeRefreshToken.js');
      process.exit(1);
    }

    // Create OAuth2 client with OOB redirect
    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      'urn:ietf:wg:oauth:2.0:oob'
    );

    // Set the refresh token
    oauth2Client.setCredentials({
      refresh_token: token.refresh_token
    });

    console.log('🔑 Using refresh token to get new access token...');

    // Get new access token
    const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();

    // Update token.json with new access token
    const updatedToken = {
      ...token,
      access_token: newCredentials.access_token,
      expiry_date: newCredentials.expiry_date,
      token_type: newCredentials.token_type || 'Bearer'
    };

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedToken, null, 2));

    console.log('✅ Token refreshed successfully!');
    console.log(`   Access token expires: ${new Date(newCredentials.expiry_date).toLocaleString()}\n`);

    return true;

  } catch (error) {
    console.error('❌ Error refreshing token:', error.message);
    
    if (error.message.includes('invalid_grant')) {
      console.error('\n⚠️  Refresh token is invalid or expired.');
      console.error('   Run manual auth to get a new token:');
      console.error('   node scrapers/getYoutubeRefreshToken.js');
    }
    
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) {
    refreshToken();
  }
}

export { refreshToken };