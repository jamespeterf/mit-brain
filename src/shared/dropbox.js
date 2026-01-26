// dropbox.js (ESM)
// Supports per-user config or falls back to env vars.
// Supports refresh-token flow and falls back to access token if provided.

const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const API_URL = "https://api.dropboxapi.com/2";
const CONTENT_URL = "https://content.dropboxapi.com/2";

// Per-user token cache: key = refreshToken, value = { token, expiryMs }
const tokenCache = new Map();

function env(name, fallback = "") {
  return (process.env[name] || fallback).toString().trim();
}

function getDropboxConfig(userConfig = null) {
  // If user config is provided, use it; otherwise read from env
  if (userConfig) {
    return {
      refreshToken: userConfig.refreshToken || '',
      accessToken: userConfig.accessToken || '',
      appKey: userConfig.appKey || '',
      appSecret: userConfig.appSecret || '',
      transcriptsDir: userConfig.transcriptsDir || '/Transcripts'
    };
  }

  // Read at call-time (NOT module load time)
  const refreshToken = env("DROPBOX_REFRESH_TOKEN");
  const accessToken = env("DROPBOX_ACCESS_TOKEN");
  const appKey = env("DROPBOX_APP_KEY");
  const appSecret = env("DROPBOX_APP_SECRET");

  return { refreshToken, accessToken, appKey, appSecret, transcriptsDir: env("DROPBOX_TRANSCRIPTS_DIR", "/Transcripts") };
}

function nowMs() {
  return Date.now();
}

function isTokenStillValid(cacheKey) {
  const cached = tokenCache.get(cacheKey);
  return cached && cached.token && cached.expiryMs && nowMs() < cached.expiryMs - 30_000;
}

async function fetchJson(url, { method = "POST", headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // keep json null
  }
  return { res, text, json };
}

async function refreshAccessToken(config) {
  const { refreshToken, appKey, appSecret } = config;

  if (!refreshToken) {
    throw new Error("Missing Dropbox Refresh Token. Configure it in Settings.");
  }
  if (!appKey) {
    throw new Error("Missing Dropbox App Key. Configure it in Settings.");
  }

  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", refreshToken);
  params.set("client_id", appKey);
  if (appSecret) params.set("client_secret", appSecret);

  const { res, text, json } = await fetchJson(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  if (!res.ok) {
    const msg = json?.error_summary || json?.error_description || text || `HTTP ${res.status}`;
    throw new Error(`Dropbox token refresh failed (${res.status}): ${msg}`);
  }

  const token = json?.access_token;
  const expiresIn = Number(json?.expires_in || 14_400);

  if (!token) {
    throw new Error("Dropbox token refresh succeeded but no access_token was returned");
  }

  const cacheKey = refreshToken;
  tokenCache.set(cacheKey, { token, expiryMs: nowMs() + expiresIn * 1000 });

  return token;
}

async function getAccessToken(userConfig = null) {
  const config = getDropboxConfig(userConfig);
  const { accessToken, refreshToken } = config;

  // Prefer refresh-token flow
  if (refreshToken) {
    if (isTokenStillValid(refreshToken)) {
      return tokenCache.get(refreshToken).token;
    }
    return await refreshAccessToken(config);
  }

  // Fallback to static access token
  if (accessToken) return accessToken;

  throw new Error("Missing Dropbox Refresh Token. Configure it in Settings.");
}

async function dropboxApi(endpoint, payload, userConfig = null) {
  const token = await getAccessToken(userConfig);

  const { res, text, json } = await fetchJson(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload ?? {})
  });

  if (!res.ok) {
    const msg = json?.error_summary || text || `HTTP ${res.status}`;
    throw new Error(`Dropbox API ${endpoint} failed (${res.status}): ${msg}`);
  }

  return json;
}

async function dropboxContent(endpoint, args, { responseType = "text" } = {}, userConfig = null) {
  const token = await getAccessToken(userConfig);

  const res = await fetch(`${CONTENT_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify(args || {}),
    }
  });

  if (!res.ok) {
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const msg = json?.error_summary || text || `HTTP ${res.status}`;
    throw new Error(`Dropbox Content API ${endpoint} failed (${res.status}): ${msg}`);
  }

  if (responseType === "arrayBuffer") return await res.arrayBuffer();
  if (responseType === "json") return await res.json();
  return await res.text();
}

// ==========================
// Public helpers you likely use
// ==========================

export async function listTranscripts(folderPath = "/transcripts", userConfig = null) {
  const data = await dropboxApi("/files/list_folder", {
    path: folderPath,
    recursive: false,
    include_deleted: false,
    include_mounted_folders: true,
    include_non_downloadable_files: false
  }, userConfig);

  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const items = entries
    .filter((e) => e[".tag"] === "file")
    .map((e) => ({
      name: e.name,
      path: e.path_lower || e.path_display,
      size: e.size || 0,
      modified: e.server_modified || e.client_modified || null,
      content_hash: e.content_hash || null
    }))
    .sort((a, b) => (b.modified || "").localeCompare(a.modified || ""));

  return { ok: true, items };
}

export async function downloadTranscript(pathLower, userConfig = null) {
  const content = await dropboxContent(
    "/files/download",
    { path: pathLower },
    { responseType: "text" },
    userConfig
  );

  return { ok: true, path: pathLower, content };
}

// Quick sanity check
export function dropboxEnvStatus(userConfig = null) {
  const config = getDropboxConfig(userConfig);
  return {
    hasRefreshToken: !!config.refreshToken,
    hasAccessToken: !!config.accessToken,
    hasAppKey: !!config.appKey,
    hasAppSecret: !!config.appSecret,
  };
}
