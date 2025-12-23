#!/usr/bin/env node

// scrapers/scrapeIlpVideos.js
//
// Scrape videos from MIT ILP YouTube playlists using YouTube Data API v3 with OAuth 2.0
// - Fetches video metadata, descriptions, recording dates, thumbnails
// - Does NOT fetch captions (saves quota, they weren't accessible anyway)
// - Uses MITBrainSchema for writing and deduplication
//
// Setup:
// 1. Place credentials.json (OAuth Desktop app) in scrapers/ directory
// 2. Run once to authenticate - saves token.json for future use
//
// Env vars:
//   PLAYLIST_FILE         (path to CSV/TXT file with playlist IDs - takes priority)
//   YOUTUBE_PLAYLIST_ID   (single playlist mode - provide playlist ID)
//   SCRAPE_ALL_PLAYLISTS  (set to 'true' to scrape all playlists)
//   YOUTUBE_CHANNEL_ID    (required if SCRAPE_ALL_PLAYLISTS=true)
//   MAX_PLAYLISTS         (limit number of playlists to process)
//   SKIP_PLAYLISTS        (skip first N playlists)
//   MIT_BRAIN_RUN_ID      (optional - run identifier)
//   START_DATE            (optional - filter videos by publish date)
//   MAX_VIDEOS            (optional - max videos to fetch, default: all)
//
// Playlist File Format (CSV):
//   playlistId,playlistName
//   PLxxxxxx,Conference Name
//   PLyyyyyy,Webinar Series
//
// Or plain text (one playlist ID per line):
//   PLxxxxxx
//   PLyyyyyy

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { createRequire } from 'module';

// Get current file's directory (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (two levels up from src/scrapers/)
dotenv.config({ path: path.join(__dirname, '../..', '.env') });

// Import CommonJS module (MITBrainSchema uses module.exports)
const require = createRequire(import.meta.url);
const { MITBrainSchema, fixText, normalizeDate } = require("../shared/MITBrainSchema.cjs");

// ==================================================
// Configuration
// ==================================================

const DATA_DIR = process.env.DATA_DIR || "../input";
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "token.json");
const PLAYLIST_FILE = process.env.PLAYLIST_FILE 
  ? path.join(DATA_DIR, process.env.PLAYLIST_FILE)
  : path.join(DATA_DIR, "ilpPlaylists.csv");
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl"
];

const YOUTUBE_PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const SCRAPE_ALL_PLAYLISTS = process.env.SCRAPE_ALL_PLAYLISTS === 'true';
const MAX_PLAYLISTS = process.env.MAX_PLAYLISTS ? parseInt(process.env.MAX_PLAYLISTS, 10) : null;
const SKIP_PLAYLISTS = process.env.SKIP_PLAYLISTS ? parseInt(process.env.SKIP_PLAYLISTS, 10) : 0;

// Check if we have a valid scraping mode
const hasPlaylistFile = fs.existsSync(PLAYLIST_FILE);

if (!hasPlaylistFile && !SCRAPE_ALL_PLAYLISTS && !YOUTUBE_PLAYLIST_ID) {
  console.error("ERROR: No valid scraping mode configured");
  console.error("\nOptions:");
  console.error("1. Create playlist file at:", PLAYLIST_FILE);
  console.error("2. Set YOUTUBE_PLAYLIST_ID for a single playlist");
  console.error("3. Set SCRAPE_ALL_PLAYLISTS=true to scrape all playlists on your channel");
  process.exit(1);
}

if (!fs.existsSync(CREDENTIALS_PATH)) {
  console.error("ERROR: credentials.json not found in scrapers/ directory");
  console.error("\nPlease follow these steps:");
  console.error("1. Go to https://console.cloud.google.com/");
  console.error("2. Create/select a project");
  console.error("3. Enable YouTube Data API v3");
  console.error("4. Create OAuth 2.0 credentials (Desktop app)");
  console.error("5. Download credentials.json to scrapers/ directory");
  process.exit(1);
}

