// src/shared/dropbox.js
import { Dropbox } from "dropbox";
import fetch from "node-fetch";

const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const DROPBOX_TRANSCRIPTS_DIR = process.env.DROPBOX_TRANSCRIPTS_DIR || "/Transcripts";

function getClient() {
  if (!DROPBOX_ACCESS_TOKEN) {
    throw new Error("Missing DROPBOX_ACCESS_TOKEN (set it in .env)");
  }
  return new Dropbox({ accessToken: DROPBOX_ACCESS_TOKEN, fetch });
}

export async function listTranscripts() {
  const dbx = getClient();
  const res = await dbx.filesListFolder({ path: DROPBOX_TRANSCRIPTS_DIR });

  return (res.result.entries || [])
    .filter((e) => e[".tag"] === "file")
    .map((e) => ({
      name: e.name,
      path: e.path_lower,
      size: e.size,
      modified: e.server_modified,
      content_hash: e.content_hash || null
    }))
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

export async function downloadTranscript(path) {
  const dbx = getClient();
  const res = await dbx.filesDownload({ path });

  const data = res.result.fileBinary || res.result.fileBlob;

  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (typeof data === "string") return data;

  if (data?.arrayBuffer) {
    const ab = await data.arrayBuffer();
    return Buffer.from(ab).toString("utf8");
  }

  return String(data || "");
}
