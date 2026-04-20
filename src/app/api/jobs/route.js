// Free APIs: Remotive (remote jobs) + The Muse (Boston + remote)
// No API keys required. Paid plans not used.
//
// Design notes:
//   - The Muse's public `query` param is silently ignored upstream, so keyword
//     matching must happen here after the fetch.
//   - Remotive's `search` is strict phrase-match: "graphic design" → 0 while
//     "designer" → many. We fetch both strict and loose, then re-rank.
//   - We score every candidate with a title-weighted relevance function and
//     drop anything below MIN_SCORE. Fewer, accurate results beat a long list
//     of "Office Assistant" for a "graphic designer" search.

const MUSE_BASE     = "https://www.themuse.com/api/public/jobs";
const REMOTIVE_BASE = "https://remotive.com/api/remote-jobs";
const FETCH_OPTS    = { headers: { Accept: "application/json" }, next: { revalidate: 600 } };
const MAX_RESULTS   = 15;
const MIN_SCORE     = 5;     // below this, a candidate is considered irrelevant
const CANDIDATE_CAP = 60;    // cap work per source so we don't hammer upstreams

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query    = (searchParams.get("q") || "").trim();
  const location = (searchParams.get("location") || "Boston, MA").trim();
  const isRemote = /remote|flexible/i.test(location);

  const analyzed = analyze(query);

  const tasks = isRemote
    ? [remotiveFetch(query), museFetch("remote")]
    : [museFetch("boston")];

  const settled = await Promise.allSettled(tasks);
  const candidates = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && Array.isArray(s.value)) candidates.push(...s.value);
  }

  // Dedupe first (same id could come from both sources, or across fallback terms)
  const byId = new Map();
  for (const job of candidates) {
    if (!byId.has(job.id)) byId.set(job.id, job);
  }

  const scored = [];
  for (const job of byId.values()) {
    const score = scoreJob(job, analyzed);
    if (score >= MIN_SCORE || !analyzed.tokens.length) {
      scored.push({ job, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const jobs = scored.slice(0, MAX_RESULTS).map(x => x.job);
  return Response.json({ jobs, total: jobs.length });
}

// ─── FETCH: REMOTIVE ─────────────────────────────────────────────────────────

async function remotiveFetch(query) {
  // Pull with strict phrase AND with the most distinctive single token.
  // The scorer drops loose matches later, so casting a slightly wider net is fine.
  const q = query.trim();
  const terms = new Set();
  if (q) terms.add(q);
  const distinctive = mostDistinctiveToken(q);
  if (distinctive && distinctive !== q) terms.add(distinctive);
  if (terms.size === 0) terms.add(""); // no query: get recent jobs

  const urls = [...terms].map(t =>
    `${REMOTIVE_BASE}?${t ? `search=${encodeURIComponent(t)}&` : ""}limit=${MAX_RESULTS * 2}`
  );
  const pages = await Promise.allSettled(urls.map(safeFetchJson));

  const seen = new Set();
  const out  = [];
  for (const p of pages) {
    const data = p.status === "fulfilled" ? p.value : null;
    for (const job of data?.jobs || []) {
      const id = `rem-${job.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(shapeRemotive(job, id));
      if (out.length >= CANDIDATE_CAP) return out;
    }
  }
  return out;
}

function shapeRemotive(job, id) {
  return {
    id,
    title:       job.title || "Job",
    company:     job.company_name || "Company",
    location:    job.candidate_required_location || "Remote",
    description: stripHtml(job.description || "").slice(0, 350),
    salary:      job.salary || null,
    posted:      formatDate(job.publication_date),
    url:         job.url,
    remote:      true,
    type:        job.job_type || "Full-time",
    category:    job.category || "",
  };
}

// ─── FETCH: THE MUSE ─────────────────────────────────────────────────────────

async function museFetch(mode) {
  const params = new URLSearchParams();
  if (mode === "boston") {
    params.append("location", "Boston, MA, US");
    params.append("location", "Boston, MA");
  } else {
    params.append("location", "Flexible / Remote");
  }
  params.append("level", "Entry Level");
  params.append("level", "Mid Level");

  const pageUrls = [1, 2, 3].map(p => `${MUSE_BASE}?${params}&page=${p}`);
  const pages    = await Promise.allSettled(pageUrls.map(safeFetchJson));

  const out = [];
  for (const p of pages) {
    const data = p.status === "fulfilled" ? p.value : null;
    for (const job of data?.results || []) {
      out.push(shapeMuse(job, `muse-${job.id}`));
      if (out.length >= CANDIDATE_CAP) return out;
    }
  }
  return out;
}

function shapeMuse(job, id) {
  const locations = (job.locations || []).map(l => l.name);
  const remote    = locations.some(n => /remote|flexible/i.test(n));
  return {
    id,
    title:       job.name || "Job",
    company:     job.company?.name || "Company",
    location:    locations.join(" / ") || "See listing",
    description: stripHtml(job.contents || "").slice(0, 350),
    salary:      null,
    posted:      formatDate(job.publication_date),
    url:         job.refs?.landing_page || `https://www.themuse.com/jobs/${job.id}`,
    remote,
    type:        "See listing",
    category:    (job.categories || []).map(c => c.name).join(", "),
  };
}

// ─── RELEVANCE SCORING ───────────────────────────────────────────────────────
//
// Points:
//   +15  exact phrase in title (only for multi-word queries)
//   +10  every token has a stem-match in title (AND)
//   + 5  any stem-match in title (per stem)
//   + 3  any stem-match in category (per stem)
//   + 2  every token has a stem-match in description (AND)
// MIN_SCORE=5 means we require at least one solid title hit OR a phrase match.

function scoreJob(job, a) {
  if (!a.tokens.length) return 1;

  const title = (job.title || "").toLowerCase();
  const category = (job.category || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();

  let score = 0;

  if (a.phrase.includes(" ") && title.includes(a.phrase)) score += 15;

  if (a.tokens.every(t => stemHit(title, t))) score += 10;

  for (const s of a.stems) {
    if (title.includes(s)) score += 5;
  }
  for (const s of a.stems) {
    if (category.includes(s)) score += 3;
  }
  if (a.tokens.every(t => stemHit(desc, t))) score += 2;

  return score;
}

// ─── QUERY ANALYSIS ──────────────────────────────────────────────────────────

function analyze(query) {
  const stop = new Set(["and", "the", "for", "with", "job", "jobs", "part", "time"]);
  const phrase = query.toLowerCase().trim();
  const tokens = phrase
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !stop.has(t));

  const stems = new Set();
  for (const t of tokens) {
    for (const v of stemVariants(t)) stems.add(v);
  }
  return { phrase, tokens, stems: [...stems] };
}

function stemVariants(term) {
  const out = [term];
  if (term.endsWith("ing") && term.length > 5) out.push(term.slice(0, -3)); // teaching → teach
  if (term.endsWith("ers") && term.length > 4) out.push(term.slice(0, -3)); // designers → design
  if (term.endsWith("er")  && term.length > 4) out.push(term.slice(0, -2)); // designer → design
  if (term.endsWith("s")   && term.length > 3) out.push(term.slice(0, -1)); // bakers → baker
  if (term.endsWith("ed")  && term.length > 4) out.push(term.slice(0, -2)); // baked → bak
  return out;
}

function stemHit(text, term) {
  return stemVariants(term).some(v => text.includes(v));
}

function mostDistinctiveToken(query) {
  const stop = new Set(["and", "the", "for", "with", "job", "jobs", "part", "time", "remote", "entry"]);
  const toks = query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !stop.has(t));
  if (!toks.length) return "";
  // Prefer the longest token (tends to be the most content-bearing word).
  return toks.sort((a, b) => b.length - a.length)[0];
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function safeFetchJson(url) {
  try {
    const r = await fetch(url, FETCH_OPTS);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function formatDate(dateStr) {
  if (!dateStr) return "Recently";
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7)   return `${diff} days ago`;
  if (diff < 30)  return `${Math.floor(diff / 7)} week${Math.floor(diff / 7) > 1 ? "s" : ""} ago`;
  return `${Math.floor(diff / 30)} month${Math.floor(diff / 30) > 1 ? "s" : ""} ago`;
}