const START_DATE = process.env.START_DATE
  ? new Date(process.env.START_DATE)
  : null;

if (START_DATE && START_DATE.toString() === "Invalid Date") {
  console.warn(
    `WARNING: START_DATE "${process.env.START_DATE}" is invalid. Ignoring date filter.`
  );
}

const MAX_VIDEOS = process.env.MAX_VIDEOS
  ? parseInt(process.env.MAX_VIDEOS, 10)
  : null;

// ==================================================
// OAuth 2.0 Authentication
// ==================================================

async function authorize() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id } = credentials.installed || credentials.web;
  
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    'urn:ietf:wg:oauth:2.0:oob'
  );

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
    console.log("✓ Using saved authentication token");
    
    // Set up automatic token refresh
    oAuth2Client.on('tokens', (tokens) => {
      console.log("✓ Token refreshed automatically");
      const currentToken = JSON.parse(fs.readFileSync(TOKEN_PATH));
      
      if (tokens.refresh_token) {
        currentToken.refresh_token = tokens.refresh_token;
      }
      if (tokens.access_token) {
        currentToken.access_token = tokens.access_token;
      }
      if (tokens.expiry_date) {
        currentToken.expiry_date = tokens.expiry_date;
      }
      
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(currentToken, null, 2));
    });
    
    // Token was already refreshed by autoRefreshYoutubeToken.js
    // Just return the client - it will auto-refresh if needed during API calls
    return oAuth2Client;
  }

  // No token exists - need initial authentication
  return getNewToken(oAuth2Client);
}

async function getNewToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  console.log("\n" + "=".repeat(70));
  console.log("FIRST-TIME AUTHENTICATION REQUIRED");
  console.log("=".repeat(70));
  console.log("\nAuthorize this app by visiting this URL:");
  console.log("\n" + authUrl + "\n");
  console.log("After authorization, you'll get a code. Paste it here:");
  console.log("=".repeat(70) + "\n");

  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question("Enter the code from the page: ", (code) => {
      rl.close();
      oAuth2Client.getToken(code, (err, token) => {
        if (err) {
          console.error("Error retrieving access token:", err);
          reject(err);
          return;
        }
        oAuth2Client.setCredentials(token);
        
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
        console.log("\n✓ Token stored to", TOKEN_PATH);
        console.log("✓ Future runs will use this token automatically\n");
        
        resolve(oAuth2Client);
      });
    });
  });
}

// ==================================================
// YouTube API Helpers
// ==================================================

async function getMyChannelId(youtube) {
  try {
    const res = await youtube.channels.list({
      part: "id",
      mine: true
    });
    
    if (res.data.items && res.data.items.length > 0) {
      return res.data.items[0].id;
    }
    return null;
  } catch (err) {
    console.error(`ERROR: Failed to get channel ID: ${err.message}`);
    return null;
  }
}

