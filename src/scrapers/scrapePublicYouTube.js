#!/usr/bin/env node

// scrapers/scrapePublicYouTube.js
//
// Scrape videos from PUBLIC YouTube channels using YouTube Data API v3 with API Key
// - Works with any public channel (no OAuth needed!)
// - Supports MULTIPLE channels from a text file
// - Fetches video metadata, descriptions, recording dates, thumbnails
// - Uses MITBrainSchema for writing and deduplication
//
// Setup:
// 1. Get a YouTube Data API v3 key from Google Cloud Console
// 2. Set YOUTUBE_API_KEY environment variable
// 3. (Optional) Create data/publicYouTubeChannels.txt with channel list
//
// Env vars:
//   YOUTUBE_API_KEY       (required - your YouTube Data API key)
//   
//   Multi-channel mode (reads from file):
//   CHANNEL_FILE          (optional - path to channel list, default: publicYouTubeChannels.txt)
//
//   Single-channel mode (env var):
//   YOUTUBE_CHANNEL_ID    (channel to scrape, e.g., UCuKRJnHUTf8PNHjjP8sEqJg for MIT CSAIL)
//   YOUTUBE_CHANNEL_URL   (alternative - provide channel URL like @MITCSAIL)
//
//   Filters:
//   MAX_CHANNELS          (optional - limit number of channels to process)
//   MAX_PLAYLISTS         (optional - limit number of playlists per channel)
//   SKIP_PLAYLISTS        (optional - skip first N playlists)
//   START_DATE            (optional - filter videos by publish date, YYYY-MM-DD)
//   MAX_VIDEOS            (optional - max videos per channel, default: all)
//   MIT_BRAIN_RUN_ID      (optional - run identifier)
//
// Channel File Format (data/publicYouTubeChannels.txt):
//   # Comments start with #
//   @MITCSAIL,MIT CSAIL
//   @mitocw,MIT OpenCourseWare
//   UCuKRJnHUTf8PNHjjP8sEqJg,MIT CSAIL by ID
//
// Example usage:
//   # Multi-channel from file (recommended)
//   YOUTUBE_API_KEY=xxx node scrapePublicYouTube.js
//
//   # Single channel by handle
//   YOUTUBE_API_KEY=xxx YOUTUBE_CHANNEL_URL=@MITCSAIL node scrapePublicYouTube.js
//
//   # Single channel by ID
//   YOUTUBE_API_KEY=xxx YOUTUBE_CHANNEL_ID=UCuKRJnHUTf8PNHjjP8sEqJg node scrapePublicYouTube.js
//
//   # First 3 channels only
//   YOUTUBE_API_KEY=xxx MAX_CHANNELS=3 node scrapePublicYouTube.js

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

const INPUT_DIR = process.env.INPUT_DIR || path.join(__dirname, '../..', 'input');
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
let YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const YOUTUBE_CHANNEL_URL = process.env.YOUTUBE_CHANNEL_URL;
const CHANNEL_FILE = process.env.CHANNEL_FILE 
  ? path.join(INPUT_DIR, process.env.CHANNEL_FILE)
  : path.join(INPUT_DIR, "publicYouTubeChannels.txt");

const MAX_PLAYLISTS = process.env.MAX_PLAYLISTS ? parseInt(process.env.MAX_PLAYLISTS, 10) : null;
const SKIP_PLAYLISTS = process.env.SKIP_PLAYLISTS ? parseInt(process.env.SKIP_PLAYLISTS, 10) : 0;
const START_DATE = process.env.START_DATE ? new Date(process.env.START_DATE) : null;
const MAX_VIDEOS = process.env.MAX_VIDEOS ? parseInt(process.env.MAX_VIDEOS, 10) : null;
const MAX_CHANNELS = process.env.MAX_CHANNELS ? parseInt(process.env.MAX_CHANNELS, 10) : null;

// Full scrape mode - disables early exit optimization but STILL respects START_DATE
// This ensures we check ALL playlists for new videos while avoiding ancient content
const FULL_SCRAPE = process.env.FULL_SCRAPE === 'true' || process.env.FULL_SCRAPE === '1';

