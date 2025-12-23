// src/webapp/routes/transcripts.routes.js
import express from "express";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { listTranscripts, downloadTranscript } from "../../shared/dropbox.js";

function repoRootFromWebappDir(webappDir) {
  // src/webapp -> repo root
  return path.join(webappDir, "../..");
}

function safeIdFromDropboxPath(p) {
  return crypto.createHash("sha1").update(p || "").digest("hex").slice(0, 16);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

export default function transcriptsRouter({ openai, webappDir }) {
  const router = express.Router();

  const repoRoot = repoRootFromWebappDir(webappDir);
  const dataRoot = path.join(repoRoot, "data", "transcripts");

  router.get("/list", async (req, res) => {
    try {
      const items = await listTranscripts();
      res.json({ ok: true, items });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  router.get("/get", async (req, res) => {
    try {
      const { path: dropboxPath } = req.query;
      if (!dropboxPath) return res.status(400).json({ ok: false, error: "Missing path" });

      const text = await downloadTranscript(dropboxPath);
      res.json({ ok: true, text });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Save/Update Meeting Case (metadata + optional raw/clean + optional current summary bundle)
  router.post("/case/save", async (req, res) => {
    try {
      const payload = req.body || {};
      const source = payload.source || {};
      const dropboxPath = source.dropbox_path;

      if (!dropboxPath) {
        return res.status(400).json({ ok: false, error: "Missing source.dropbox_path" });
      }

      const caseId = safeIdFromDropboxPath(dropboxPath);
      const caseDir = path.join(dataRoot, caseId);
      await ensureDir(caseDir);

      // Write raw/clean if provided
      if (typeof payload.raw_text === "string") {
        await fs.writeFile(path.join(caseDir, "raw.txt"), payload.raw_text, "utf8");
      }
      if (typeof payload.clean_text === "string") {
        await fs.writeFile(path.join(caseDir, "clean.txt"), payload.clean_text, "utf8");
      }

      // Merge with existing case.json if present
      const casePath = path.join(caseDir, "case.json");
      let existing = {};
      try {
        existing = JSON.parse(await fs.readFile(casePath, "utf8"));
      } catch {}

      const now = new Date().toISOString();

      const merged = {
        ...existing,
        case_id: caseId,
        source: {
          ...(existing.source || {}),
          ...source,
          dropbox_path: dropboxPath
        },
        company: payload.company ?? existing.company ?? "",
        meeting_type: payload.meeting_type ?? existing.meeting_type ?? "",
        goal: payload.goal ?? existing.goal ?? "",
        stage: payload.stage ?? existing.stage ?? "",
        desired_outcome: payload.desired_outcome ?? existing.desired_outcome ?? "",
        signals: payload.signals ?? existing.signals ?? [],
        objections: payload.objections ?? existing.objections ?? [],
        people: payload.people ?? existing.people ?? { speaker_map: {} },

        // Optional: allow saving the latest generated output bundle here too
        summary_bullets: payload.summary_bullets ?? existing.summary_bullets ?? [],
        action_items: payload.action_items ?? existing.action_items ?? [],
        decisions: payload.decisions ?? existing.decisions ?? [],
        risks_blockers: payload.risks_blockers ?? existing.risks_blockers ?? [],
        email: payload.email ?? existing.email ?? { subject: "", body_markdown: "" },

        updated_at: now
      };

      await fs.writeFile(casePath, JSON.stringify(merged, null, 2), "utf8");
      res.json({ ok: true, case_id: caseId });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Append-only PD recommendations (JSONL)
  router.post("/recommendation/save", async (req, res) => {
    try {
      const payload = req.body || {};
      const caseId = payload.case_id;
      if (!caseId) return res.status(400).json({ ok: false, error: "Missing case_id" });

      const caseDir = path.join(dataRoot, caseId);
      await ensureDir(caseDir);

      const rec = {
        case_id: caseId,
        pd: payload.pd || "Unknown",
        insights: payload.insights || [],
        recommended_moves: payload.recommended_moves || [],
        email_angle: payload.email_angle || "",
        confidence: payload.confidence || "med",
        created_at: new Date().toISOString()
      };

      const recPath = path.join(caseDir, "recommendations.jsonl");
      await fs.appendFile(recPath, JSON.stringify(rec) + "\n", "utf8");

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Generate summary + action items + email draft (returns both raw + parsed)
  router.post("/summarize", async (req, res) => {
    try {
      const { text, context } = req.body || {};
      if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

      const goal = context?.goal ? `Goal: ${context.goal}` : "";
      const stage = context?.stage ? `Stage: ${context.stage}` : "";
      const desired = context?.desired_outcome ? `Desired outcome: ${context.desired_outcome}` : "";
      const company = context?.company ? `Company: ${context.company}` : "";

      const prompt = `
You are summarizing an ILP-related meeting transcript for internal use by an MIT ILP Program Director.

${company}
${goal}
${stage}
${desired}

Return STRICT JSON ONLY with this exact shape:
{
  "summary_bullets": string[],
  "decisions": string[],
  "action_items": [{"owner": string, "items": string[]}],
  "risks_blockers": string[],
  "signals": string[],
  "objections": string[],
  "email": { "subject": string, "body_markdown": string }
}

Guidelines:
- Use concise bullets.
- Action items should be grouped by owner and phrased as concrete tasks.
- Do not invent attendees or facts not supported by the transcript.
- Keep email tone professional and crisp.

Transcript:
${text}
`.trim();

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      });

      const raw = completion.choices?.[0]?.message?.content || "";
      const parsed = tryParseJson(raw);

      res.json({ ok: true, raw, parsed_ok: parsed.ok, parsed: parsed.value });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  return router;
}