async function loadPlaylistsFromFile(filePath) {
  console.log(`Loading playlists from file: ${filePath}`);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Playlist file not found: ${filePath}`);
  }
  
  const fileContent = fs.readFileSync(filePath, 'utf8');
  
  // Check if it's CSV or plain text
  const lines = fileContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  
  if (lines.length === 0) {
    throw new Error('Playlist file is empty');
  }
  
  const header = lines[0].toLowerCase();
  const isCsv = header.includes('playlistid') || header.includes(',');
  
  const playlists = [];
  
  if (isCsv) {
    console.log('✓ Detected CSV format');
    
    // Parse CSV manually
    const dataLines = lines.slice(1); // Skip header
    
    for (const line of dataLines) {
      if (!line.trim()) continue;
      
      // Simple CSV parsing - split by comma and handle quotes
      const parts = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          parts.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      parts.push(current.trim()); // Add last part
      
      if (parts.length >= 1) {
        const playlistId = parts[0];
        const title = parts.length > 1 ? parts[1] : '';
        
        if (playlistId) {
          playlists.push({
            id: playlistId,
            title: title,
            description: '',
            itemCount: 0
          });
        }
      }
    }
  } else {
    console.log('✓ Detected plain text format (one ID per line)');
    // Plain text - one ID per line
    for (const line of lines) {
      const playlistId = line.trim();
      if (playlistId) {
        playlists.push({
          id: playlistId,
          title: '',
          description: '',
          itemCount: 0
        });
      }
    }
  }
  
  console.log(`✓ Loaded ${playlists.length} playlists from file\n`);
  return playlists;
}

async function fetchAllPlaylists(youtube, channelId) {
  console.log(`Fetching all playlists for channel: ${channelId}`);
  
  const playlists = [];
  let pageToken = null;
  let pageNum = 0;

  while (true) {
    pageNum++;
    console.log(`  Fetching playlist page ${pageNum}...`);

    const params = {
      part: "snippet,contentDetails,status",
      channelId: channelId,
      maxResults: 50,
      pageToken: pageToken || undefined
    };

    let res;
    try {
      res = await youtube.playlists.list(params);
    } catch (err) {
      console.error(`ERROR: Failed to fetch playlists: ${err.message}`);
      break;
    }

    const items = res.data.items || [];
    console.log(`  Found ${items.length} playlists on page ${pageNum}`);

    for (const item of items) {
      const playlistId = item.id;
      const snippet = item.snippet;
      const itemCount = item.contentDetails?.itemCount || 0;

      // Get the first video in the playlist and check when it was uploaded
      let lastActivityDate = snippet.publishedAt; // Fallback to playlist creation date
      
      if (itemCount > 0) {
        try {
          console.log(`    Checking first video in: ${snippet.title.slice(0, 40)}...`);
          
          // First, get the video ID from the playlist
          const playlistItemsRes = await youtube.playlistItems.list({
            part: "contentDetails",
            playlistId: playlistId,
            maxResults: 1
          });
          
          if (playlistItemsRes.data.items && playlistItemsRes.data.items.length > 0) {
            const videoId = playlistItemsRes.data.items[0].contentDetails.videoId;
            
            // Now get the actual video details to get the upload date
            const videoRes = await youtube.videos.list({
              part: "snippet",
              id: videoId
            });
            
            if (videoRes.data.items && videoRes.data.items.length > 0) {
              const videoUploadDate = videoRes.data.items[0].snippet.publishedAt;
              lastActivityDate = videoUploadDate;
              console.log(`    -> Video uploaded: ${videoUploadDate.split('T')[0]}`);
            }
          }
        } catch (err) {
          console.log(`    -> Error, using fallback: ${err.message}`);
        }
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 150));

      playlists.push({
        id: playlistId,
        title: snippet.title,
        description: snippet.description,
        itemCount: itemCount,
        publishedAt: snippet.publishedAt,
        lastActivityDate: lastActivityDate
      });
    }

    pageToken = res.data.nextPageToken;
    if (!pageToken) {
      console.log(`  Total playlists found: ${playlists.length}`);
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return playlists;
}

async function fetchPlaylistVideos(youtube, playlistId) {
  console.log(`Fetching videos from playlist: ${playlistId}`);
  
  const videos = [];
  let pageToken = null;
  let pageNum = 0;

  while (true) {
    pageNum++;
    console.log(`  Fetching page ${pageNum}...`);

    const params = {
      part: "snippet,contentDetails",
      playlistId: playlistId,
      maxResults: 50,
      pageToken: pageToken || undefined
    };

    let res;
    try {
      res = await youtube.playlistItems.list(params);
    } catch (err) {
      console.error(`ERROR: Failed to fetch playlist items: ${err.message}`);
      break;
    }

    const items = res.data.items || [];
    console.log(`  Found ${items.length} videos on page ${pageNum}`);

    for (const item of items) {
      const videoId = item.contentDetails?.videoId;
      const snippet = item.snippet;

      if (!videoId) continue;

      videos.push({
        videoId,
        title: snippet.title,
        description: snippet.description,
        publishedAt: snippet.publishedAt,
        thumbnails: snippet.thumbnails
      });
    }

    pageToken = res.data.nextPageToken;
    if (!pageToken) {
      console.log(`  Total videos found: ${videos.length}`);
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return videos;
}

async function fetchVideoDetails(youtube, videoId) {
  const params = {
    part: "snippet,contentDetails,statistics,recordingDetails",
    id: videoId
  };

  try {
    const res = await youtube.videos.list(params);
    
    if (res.data.items && res.data.items.length > 0) {
      return res.data.items[0];
    }
    return null;
  } catch (err) {
    console.warn(`  Warning: Failed to fetch video details: ${err.message}`);
    return null;
  }
}

function extractTags(videoDetails) {
  const tags = [];
  
  if (videoDetails.snippet && Array.isArray(videoDetails.snippet.tags)) {
    tags.push(...videoDetails.snippet.tags.map(t => fixText(t)));
  }

  if (videoDetails.snippet && videoDetails.snippet.categoryId) {
    const categoryMap = {
      '1': 'Film & Animation',
      '2': 'Autos & Vehicles',
      '10': 'Music',
      '15': 'Pets & Animals',
      '17': 'Sports',
      '19': 'Travel & Events',
      '20': 'Gaming',
      '22': 'People & Blogs',
      '23': 'Comedy',
      '24': 'Entertainment',
      '25': 'News & Politics',
      '26': 'Howto & Style',
      '27': 'Education',
      '28': 'Science & Technology',
      '29': 'Nonprofits & Activism'
    };
    const categoryName = categoryMap[videoDetails.snippet.categoryId];
    if (categoryName) {
      tags.push(categoryName);
    }
  }

  return Array.from(new Set(tags));
}

function parseDurationToSeconds(isoDuration) {
  if (!isoDuration) return 0;
  
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  
  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseInt(match[3] || 0);
  
  return (hours * 3600) + (minutes * 60) + seconds;
}

function getBestThumbnail(thumbnails) {
  if (!thumbnails) return "";
  
  if (thumbnails.maxres) return thumbnails.maxres.url;
  if (thumbnails.high) return thumbnails.high.url;
  if (thumbnails.medium) return thumbnails.medium.url;
  if (thumbnails.default) return thumbnails.default.url;
  
  return "";
}

function videoToRecord(video, videoDetails, playlistName) {
  const snippet = videoDetails?.snippet || video;
  
  const title = fixText(snippet.title || video.title);
  const description = fixText(snippet.description || video.description);
  const publishedAt = normalizeDate(snippet.publishedAt || video.publishedAt);
  const url = `https://www.youtube.com/watch?v=${video.videoId}`;

  let recordingDate = null;
  if (videoDetails?.recordingDetails?.recordingDate) {
    recordingDate = normalizeDate(videoDetails.recordingDetails.recordingDate);
  }

  const tags = videoDetails ? extractTags(videoDetails) : [];

  const authors = [];
  if (snippet.channelTitle) {
    authors.push(fixText(snippet.channelTitle));
  }

  const thumbnailUrl = getBestThumbnail(
    videoDetails?.snippet?.thumbnails || video.thumbnails
  );

  const durationSeconds = parseDurationToSeconds(
    videoDetails?.contentDetails?.duration || ""
  );

  const record = {
    kind: "video",
    source: "YouTube",
    sourceType: "video",
    title,
    url,
    publishedAt,
    rawDate: snippet.publishedAt || video.publishedAt || "",
    summary: description,
    fullText: "",
    tags,
    authors,
    mitGroups: ["MIT ILP"],
    mitAuthors: authors,
    eventName: playlistName || "",
    ilpSummary: "",
    ilpKeywords: "",
    
    videoId: video.videoId,
    durationSeconds: durationSeconds,
    thumbnailUrl: thumbnailUrl,
    recordingDate: recordingDate,
    speakers: [],
    viewCount: parseInt(videoDetails?.statistics?.viewCount || 0),
    likeCount: parseInt(videoDetails?.statistics?.likeCount || 0),
    commentCount: parseInt(videoDetails?.statistics?.commentCount || 0)
  };

  return record;
}

