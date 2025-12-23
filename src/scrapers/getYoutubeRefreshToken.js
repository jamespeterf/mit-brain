#!/usr/bin/env node

// getYoutubeRefreshToken.js
// One-time manual authentication to get initial YouTube OAuth token
// Creates token.json with refresh_token for automated use

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];

async function getNewToken() {
  console.log('============================================================');
  console.log('YouTube OAuth - Initial Authentication');
  console.log('============================================================\n');

  // Load credentials
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('❌ Error: credentials.json not found');
    console.error(`   Expected at: ${CREDENTIALS_PATH}`);
    console.error('\nTo get credentials.json:');
    console.error('1. Go to: https://console.cloud.google.com/');
    console.error('2. Create OAuth 2.0 credentials');
    console.error('3. Download as credentials.json');
    console.error(`4. Place in: ${CREDENTIALS_PATH}`);
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret } = credentials.installed || credentials.web;

  // Create OAuth2 client with OOB (out-of-band) redirect
  // This shows the code directly in the browser instead of redirecting to localhost
  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    'urn:ietf:wg:oauth:2.0:oob'  // OOB - shows code in browser
  );

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // Force to get refresh_token
  });

  console.log('🔐 Step 1: Authorize this app by visiting this URL:\n');
  console.log(authUrl);
  console.log('\n');
  console.log('📋 Step 2: After authorization, you\'ll get a code.');
  console.log('           Paste it here:\n');

  // Get authorization code from user
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Enter the code: ', async (code) => {
    rl.close();
    
    try {
      console.log('\n🔄 Exchanging code for tokens...');
      
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      if (!tokens.refresh_token) {
        console.error('\n❌ Error: No refresh_token received!');
        console.error('   This usually means you need to revoke access and try again:');
        console.error('   https://myaccount.google.com/permissions');
        process.exit(1);
      }

      // Save token to file
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      
      console.log('\n✅ Success! Token saved to:');
      console.log(`   ${TOKEN_PATH}`);
      console.log('\n📝 Token details:');
      console.log(`   Access token: ${tokens.access_token ? '✅ Present' : '❌ Missing'}`);
      console.log(`   Refresh token: ${tokens.refresh_token ? '✅ Present' : '❌ Missing'}`);
      console.log(`   Expires: ${tokens.expiry_date ? new Date(tokens.expiry_date).toLocaleString() : 'Unknown'}`);
      console.log('\n🎉 You can now use automated scraping!');
      console.log('   The refresh token will be used to auto-renew access.');
      
    } catch (error) {
      console.error('\n❌ Error getting tokens:', error.message);
      
      if (error.message.includes('invalid_grant')) {
        console.error('\n💡 The authorization code may have expired or been used already.');
        console.error('   Please run this script again and use a fresh code.');
      }
      
      process.exit(1);
    }
  });
}

getNewToken();