// Check if we have a valid scraping mode
const hasChannelFile = fs.existsSync(CHANNEL_FILE);

// Validate configuration
if (!YOUTUBE_API_KEY) {
  console.error("ERROR: YOUTUBE_API_KEY environment variable is required");
  console.error("\nPlease follow these steps:");
  console.error("1. Go to https://console.cloud.google.com/");
  console.error("2. Create/select a project");
  console.error("3. Enable YouTube Data API v3");
  console.error("4. Go to 'Credentials' and create an API Key");
  console.error("5. Set YOUTUBE_API_KEY environment variable");
  console.error("\nExample:");
  console.error("  YOUTUBE_API_KEY=AIza... node scrapePublicYouTube.js");
  process.exit(1);
}

if (!hasChannelFile && !YOUTUBE_CHANNEL_ID && !YOUTUBE_CHANNEL_URL) {
  console.error("ERROR: No valid scraping mode configured");
  console.error("\nOptions:");
  console.error(`1. Create channel file at: ${CHANNEL_FILE}`);
  console.error("2. Set YOUTUBE_CHANNEL_ID for a single channel");
  console.error("3. Set YOUTUBE_CHANNEL_URL for a single channel");
  console.error("\nChannel file format (one per line):");
  console.error("  @MITCSAIL");
  console.error("  @mitocw");
  console.error("  UCuKRJnHUTf8PNHjjP8sEqJg");
  console.error("\nOr with names (CSV):");
  console.error("  @MITCSAIL,MIT CSAIL");
  console.error("  @mitocw,MIT OpenCourseWare");
  process.exit(1);
}

if (START_DATE && START_DATE.toString() === "Invalid Date") {
  console.warn(`WARNING: START_DATE "${process.env.START_DATE}" is invalid. Ignoring date filter.`);
}

// ==================================================
// YouTube API Setup (API Key - No OAuth!)
// ==================================================

const youtube = google.youtube({
  version: "v3",
  auth: YOUTUBE_API_KEY
});

// ==================================================
// YouTube API Helpers
// ==================================================

async function getChannelIdFromUrl(channelUrl) {
  // If it's a handle like @MITCSAIL
  if (channelUrl.startsWith('@')) {
    const handle = channelUrl.substring(1);
    
    try {
      const res = await youtube.search.list({
        part: "snippet",
        q: handle,
        type: "channel",
        maxResults: 1
      });
      
      if (res.data.items && res.data.items.length > 0) {
        return res.data.items[0].snippet.channelId;
      }
    } catch (err) {
      console.error(`Error looking up channel handle: ${err.message}`);
    }
  }
  
  return null;
}

async function loadChannelsFromFile(filePath) {
  console.log(`Loading channels from file: ${filePath}\n`);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Channel file not found: ${filePath}`);
  }
  
  const fileContent = fs.readFileSync(filePath, 'utf8');
  
  // Parse file - support both plain text and CSV
  const lines = fileContent.split('\n').filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('#');
  });
  
  if (lines.length === 0) {
    throw new Error('Channel file is empty');
  }
  
  const channels = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check if it's CSV format (channelId/handle,name)
    if (trimmed.includes(',')) {
      const parts = trimmed.split(',').map(p => p.trim());
      const channelIdOrHandle = parts[0];
      const name = parts[1] || channelIdOrHandle;
      
      channels.push({
        input: channelIdOrHandle,
        name: name,
        id: null // Will be resolved later
      });
    } else {
      // Plain text - just channel ID or handle
      channels.push({
        input: trimmed,
        name: trimmed,
        id: null // Will be resolved later
      });
    }
  }
  
  console.log(`📋 Loaded ${channels.length} channels from file:\n`);
  channels.forEach((ch, idx) => {
    console.log(`  ${idx + 1}. ${ch.name}`);
  });
  console.log("");
  
  return channels;
}

async function getChannelInfo(channelId) {
  try {
    const res = await youtube.channels.list({
      part: "snippet,statistics",
      id: channelId
    });
    
    if (res.data.items && res.data.items.length > 0) {
      const channel = res.data.items[0];
      return {
        id: channel.id,
        title: channel.snippet.title,
        description: channel.snippet.description,
        subscriberCount: channel.statistics.subscriberCount,
        videoCount: channel.statistics.videoCount,
        viewCount: channel.statistics.viewCount
      };
    }
    return null;
  } catch (err) {
    console.error(`ERROR: Failed to get channel info: ${err.message}`);
    return null;
  }
}

async function fetchAllPlaylists(channelId) {
  const playlists = [];
  let nextPageToken = null;
  
  console.log("Fetching all playlists from channel...");
  
  do {
    try {
      const res = await youtube.playlists.list({
        part: "snippet,contentDetails",
        channelId: channelId,
        maxResults: 50,
        pageToken: nextPageToken
      });
      
      if (res.data.items) {
        for (const item of res.data.items) {
          playlists.push({
            id: item.id,
            title: item.snippet.title,
            description: item.snippet.description,
            publishedAt: item.snippet.publishedAt,
            itemCount: item.contentDetails.itemCount
          });
        }
      }
      
      nextPageToken = res.data.nextPageToken;
      
      if (nextPageToken) {
        console.log(`  Fetched ${playlists.length} playlists, continuing...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
      }
      
    } catch (err) {
      console.error(`Error fetching playlists: ${err.message}`);
      break;
    }
  } while (nextPageToken);
  
  console.log(`✓ Found ${playlists.length} total playlists\n`);
  return playlists;
}

