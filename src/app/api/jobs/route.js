// Free APIs: Remotive (remote jobs) + The Muse (Boston + remote)
// No API keys required. Paid plans not used.
//
// Why this route exists in its current shape:
//   - The Muse's public `query` param is silently ignored by the upstream API
//     (totals stay identical regardless of keywords), so keyword matching for
//     Muse has to happen client-side after the fetch.
//   - Remotive's `search` is strict phrase-match: "graphic design" returns 0
//     while "designer" returns many. We fall back to a narrower term when the
//     full phrase is empty.

const MUSE_BASE     = "https://www.themuse.com/api/public/jobs";
const REMOTIVE_BASE = "https://remotive.com/api/remote-jobs";
const FETCH_OPTS    = { headers: { Accept: "application/json" }, next: { revalidate: 600 } };
const MAX_RESULTS   = 15;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query    = (searchParams.get("q") || "").trim();
  const location = (searchParams.get("location") || "Boston, MA").trim();

  const isRemote = /remote|flexible/i.test(location);

  const tasks = isRemote
    ? [remotiveSearch(query), museSearch(query, "remote")]
    : [museSearch(query, "boston")];

  const settled = await Promise.allSettled(tasks);
  const buckets = settled.map(s => (s.status === "fulfilled" ? s.value : []));

  const seen = new Set();
  const jobs = [];
  for (const bucket of buckets) {
    for (const job of bucket) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      jobs.push(job);
      if (jobs.length >= MAX_RESULTS) break;
    }
    if (jobs.length >= MAX_RESULTS) break;
  }

  return Response.json({ jobs, total: jobs.length });
}

// ─── REMOTIVE ────────────────────────────────────────────────────────────────

async function remotiveSearch(query) {
  const terms = buildFallbackTerms(query);
  const seen = new Set();
  const out  = [];

  for (const term of terms) {
    if (out.length >= MAX_RESULTS) break;
    const url = `${REMOTIVE_BASE}?${term ? `search=${encodeURIComponent(term)}&` : ""}limit=${MAX_RESULTS}`;
    const data = await safeFetchJson(url);
    for (const job of data?.jobs || []) {
      const id = `rem-${job.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(shapeRemotive(job, id));
      if (out.length >= MAX_RESULTS) break;
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

// ─── THE MUSE ────────────────────────────────────────────────────────────────

async function museSearch(query, mode) {
  // Muse ignores `query`, so we fetch up to 3 pages and filter client-side.
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

  const terms = keywordTerms(query);
  const seen  = new Set();
  const out   = [];

  for (const p of pages) {
    const data = p.status === "fulfilled" ? p.value : null;
    for (const job of data?.results || []) {
      if (!matchesTerms(job, terms)) continue;
      const id = `muse-${job.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(shapeMuse(job, id));
      if (out.length >= MAX_RESULTS) break;
    }
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

function matchesTerms(job, terms) {
  if (terms.length === 0) return true;
  // Deliberately excludes job.levels and job.locations — both are constrained
  // by the request URL params, so they'd spuriously match tokens like "entry".
  const hay = [
    job.name,
    job.company?.name,
    (job.categories || []).map(c => c.name).join(" "),
    stripHtml(job.contents || "").slice(0, 1200),
  ].join(" ").toLowerCase();
  return terms.some(t => hay.includes(t));
}

function shapeMuse(job, id) {
  const locations = (job.locations || []).map(l => l.name);
  const remote = locations.some(n => /remote|flexible/i.test(n));
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

// Remotive is strict-phrase; ["graphic design", "graphic", ""] lets us degrade gracefully.
function buildFallbackTerms(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [""];
  const first = q.split(/\s+/).find(t => t.length >= 3) || "";
  const terms = [q];
  if (first && first !== q) terms.push(first);
  terms.push("");
  return terms;
}

// For Muse client-side filter: tokenize and drop noise / stop-words.
// Keep domain-meaningful tokens like "entry" (for "data entry") — only drop
// pure connective words and self-describing noise.
function keywordTerms(query) {
  const stop = new Set(["and", "the", "for", "with", "job", "jobs"]);
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !stop.has(t));
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
