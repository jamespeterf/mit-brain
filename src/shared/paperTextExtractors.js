// shared/paperTextExtractors.js

const axios = require("axios");
const cheerio = require("cheerio");
const querystring = require("querystring");

// ---- Basic logger helper ----
function defaultLog(msg) {
  console.log(msg);
}

// ---- Fetch binary helper (PDF or HTML) ----
async function fetchBinary(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    maxRedirects: 5,
    headers: {
      "User-Agent": "mit-brain-bot/1.0 (mailto:you@example.com)",
      Accept:
        "application/pdf, text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    // You can loosen TLS if needed, but better to fix certs
    // httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  });

  const contentType = res.headers["content-type"] || "";
  return { data: Buffer.from(res.data), contentType };
}

// ---- DOI extraction ----
function extractDoiFromRecord(record) {
  if (record.doi) return record.doi.trim();

  const url = record.pdfUrl || record.url || "";
  if (!url) return null;

  // Simple doi.org pattern
  const m = url.match(/doi\.org\/(10\.\d{4,9}\/\S+)/i);
  if (m) {
    return m[1].replace(/[)\].,;]+$/, "");
  }
  return null;
}

// ---- Crossref fallback ----
async function fetchAbstractFromCrossref(doi, log = defaultLog) {
  if (!doi) return "";

  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;

  try {
    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "mit-brain-bot/1.0 (mailto:you@example.com)",
      },
    });

    const msg = res.data && res.data.message;
    if (!msg || !msg.abstract) return "";

    const raw = msg.abstract;

    const cleaned = raw
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return cleaned;
  } catch (err) {
    log(`  ⚠️ Crossref failed: ${err.message}`);
    return "";
  }
}

// ---- Semantic Scholar fallback ----
async function fetchAbstractFromSemanticScholar({ doi, title }, log = defaultLog) {
  try {
    // Prefer DOI
    if (doi) {
      const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(
        doi
      )}?fields=title,abstract`;
      const res = await axios.get(url, { timeout: 10000 });
      const paper = res.data;
      if (paper && paper.abstract) {
        return paper.abstract.replace(/\s+/g, " ").trim();
      }
    }

    // Fallback: search by title
    if (title) {
      const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
        title
      )}&fields=title,abstract&limit=1`;
      const res = await axios.get(url, { timeout: 10000 });
      const papers = res.data && res.data.data;
      if (Array.isArray(papers) && papers.length > 0) {
        const best = papers[0];
        if (best.abstract) {
          return best.abstract.replace(/\s+/g, " ").trim();
        }
      }
    }

    return "";
  } catch (err) {
    log(`  ⚠️ Semantic Scholar failed: ${err.message}`);
    return "";
  }
}

// ---- PubMed fallback ----
async function fetchAbstractFromPubMed({ doi, title }, log = defaultLog) {
  try {
    const term = doi || title;
    if (!term) return "";

    const searchParams = {
      db: "pubmed",
      retmode: "json",
      term,
    };

    const searchUrl =
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" +
      querystring.stringify(searchParams);

    const searchRes = await axios.get(searchUrl, { timeout: 10000 });
    const idList =
      searchRes.data &&
      searchRes.data.esearchresult &&
      searchRes.data.esearchresult.idlist;

    if (!Array.isArray(idList) || idList.length === 0) return "";

    const pmid = idList[0];

    const fetchParams = {
      db: "pubmed",
      id: pmid,
      retmode: "xml",
    };

    const fetchUrl =
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?" +
      querystring.stringify(fetchParams);

    const fetchRes = await axios.get(fetchUrl, { timeout: 10000 });
    const xml = fetchRes.data;

    const matches = [
      ...xml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi),
    ];
    if (!matches.length) return "";

    const abstract = matches
      .map((m) =>
        m[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean)
      .join(" ");

    return abstract;
  } catch (err) {
    log(`  ⚠️ PubMed failed: ${err.message}`);
    return "";
  }
}

// ---- Main text extraction pipeline ----
// pdfParseFn: async (buffer) => { text: "..." }  OR returns { text } like pdf-parse
async function extractTextFromRecord(
  record,
  {
    pdfParseFn, // required if you want PDF support
    logFn = defaultLog,
  } = {}
) {
  const log = logFn;
  const targetUrl = record.pdfUrl || record.url;
  if (!targetUrl) return "";

  log(`  Fetching: ${targetUrl}`);

  let text = "";

  // 1) Try direct fetch + PDF/HTML parsing
  try {
    const { data, contentType } = await fetchBinary(targetUrl);
    const lower = (contentType || "").toLowerCase();

    if (lower.includes("pdf")) {
      if (!pdfParseFn) {
        log("  ⚠️ No pdfParseFn provided; skipping PDF parsing.");
      } else {
        const pdfData = await pdfParseFn(data);
        const pdfText = pdfData.text || pdfData || "";
        text = String(pdfText).replace(/\s+/g, " ").trim();
      }
    } else {
      const html = data.toString("utf8");
      const $ = cheerio.load(html);

      if ($("article").length) {
        text = $("article").text();
      } else if ($("#main").length) {
        text = $("#main").text();
      } else {
        text = $("p").text();
      }

      text = text.replace(/\s+/g, " ").trim();
    }
  } catch (err) {
    log(`  ⚠️ Failed to fetch/parse content: ${err.message}`);
  }

  if (text) return text;

  // 2) API fallbacks
  const doi = extractDoiFromRecord(record);
  const title = record.title || record.paperTitle || "";

  log("  ⚠️ No extractable text from source; trying API fallbacks…");

  // 2a) Crossref
  const crossref = await fetchAbstractFromCrossref(doi, log);
  if (crossref) {
    log("  ✅ Used Crossref abstract");
    return crossref;
  }

  // 2b) Semantic Scholar
  const s2 = await fetchAbstractFromSemanticScholar({ doi, title }, log);
  if (s2) {
    log("  ✅ Used Semantic Scholar abstract");
    return s2;
  }

  // 2c) PubMed
  const pubmed = await fetchAbstractFromPubMed({ doi, title }, log);
  if (pubmed) {
    log("  ✅ Used PubMed abstract");
    return pubmed;
  }

  log("  ⚠️ No text available from any source; leaving empty.");
  return "";
}

module.exports = {
  extractTextFromRecord,
  extractDoiFromRecord,
  fetchAbstractFromCrossref,
  fetchAbstractFromSemanticScholar,
  fetchAbstractFromPubMed,
};