async function fetchPlaylistVideos(playlistId) {
  const videos = [];
  let nextPageToken = null;
  
  do {
    try {
      const res = await youtube.playlistItems.list({
        part: "snippet,contentDetails",
        playlistId: playlistId,
        maxResults: 50,
        pageToken: nextPageToken
      });
      
      if (res.data.items) {
        for (const item of res.data.items) {
          videos.push({
            videoId: item.contentDetails.videoId,
            title: item.snippet.title,
            description: item.snippet.description,
            publishedAt: item.snippet.publishedAt,
            thumbnails: item.snippet.thumbnails
          });
        }
      }
      
      nextPageToken = res.data.nextPageToken;
      
      if (nextPageToken) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
      }
      
    } catch (err) {
      console.error(`Error fetching videos from playlist: ${err.message}`);
      break;
    }
  } while (nextPageToken);
  
  return videos;
}

async function fetchVideoDetails(videoId) {
  try {
    const res = await youtube.videos.list({
      part: "snippet,contentDetails,statistics,recordingDetails",
      id: videoId
    });
    
    if (res.data.items && res.data.items.length > 0) {
      const video = res.data.items[0];
      
      // Debug: Log what API returned
      const desc = video.snippet?.description || "";
      const descPreview = desc.length > 100 ? desc.substring(0, 100) + "..." : desc;
      
      if (desc.length > 0) {
        console.log(`    🔍 API videos.list returned ${desc.length} char description`);
        console.log(`    🔍 First 100 chars: "${descPreview}"`);
      } else {
        console.log(`    ⚠️ API videos.list returned EMPTY description`);
      }
      
      return video;
    } else {
      console.log(`    ❌ No video found with ID: ${videoId}`);
      return null;
    }
  } catch (err) {
    console.error(`    ❌ Error fetching video details for ${videoId}: ${err.message}`);
    return null;
  }
}

// ==================================================
// Data Transformation
// ==================================================

