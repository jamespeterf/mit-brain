# Webapp Hot Reload Integration

## Overview

After scheduled scraping/enrichment, the webapp needs to reload the brain data to show new content. This is done via a hot reload API endpoint - **no server restart required**.

## How It Works

```
Scheduled Scraper
      ↓
Scrapes new data
      ↓
Enriches records
      ↓
Calls: POST /api/reload
      ↓
Webapp reloads brain
      ↓
New content visible
```

## Setup

### Step 1: Add Endpoints to server.js

Add these endpoints to your `server.js` (place with other API endpoints):

```javascript
// ============================================================
// Hot Reload & Status Endpoints
// ============================================================

// Track server start time
const serverStartTime = new Date().toISOString();

/**
 * POST /api/reload
 * Reloads the brain data without restarting the server
 */
app.post("/api/reload", async (req, res) => {
  try {
    console.log("\n🔄 Hot reload triggered...");
    
    const oldCount = articles.length;
    const oldKinds = { ...articlesByKind };
    
    // Reload articles from JSONL
    await loadArticles();
    
    const newCount = articles.length;
    const addedCount = newCount - oldCount;
    
    console.log(`✅ Reload complete:`);
    console.log(`   Old count: ${oldCount}`);
    console.log(`   New count: ${newCount}`);
    console.log(`   Added: ${addedCount}`);
    console.log(`   Updated kinds:`, articlesByKind);
    
    res.json({
      success: true,
      oldCount,
      newCount,
      addedCount,
      kinds: articlesByKind,
      message: `Reloaded ${newCount} articles (${addedCount} new)`
    });
    
  } catch (error) {
    console.error("❌ Reload failed:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/status
 * Returns current brain status (for monitoring)
 */
app.get("/api/status", (req, res) => {
  res.json({
    brainFile: JSONL_FILENAME,
    articleCount: articles.length,
    kinds: articlesByKind,
    loadedAt: serverStartTime,
    uptime: Math.floor(process.uptime())
  });
});
```

### Step 2: Update loadArticles Function

Make sure `loadArticles()` is defined at the top level so it can be called from the reload endpoint:

```javascript
// Move loadArticles to top-level scope (if it's not already)
async function loadArticles() {
  try {
    console.log(`📊 Loading data from: ${JSONL_FILENAME}`);
    const content = await fs.readFile(jsonlPath, "utf8");
    
    articles = content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    
    console.log(`✅ Loaded ${articles.length} articles`);
    
    // Group by kind
    articlesByKind = {};
    articles.forEach((a) => {
      const k = a.kind || "unknown";
      articlesByKind[k] = (articlesByKind[k] || 0) + 1;
    });
    
    console.log("📊 Loaded articles by kind:", articlesByKind);
    
  } catch (err) {
    console.error(`❌ Error loading ${JSONL_FILENAME}:`, err.message);
    articles = [];
    articlesByKind = {};
  }
}

// Call at startup
await loadArticles();
```

## Testing the Reload

### Manual Test

```bash
# 1. Start webapp
cd src/webapp/
./startServer.sh

# 2. Check current status
curl http://localhost:3000/api/status | jq

# 3. Trigger reload
curl -X POST http://localhost:3000/api/reload | jq

# 4. Verify new count
curl http://localhost:3000/api/status | jq
```

### Expected Response

**Status (GET /api/status):**
```json
{
  "brainFile": "mit_brain_test17.jsonl",
  "articleCount": 9247,
  "kinds": {
    "video": 2134,
    "article": 5432,
    "paper": 1234,
    "startup": 234,
    "event": 123,
    "mit_person": 90
  },
  "loadedAt": "2024-12-20T13:00:00.000Z",
  "uptime": 3600
}
```

**Reload (POST /api/reload):**
```json
{
  "success": true,
  "oldCount": 9247,
  "newCount": 9294,
  "addedCount": 47,
  "kinds": {
    "video": 2140,
    "article": 5465,
    "paper": 1242,
    "startup": 234,
    "event": 123,
    "mit_person": 90
  },
  "message": "Reloaded 9294 articles (47 new)"
}
```

## Integration with Scheduled Scraper

The `runScheduled.sh` script automatically calls the reload endpoint:

```bash
# Check if webapp is running
if curl -s "${WEBAPP_URL}/api/status" > /dev/null 2>&1; then
    echo "Webapp detected at ${WEBAPP_URL}"
    echo "Triggering hot reload..."
    
    RELOAD_RESPONSE=$(curl -s -X POST "${WEBAPP_URL}/api/reload")
    
    if echo "$RELOAD_RESPONSE" | grep -q '"success":true'; then
        echo "✅ Webapp reloaded successfully"
    fi
fi
```

## Configuration

### Default Webapp URL

In `runScheduled.sh`:

```bash
# Default: localhost
WEBAPP_URL=${WEBAPP_URL:-"http://localhost:3000"}
```

### Custom URL

