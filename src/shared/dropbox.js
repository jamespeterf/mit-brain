// dropbox.js (ESM)
// Lazy-reads env at call time so it works even if dotenv loads after imports.
// Supports refresh-token flow and falls back to access token if provided.

const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const API_URL = "https://api.dropboxapi.com/2";
const CONTENT_URL = "https://content.dropboxapi.com/2";

let cachedAccessToken = null;
let cachedAccessTokenExpiryMs = 0; // epoch ms

function env(name, fallback = "") {
  return (process.env[name] || fallback).toString().trim();
}

function getDropboxConfig() {
  // Read at call-time (NOT module load time)
  const refreshToken = env("DROPBOX_REFRESH_TOKEN");
  const accessToken = env("DROPBOX_ACCESS_TOKEN");
  const appKey = env("DROPBOX_APP_KEY");
  const appSecret = env("DROPBOX_APP_SECRET");

  return { refreshToken, accessToken, appKey, appSecret };
}

function nowMs() {
  return Date.now();
}

function isTokenStillValid() {
  return cachedAccessToken && cachedAccessTokenExpiryMs && nowMs() < cachedAccessTokenExpiryMs - 30_000;
  // 30s safety buffer
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

async function refreshAccessToken() {
  const { refreshToken, appKey, appSecret } = getDropboxConfig();

  if (!refreshToken) {
    throw new Error("Missing DROPBOX_REFRESH_TOKEN (set it in .env)");
  }
  if (!appKey) {
    throw new Error("Missing DROPBOX_APP_KEY (set it in .env)");
  }
  // If your app is configured as PKCE-only/no secret, appSecret may be blank.
  // If you have it, we’ll use it. If not, Dropbox will still accept client_id-only for some app types.
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
    // Dropbox often returns JSON with error_summary
    const msg = json?.error_summary || json?.error_description || text || `HTTP ${res.status}`;
    throw new Error(`Dropbox token refresh failed (${res.status}): ${msg}`);
  }

  const token = json?.access_token;
  const expiresIn = Number(json?.expires_in || 14_400); // Dropbox typically returns 4 hours

  if (!token) {
    throw new Error("Dropbox token refresh succeeded but no access_token was returned");
  }

  cachedAccessToken = token;
  cachedAccessTokenExpiryMs = nowMs() + expiresIn * 1000;

  return cachedAccessToken;
}

async function getAccessToken() {
  const { accessToken, refreshToken } = getDropboxConfig();

  // Prefer refresh-token flow (so you stop getting expired_access_token)
  if (refreshToken) {
    if (isTokenStillValid()) return cachedAccessToken;
    return await refreshAccessToken();
  }

  // Fallback to static access token if user insists (will expire eventually)
  if (accessToken) return accessToken;

  throw new Error("Missing DROPBOX_REFRESH_TOKEN (set it in .env)");
}

async function dropboxApi(endpoint, payload) {
  const token = await getAccessToken();

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

async function dropboxContent(endpoint, args, { responseType = "text" } = {}) {
  const token = await getAccessToken();

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

export async function listTranscripts(folderPath = "/transcripts") {
  // files/list_folder requires files.metadata.read
  const data = await dropboxApi("/files/list_folder", {
    path: folderPath,
    recursive: false,
    include_deleted: false,
    include_mounted_folders: true,
    include_non_downloadable_files: false
  });

  // Normalize for your UI
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

export async function downloadTranscript(pathLower) {
  // files/download returns raw file bytes as text
  const content = await dropboxContent(
    "/files/download",
    { path: pathLower },
    { responseType: "text" }
  );

  // match what your route is likely expecting
  return { ok: true, path: pathLower, content };
}



// Optional: quick sanity check endpoint can call this
export function dropboxEnvStatus() {
  const { refreshToken, accessToken, appKey, appSecret } = getDropboxConfig();
  return {
    hasRefreshToken: !!refreshToken,
    hasAccessToken: !!accessToken,
    hasAppKey: !!appKey,
    hasAppSecret: !!appSecret,
  };
}