function videoToRecord(video, videoDetails, playlistTitle, channelInfo) {
  // CRITICAL: Always use videoDetails for description if available
  // The 'video' object from playlist items has TRUNCATED descriptions
  // The 'videoDetails' object from videos.list has FULL descriptions
  
  const snippet = videoDetails?.snippet || video;
  const contentDetails = videoDetails?.contentDetails;
  const statistics = videoDetails?.statistics;
  const recordingDetails = videoDetails?.recordingDetails;
  
  // Extract recording date if available, otherwise use publish date
  let recordingDate = null;
  if (recordingDetails && recordingDetails.recordingDate) {
    recordingDate = normalizeDate(recordingDetails.recordingDate);
  } else if (snippet.publishedAt) {
    recordingDate = normalizeDate(snippet.publishedAt);
  }
  
  // Get video description - CRITICAL: Use videoDetails, NOT video from playlist
  let description = "";
  let descSource = "none";
  
  // Priority 1: Use full description from videoDetails (videos.list API)
  if (videoDetails && videoDetails.snippet && typeof videoDetails.snippet.description === 'string') {
    description = videoDetails.snippet.description; // Don't use fixText yet
    descSource = "videoDetails.snippet.description (FULL)";
    console.log(`    📄 Using FULL description from videoDetails (${description.length} chars)`);
  } 
  // Priority 2: Fallback to truncated description from playlist items
  else if (video && typeof video.description === 'string') {
    description = video.description;
    descSource = "video.description (TRUNCATED from playlist)";
    console.log(`    ⚠️ Using TRUNCATED description from playlist items (${description.length} chars)`);
  }
  // Priority 3: No description available
  else {
    description = "";
    descSource = "none available";
    console.log(`    ❌ NO DESCRIPTION AVAILABLE`);
  }
  
  // Save raw description before fixText
  const rawDescription = description;
  const rawLength = rawDescription.length;
  
  // Apply fixText to clean the description
  description = fixText(description);
  
  // CRITICAL CHECK: Did fixText destroy the description?
  if (rawLength > 100 && description.length < 10) {
    console.log(`    ⚠️⚠️⚠️ WARNING: fixText removed almost entire description!`);
    console.log(`    ⚠️⚠️⚠️ Before fixText: ${rawLength} chars`);
    console.log(`    ⚠️⚠️⚠️ After fixText: ${description.length} chars`);
    console.log(`    ⚠️⚠️⚠️ Using RAW description instead`);
    // Use raw description if fixText destroyed it
    description = rawDescription;
  } else if (rawLength > 0) {
    console.log(`    🧹 fixText OK: ${rawLength} → ${description.length} chars`);
  }
  
  // Build summary with metadata
  let summary = description;
  
  // Add duration if available
  if (contentDetails && contentDetails.duration) {
    const duration = parseDuration(contentDetails.duration);
    if (duration) {
      summary = `Duration: ${duration}\n\n${summary}`;
    }
  }
  
  // Add statistics if available
  if (statistics) {
    const stats = [];
    if (statistics.viewCount) stats.push(`Views: ${parseInt(statistics.viewCount).toLocaleString()}`);
    if (statistics.likeCount) stats.push(`Likes: ${parseInt(statistics.likeCount).toLocaleString()}`);
    if (statistics.commentCount) stats.push(`Comments: ${parseInt(statistics.commentCount).toLocaleString()}`);
    
    if (stats.length > 0) {
      summary = `${stats.join(' | ')}\n\n${summary}`;
    }
  }
  
  // Add playlist and channel context
  summary = `Playlist: ${playlistTitle}\nChannel: ${channelInfo.title}\n\n${summary}`;
  
  // CRITICAL DEBUG: Show actual summary right before return
  console.log(`    🔍 FINAL summary length: ${summary.length} chars`);
  console.log(`    🔍 FINAL summary content:\n${summary.substring(0, 300)}\n...\n`);
  
  // Get best thumbnail
  const thumbnails = snippet.thumbnails || {};
  const thumbnail = thumbnails.maxres?.url || 
                   thumbnails.high?.url || 
                   thumbnails.medium?.url || 
                   thumbnails.default?.url || 
                   "";
  
  return {
    url: `https://www.youtube.com/watch?v=${video.videoId}`,
    title: fixText(snippet.title),
    summary: summary,
    kind: "video",
    source: "YouTube",
    sourceType: "public channel",
    date: recordingDate,
    mitGroups: [channelInfo.title, playlistTitle],
    keywords: extractKeywords(snippet),
    imageUrl: thumbnail
  };
}

function parseDuration(duration) {
  // Convert ISO 8601 duration (PT1H2M3S) to readable format
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  
  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseInt(match[3] || 0);
  
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  
  return parts.join(' ');
}