```bash
# If webapp runs on different port or host
WEBAPP_URL="http://localhost:8080" ./runScheduled.sh

# Or set in cron:
WEBAPP_URL=http://localhost:8080
0 8 * * * cd /path/to/src && ./runScheduled.sh
```

## Monitoring

### Add Reload Button to UI (Optional)

Add to `index.html`:

```html
<!-- In your UI somewhere -->
<button id="reloadBrain" class="btn btn-secondary">
  🔄 Reload Brain Data
</button>
```

Add to `app.js`:

```javascript
document.getElementById('reloadBrain').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/reload', { method: 'POST' });
    const result = await response.json();
    
    if (result.success) {
      alert(`Reloaded! Added ${result.addedCount} new articles`);
      // Optionally refresh the page or re-render
      location.reload();
    } else {
      alert('Reload failed: ' + result.error);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
});
```

### Check Status from Browser

Add status display:

```html
<div id="brainStatus"></div>
```

```javascript
async function updateStatus() {
  const response = await fetch('/api/status');
  const status = await response.json();
  
  document.getElementById('brainStatus').innerHTML = `
    <small>
      Brain: ${status.brainFile} | 
      Articles: ${status.articleCount.toLocaleString()} | 
      Loaded: ${new Date(status.loadedAt).toLocaleTimeString()} |
      Uptime: ${Math.floor(status.uptime / 60)}m
    </small>
  `;
}

// Update on load
updateStatus();

// Update every 5 minutes
setInterval(updateStatus, 5 * 60 * 1000);
```

## Logs

### Server Console

When reload is triggered:

```
🔄 Hot reload triggered...
✅ Reload complete:
   Old count: 9247
   New count: 9294
   Added: 47
   Updated kinds: { video: 2140, article: 5465, ... }
```

### Scheduled Script Log

```
[2024-12-20 08:15:32] ============================================================
[2024-12-20 08:15:32] Step 6: Reload Webapp
[2024-12-20 08:15:32] ============================================================
[2024-12-20 08:15:32] Webapp detected at http://localhost:3000
[2024-12-20 08:15:32] Triggering hot reload...
[2024-12-20 08:15:33] ✅ Webapp reloaded successfully
[2024-12-20 08:15:33]    New count: 9294
[2024-12-20 08:15:33]    Added: 47
```

## Troubleshooting

### Reload endpoint not working

**Check server.js:**
```bash
# Make sure endpoints are added
grep -A 5 "POST.*reload" src/webapp/server.js
grep -A 5 "GET.*status" src/webapp/server.js
```

**Test directly:**
```bash
curl -v http://localhost:3000/api/reload
```

### Webapp not detected

**Check if running:**
```bash
lsof -ti:3000
# Should return a process ID

# Or test status endpoint
curl http://localhost:3000/api/status
```

**Check URL:**
```bash
# In runScheduled.sh, verify:
WEBAPP_URL="http://localhost:3000"  # Correct port?
```

### Reload succeeds but UI doesn't update

**Option 1: Refresh browser**
- Browser has cached data
- Users need to refresh (F5)

**Option 2: Auto-refresh UI**

Add to `app.js`:

```javascript
// Poll for updates every minute
setInterval(async () => {
  const response = await fetch('/api/status');
  const status = await response.json();
  
  // Check if count changed
  if (status.articleCount !== currentArticleCount) {
    // Show notification
    showNotification(`${status.articleCount - currentArticleCount} new articles available!`);
    // Or auto-refresh
    location.reload();
  }
}, 60 * 1000);
```

## Production Considerations

### Rate Limiting

Protect the reload endpoint:

```javascript
// Simple rate limit
let lastReload = 0;
const RELOAD_COOLDOWN = 60000; // 1 minute

app.post("/api/reload", async (req, res) => {
  const now = Date.now();
  if (now - lastReload < RELOAD_COOLDOWN) {
    return res.status(429).json({
      success: false,
      error: "Please wait before reloading again",
      retryAfter: Math.ceil((RELOAD_COOLDOWN - (now - lastReload)) / 1000)
    });
  }
  
  lastReload = now;
  // ... rest of reload logic
});
```

### Authentication

Add auth to prevent unauthorized reloads:

```javascript
app.post("/api/reload", (req, res) => {
  const token = req.headers['x-reload-token'];
  
  if (token !== process.env.RELOAD_TOKEN) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized"
    });
  }
  
  // ... rest of reload logic
});
```

Then in `runScheduled.sh`:

```bash
curl -X POST "${WEBAPP_URL}/api/reload" \
     -H "X-Reload-Token: ${RELOAD_TOKEN}"
```

## Summary

✅ **Hot reload** - No server restart needed  
✅ **Automatic** - Triggered by scheduled script  
✅ **Monitored** - Status endpoint for health checks  
✅ **Logged** - All reloads tracked in logs  
✅ **Optional UI** - Add reload button if needed  

**Your webapp now stays updated automatically!** 🔄