// ==================================================
// Main scraping function
// ==================================================

async function scrapeIlpVideos() {
  console.log("YouTube ILP Video scraper starting.");

  if (START_DATE && START_DATE.toString() !== "Invalid Date") {
    console.log(`Using START_DATE filter: ${process.env.START_DATE}`);
  }

  if (MAX_VIDEOS) {
    console.log(`MAX_VIDEOS: ${MAX_VIDEOS}`);
  }

  if (MAX_PLAYLISTS) {
    console.log(`MAX_PLAYLISTS: ${MAX_PLAYLISTS}`);
  }

  if (SKIP_PLAYLISTS > 0) {
    console.log(`SKIP_PLAYLISTS: ${SKIP_PLAYLISTS}`);
  }

  console.log("\nAuthenticating with YouTube API...");
  const auth = await authorize();
  const youtube = google.youtube({ version: "v3", auth });
  console.log("✓ Authentication successful\n");

  const schema = new MITBrainSchema();

  let playlistsToScrape = [];

  // Check if playlist file exists
  if (fs.existsSync(PLAYLIST_FILE)) {
    console.log("Mode: Using playlist file\n");
    console.log(`📋 Reading playlists from: ${PLAYLIST_FILE}\n`);
    
    playlistsToScrape = await loadPlaylistsFromFile(PLAYLIST_FILE);
    
    if (playlistsToScrape.length === 0) {
      console.log("No playlists found in file.");
      return;
    }
    
    console.log(`\nWill process ${playlistsToScrape.length} playlists from file:\n`);
    playlistsToScrape.forEach((pl, idx) => {
      console.log(`  ${idx + 1}. ${pl.title || pl.id}`);
    });
    console.log("");
    
  } else if (SCRAPE_ALL_PLAYLISTS) {
    console.log("Mode: Scraping ALL playlists on your channel\n");
    
    let channelId = YOUTUBE_CHANNEL_ID;
    if (!channelId) {
      console.log("Detecting your channel ID...");
      channelId = await getMyChannelId(youtube);
      if (!channelId) {
        console.error("ERROR: Could not determine channel ID");
        return;
      }
      console.log(`✓ Channel ID: ${channelId}\n`);
    }
    
    const allPlaylists = await fetchAllPlaylists(youtube, channelId);
    
    if (allPlaylists.length === 0) {
      console.log("No playlists found on your channel.");
      return;
    }
    
    // Sort playlists by last activity (based on most recent video)
    allPlaylists.sort((a, b) => {
      const dateA = new Date(a.lastActivityDate);
      const dateB = new Date(b.lastActivityDate);
      return dateB - dateA; // Descending order (newest activity first)
    });
    
    console.log(`\nFound ${allPlaylists.length} playlists (sorted by most recent video):\n`);
    
    let filteredPlaylists = allPlaylists;
    
    if (SKIP_PLAYLISTS > 0) {
      filteredPlaylists = filteredPlaylists.slice(SKIP_PLAYLISTS);
      console.log(`Skipping first ${SKIP_PLAYLISTS} playlists`);
    }
    
    if (MAX_PLAYLISTS) {
      filteredPlaylists = filteredPlaylists.slice(0, MAX_PLAYLISTS);
      console.log(`Limiting to ${MAX_PLAYLISTS} playlists`);
    }
    
    console.log(`\nWill process ${filteredPlaylists.length} playlists:\n`);
    filteredPlaylists.forEach((pl, idx) => {
      const originalIdx = SKIP_PLAYLISTS + idx;
      const activityDate = new Date(pl.lastActivityDate).toISOString().split('T')[0];
      console.log(`  ${originalIdx + 1}. [${activityDate}] ${pl.title} (${pl.itemCount} videos)`);
    });
    console.log("");
    
    playlistsToScrape = filteredPlaylists;
    
  } else {
    console.log(`Mode: Scraping single playlist: ${YOUTUBE_PLAYLIST_ID}\n`);
    
    try {
      const playlistRes = await youtube.playlists.list({
        part: "snippet",
        id: YOUTUBE_PLAYLIST_ID
      });
      
      if (playlistRes.data.items && playlistRes.data.items.length > 0) {
        const playlistTitle = playlistRes.data.items[0].snippet.title;
        playlistsToScrape = [{
          id: YOUTUBE_PLAYLIST_ID,
          title: playlistTitle,
          itemCount: "?"
        }];
        console.log(`Playlist: ${playlistTitle}\n`);
      } else {
        console.warn(`Could not fetch playlist details. Using fallback name.`);
        playlistsToScrape = [{
          id: YOUTUBE_PLAYLIST_ID,
          title: "Unknown Playlist",
          itemCount: "?"
        }];
      }
    } catch (err) {
      console.warn(`Error fetching playlist details: ${err.message}`);
      playlistsToScrape = [{
        id: YOUTUBE_PLAYLIST_ID,
        title: "Unknown Playlist",
        itemCount: "?"
      }];
    }
  }

  let totalVideosProcessed = 0;

  for (let pIdx = 0; pIdx < playlistsToScrape.length; pIdx++) {
    const playlist = playlistsToScrape[pIdx];
    
    console.log("\n" + "=".repeat(80));
    console.log(`PLAYLIST ${pIdx + 1}/${playlistsToScrape.length}: ${playlist.title}`);
    console.log(`Playlist ID: ${playlist.id}`);
    console.log(`Videos in playlist: ${playlist.itemCount}`);
    console.log("=".repeat(80) + "\n");

    const videos = await fetchPlaylistVideos(youtube, playlist.id);

    if (videos.length === 0) {
      console.log("No videos found in this playlist.\n");
      continue;
    }

    console.log(`Processing ${videos.length} videos from this playlist...\n`);

    let playlistVideosProcessed = 0;

    for (const video of videos) {
      if (MAX_VIDEOS && totalVideosProcessed >= MAX_VIDEOS) {
        console.log(`\nReached global MAX_VIDEOS limit (${MAX_VIDEOS}). Stopping.`);
        break;
      }

      if (START_DATE && START_DATE.toString() !== "Invalid Date") {
        const videoDate = new Date(video.publishedAt);
        if (!isNaN(videoDate) && videoDate < START_DATE) {
          console.log(`[${playlistVideosProcessed + 1}/${videos.length}] Skip (before START_DATE): ${video.title.slice(0, 60)}...`);
          playlistVideosProcessed++;
          continue;
        }
      }

      console.log(`[${playlistVideosProcessed + 1}/${videos.length}] ${video.title.slice(0, 70)}...`);

      const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

      // Check for duplicate BEFORE fetching details (saves API quota)
      if (schema.isDuplicate(videoUrl, true)) {  // true = track as skipped
        console.log(`  Skip (duplicate)\n`);
        playlistVideosProcessed++;
        continue;
      }

      console.log(`  Fetching details...`);
      const videoDetails = await fetchVideoDetails(youtube, video.videoId);

      const record = videoToRecord(video, videoDetails, playlist.title);

      const result = schema.write(record);
      if (result.written) {
        totalVideosProcessed++;
        console.log(`  ✓ Written (${totalVideosProcessed} total)\n`);
      }

      playlistVideosProcessed++;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    console.log(`\nPlaylist summary:`);
    console.log(`  Videos processed: ${playlistVideosProcessed}\n`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("FINAL SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total playlists processed: ${playlistsToScrape.length}`);
  console.log(`Total videos processed: ${totalVideosProcessed}`);
  console.log("=".repeat(80) + "\n");

  console.log("\n💾 Writing CSV and JSON files...");
  schema.flush();
  
  // Run sanity check
  schema.printSanityCheck();
  
  // Print stats
  schema.printStats();

  console.log("✅ Files written successfully!");
}

// ==================================================
// Entrypoint
// ==================================================

async function main() {
  try {
    await scrapeIlpVideos();
  } catch (err) {
    console.error("Fatal error in scrapeIlpVideos:", err);
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) {
    main();
  }
}

export { scrapeIlpVideos };