function extractKeywords(snippet) {
  const keywords = [];
  
  // Add tags if available
  if (snippet.tags && Array.isArray(snippet.tags)) {
    keywords.push(...snippet.tags);
  }
  
  // Add category
  if (snippet.categoryId) {
    const categoryNames = {
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
    
    const categoryName = categoryNames[snippet.categoryId];
    if (categoryName) {
      keywords.push(categoryName);
    }
  }
  
  return keywords.join(', ');
}

// ==================================================
// Main Scraping Function
// ==================================================

async function scrapePublicYouTube() {
  console.log("YouTube Public Channel scraper starting.");
  console.log("=".repeat(80));
  
  // Initialize schema once for all channels
  const schema = new MITBrainSchema();
  
  let channelsToScrape = [];
  
  // Determine scraping mode
  if (hasChannelFile) {
    console.log("Mode: Using channel file\n");
    channelsToScrape = await loadChannelsFromFile(CHANNEL_FILE);
    
    if (channelsToScrape.length === 0) {
      console.log("No channels found in file.");
      return;
    }
    
    // Apply MAX_CHANNELS limit if set
    if (MAX_CHANNELS && channelsToScrape.length > MAX_CHANNELS) {
      console.log(`Limiting to first ${MAX_CHANNELS} channels\n`);
      channelsToScrape = channelsToScrape.slice(0, MAX_CHANNELS);
    }
    
  } else {
    // Single channel mode
    console.log("Mode: Single channel\n");
    
    let channelInput = YOUTUBE_CHANNEL_URL || YOUTUBE_CHANNEL_ID;
    let channelName = channelInput;
    
    channelsToScrape = [{
      input: channelInput,
      name: channelName,
      id: YOUTUBE_CHANNEL_ID || null
    }];
  }
  
  console.log(`Will process ${channelsToScrape.length} channel(s)\n`);
  
  if (FULL_SCRAPE) {
    console.log("🔄 FULL SCRAPE MODE - Checking all playlists thoroughly");
    console.log("   Will check ALL playlists for new videos (no early exit)");
    if (START_DATE && START_DATE.toString() !== "Invalid Date") {
      console.log(`   BUT still filtering videos by START_DATE: ${process.env.START_DATE}`);
      console.log("   This catches new videos in old playlists while avoiding ancient content\n");
    } else {
      console.log("   No date filter - will process ALL videos regardless of age\n");
    }
  } else if (START_DATE && START_DATE.toString() !== "Invalid Date") {
    console.log(`📅 Using START_DATE filter: ${process.env.START_DATE}`);
    console.log(`   Will skip videos published before this date`);
    console.log(`   Will stop after 50 consecutive old videos (optimization)\n`);
  } else {
    console.log(`📅 No date filter - processing all videos\n`);
  }
  
  if (MAX_VIDEOS) {
    console.log(`MAX_VIDEOS per channel: ${MAX_VIDEOS}`);
  }
  
  if (MAX_PLAYLISTS) {
    console.log(`MAX_PLAYLISTS per channel: ${MAX_PLAYLISTS}`);
  }
  
  console.log("");
  
  let globalStats = {
    totalChannels: channelsToScrape.length,
    channelsProcessed: 0,
    totalPlaylists: 0,
    totalVideos: 0
  };
  
  // Process each channel
  for (let cIdx = 0; cIdx < channelsToScrape.length; cIdx++) {
    const channel = channelsToScrape[cIdx];
    
    console.log("\n" + "=".repeat(80));
    console.log(`CHANNEL ${cIdx + 1}/${channelsToScrape.length}: ${channel.name}`);
    console.log("=".repeat(80) + "\n");
    
    // Resolve channel ID if needed
    let channelId = channel.id;
    
    if (!channelId) {
      // Try to resolve from input
      if (channel.input.startsWith('@')) {
        console.log(`Resolving handle: ${channel.input}`);
        channelId = await getChannelIdFromUrl(channel.input);
        
        if (!channelId) {
          console.error(`❌ Could not resolve channel handle: ${channel.input}`);
          console.log("Skipping this channel.\n");
          continue;
        }
        console.log(`✓ Resolved to channel ID: ${channelId}\n`);
      } else if (channel.input.startsWith('UC')) {
        // Assume it's already a channel ID
        channelId = channel.input;
      } else {
        console.error(`❌ Invalid channel format: ${channel.input}`);
        console.log("Skipping this channel.\n");
        continue;
      }
    }
    
    // Get channel info
    console.log(`Fetching channel info...`);
    const channelInfo = await getChannelInfo(channelId);
    
    if (!channelInfo) {
      console.error(`❌ Could not fetch channel information for: ${channelId}`);
      console.log("Skipping this channel.\n");
      continue;
    }
    
    console.log("\n" + "-".repeat(80));
    console.log("CHANNEL DETAILS");
    console.log("-".repeat(80));
    console.log(`Name: ${channelInfo.title}`);
    console.log(`ID: ${channelInfo.id}`);
    console.log(`Subscribers: ${parseInt(channelInfo.subscriberCount).toLocaleString()}`);
    console.log(`Total Videos: ${parseInt(channelInfo.videoCount).toLocaleString()}`);
    console.log(`Total Views: ${parseInt(channelInfo.viewCount).toLocaleString()}`);
    console.log("-".repeat(80) + "\n");
    
    // Fetch all playlists for this channel
    let playlists = await fetchAllPlaylists(channelId);
    
    if (playlists.length === 0) {
      console.log("⚠️ No playlists found on this channel.");
      console.log("Skipping to next channel.\n");
      globalStats.channelsProcessed++;
      continue;
    }
    
    // Sort by most recent first
    playlists.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    
    // Apply filters
    if (SKIP_PLAYLISTS > 0) {
      playlists = playlists.slice(SKIP_PLAYLISTS);
      console.log(`Skipping first ${SKIP_PLAYLISTS} playlists\n`);
    }
    
    if (MAX_PLAYLISTS) {
      playlists = playlists.slice(0, MAX_PLAYLISTS);
      console.log(`Limiting to ${MAX_PLAYLISTS} playlists\n`);
    }
    
    console.log(`Will process ${playlists.length} playlists from this channel:\n`);
    playlists.forEach((pl, idx) => {
      const publishDate = new Date(pl.publishedAt).toISOString().split('T')[0];
      console.log(`  ${idx + 1}. [${publishDate}] ${pl.title} (${pl.itemCount} videos)`);
    });
    console.log("");
    
    let channelVideosProcessed = 0;
    let totalConsecutiveOldVideos = 0; // Track across ALL playlists
    
    // Process each playlist
    for (let pIdx = 0; pIdx < playlists.length; pIdx++) {
      const playlist = playlists[pIdx];
      
      // Note: We check video dates, NOT playlist dates
      // Reason: Channels often add NEW videos to OLD playlists
      
      console.log("\n" + "-".repeat(80));
      console.log(`PLAYLIST ${pIdx + 1}/${playlists.length}: ${playlist.title}`);
      console.log(`Playlist ID: ${playlist.id}`);
      console.log(`Videos in playlist: ${playlist.itemCount}`);
      console.log("-".repeat(80) + "\n");
      
      const videos = await fetchPlaylistVideos(playlist.id);
      
      if (videos.length === 0) {
        console.log("No videos found in this playlist.\n");
        continue;
      }
      
      console.log(`Processing ${videos.length} videos from this playlist...\n`);
      
      let playlistVideosProcessed = 0;
      let playlistHadNewVideos = false; // Track if this playlist had any new videos
      
      for (const video of videos) {
        if (MAX_VIDEOS && channelVideosProcessed >= MAX_VIDEOS) {
          console.log(`\nReached MAX_VIDEOS limit (${MAX_VIDEOS}) for this channel. Moving to next channel.`);
          break;
        }
        
        // Date filter - always applied when START_DATE is set
        // FULL_SCRAPE only disables the early exit optimization
        if (START_DATE && START_DATE.toString() !== "Invalid Date") {
          const videoDate = new Date(video.publishedAt);
          if (!isNaN(videoDate) && videoDate < START_DATE) {
            console.log(`[${playlistVideosProcessed + 1}/${videos.length}] Skip (before START_DATE ${START_DATE.toISOString().split('T')[0]}): ${video.title.slice(0, 60)}...`);
            playlistVideosProcessed++;
            
            // Early exit optimization (disabled in FULL_SCRAPE mode)
            if (!FULL_SCRAPE) {
              totalConsecutiveOldVideos++;
              
              // OPTIMIZATION: If we've seen 50 old videos in a row across playlists, stop
              if (totalConsecutiveOldVideos >= 50) {
                console.log(`\n⏭️  Found 50 consecutive old videos across playlists. Likely no more new content. Stopping channel.\n`);
                break;
              }
            }
            continue;
          } else {
            totalConsecutiveOldVideos = 0; // Reset when we find a new video
            playlistHadNewVideos = true;
          }
        }
        
        console.log(`[${playlistVideosProcessed + 1}/${videos.length}] ${video.title.slice(0, 70)}...`);
        
        const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
        
        // Check for duplicate BEFORE fetching details (saves API quota)
        if (schema.isDuplicate(videoUrl, true)) {
          console.log(`  Skip (duplicate)\n`);
          playlistVideosProcessed++;
          continue;
        }
        
        console.log(`  Fetching full video details from API...`);
        const videoDetails = await fetchVideoDetails(video.videoId);
        
        if (!videoDetails) {
          console.log(`  ❌ Failed to fetch video details, skipping...\n`);
          playlistVideosProcessed++;
          continue;
        }
        
        console.log(`  Creating record...`);
        const record = videoToRecord(video, videoDetails, playlist.title, channelInfo);
        
        // DEBUG: Show what we're passing to schema.write()
        console.log(`    📦 Record to write:`);
        console.log(`       title: "${record.title.substring(0, 50)}..."`);
        console.log(`       summary length: ${record.summary.length} chars`);
        console.log(`       summary first 100: "${record.summary.substring(0, 100)}..."`);
        console.log(`       kind: ${record.kind}`);
        console.log(`       source: ${record.source}`);
        console.log(`       sourceType: ${record.sourceType}`);
        
        const result = schema.write(record);
        if (result.written) {
          channelVideosProcessed++;
          console.log(`  ✓ Written (${channelVideosProcessed} this channel)`);
          
          // DEBUG: Verify what was written
          if (result.record && result.record.summary) {
            console.log(`    ✓ Verified summary in written record: ${result.record.summary.length} chars`);
          } else {
            console.log(`    ⚠️ WARNING: No summary in written record!`);
          }
        }
        
        playlistVideosProcessed++;
        
        // Rate limiting - be nice to YouTube API
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
      console.log(`Playlist summary: ${playlistVideosProcessed} videos processed\n`);
      
      // If we hit the consecutive old videos limit (and not in FULL_SCRAPE), stop
      if (!FULL_SCRAPE && totalConsecutiveOldVideos >= 50) {
        console.log(`Stopping playlist processing due to consecutive old videos.\n`);
        break;
      }
      
      if (MAX_VIDEOS && channelVideosProcessed >= MAX_VIDEOS) {
        break; // Stop processing playlists for this channel
      }
    }
    
    console.log("\n" + "-".repeat(80));
    console.log(`CHANNEL SUMMARY: ${channelInfo.title}`);
    console.log("-".repeat(80));
    console.log(`Playlists processed: ${playlists.length}`);
    console.log(`Videos processed: ${channelVideosProcessed}`);
    console.log("-".repeat(80) + "\n");
    
    globalStats.channelsProcessed++;
    globalStats.totalPlaylists += playlists.length;
    globalStats.totalVideos += channelVideosProcessed;
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("FINAL SUMMARY - ALL CHANNELS");
  console.log("=".repeat(80));
  console.log(`Total channels processed: ${globalStats.channelsProcessed}/${globalStats.totalChannels}`);
  console.log(`Total playlists processed: ${globalStats.totalPlaylists}`);
  console.log(`Total videos processed: ${globalStats.totalVideos}`);
  console.log("=".repeat(80) + "\n");
  
  console.log("\n💾 Writing CSV and JSON files...");
  await schema.flush();
  
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
    await scrapePublicYouTube();
  } catch (err) {
    console.error("Fatal error in scrapePublicYouTube:", err);
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

export { scrapePublicYouTube };