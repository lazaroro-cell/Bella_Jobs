// Free APIs: Remotive + Jobicy (remote) + The Muse (Boston + remote)
// No API keys required. Paid plans not used.
//
// Design notes:
//   - The Muse's public `query` param is silently ignored upstream, so keyword
//     matching must happen here after the fetch.
//   - Remotive's `search` is strict phrase-match: "graphic design" → 0 while
//     "designer" → many. We fetch both strict and loose, then re-rank.
//   - Jobicy has no keyword search — we fetch a US-geo pool and let the
//     scorer filter. Adds coverage for niches Remotive is thin on (education,
//     bookkeeping, etc).
//   - We score every candidate with a title-weighted relevance function and
//     drop anything below MIN_SCORE. Fewer, accurate results beat a long list
//     of "Office Assistant" for a "graphic designer" search.

const MUSE_BASE     = "https://www.themuse.com/api/public/jobs";
const REMOTIVE_BASE = "https://remotive.com/api/remote-jobs";
const JOBICY_BASE   = "https://jobicy.com/api/v2/remote-jobs";
const ADZUNA_BASE   = "https://api.adzuna.com/v1/api/jobs/us/search/1";
const FETCH_OPTS    = { headers: { Accept: "application/json" }, next: { revalidate: 600 } };
const MAX_RESULTS   = 15;
const MIN_SCORE     = 5;     // below this, a candidate is considered irrelevant
const CANDIDATE_CAP = 60;    // cap work per source so we don't hammer upstreams

// Bella is an entry-level candidate looking for part-time work. Titles
// matching this pattern are out of reach regardless of how well they score.
// Blocked buckets:
//   - explicit seniority: senior/sr/staff/principal/distinguished/director/vp/chief
//   - people management: supervisor/manager/mgr/head of
//   - skilled IC roles that require CS/PhD-level credentials:
//     engineer/developer/architect/scientist/consultant/advisor
//   - "Lead" covers Tech Lead / Team Lead / Marketing Lead etc — at the cost of
//     losing "Lead Generation Specialist" (rarely shows up in these APIs anyway)
// "Executive Assistant" is intentionally NOT blocked (it's "assistant to an
// executive", an accessible admin role).
const SENIOR_TITLE_RE = /\b(senior|sr\.?|staff|principal|architect|director|distinguished|supervisor|advisor|chief|vp|manager|mgr\.?|head\s+of|lead|scientist|engineer|developer|consultant|special\s+agent)\b/i;

// Job-title words that are too generic to be the "distinctive" match on their
// own. "Office Assistant" must not count as a hit for "teaching assistant".
// Also level/tenure words — self-describing, not content.
const GENERIC_TOKENS = new Set([
  "assistant", "associate", "coordinator", "specialist", "manager", "analyst",
  "representative", "rep", "support", "agent", "lead", "senior", "junior",
  "director", "vp", "head", "chief", "officer", "worker", "staff",
  "entry", "intern", "internship", "contract", "temp",
  // Qualifiers — too broad to serve as a distinctive match on their own
  // (e.g. "digital" would otherwise let "Digital Customer Success" pass an
  // "illustrator digital art" query).
  "digital", "creative", "professional", "global",
]);

// Words removed entirely before tokenization — pure connectives or modality
// tags that the location/type filters already handle.
const STOP_TOKENS = new Set([
  "and", "the", "for", "with", "job", "jobs", "part", "time",
  "remote", "online", "hybrid", "flexible", "flex",
]);

// Synonyms for Bella's specific niches. Keys are query tokens; values are
// additional prefix-match targets. Everything in stemVariants() plus these is
// what we look for in titles/categories. Chosen surgically: "bookkeeping" →
// "accounting" (not "account", which would falsely match "Account Manager").
const SYNONYM_MAP = {
  teach:       ["educat", "instruct", "tutor", "curriculum"],
  teaching:    ["educat", "instruct", "tutor", "curriculum"],
  teacher:     ["educat", "instruct", "tutor", "curriculum"],
  preschool:   ["daycare", "childcare", "kindergarten", "toddler", "nursery"],
  bookkeep:    ["accountant", "accountancy", "accounting"],
  bookkeeper:  ["accountant", "accountancy", "accounting"],
  bookkeeping: ["accountant", "accountancy", "accounting"],
  illustrator: ["artist", "illustrat", "graphics"],
  illustration:["illustrat", "artist", "graphics"],
  baker:       ["pastry", "bakery"],
  baking:      ["baker", "pastry", "bakery"],
  pastry:      ["baker", "bakery"],
  // "Marketing Specialist" / "Content Marketing Manager" are adjacent to
  // social-media work; letting these match expands Bella's options without
  // opening the floodgates (only "social" maps to marketing, not "media").
  social:      ["community", "marketing"],
};

// Maps Bella's query tokens to Jobicy tag slugs for bonus tag-filtered fetches.
// Only tags that returned real content in probes are listed.
const JOBICY_TAG_HINTS = [
  { match: /\b(design|illustrat|graphic)/i,          tag: "design" },
  { match: /\b(teach|educat|preschool|tutor)/i,      tag: "education" },
  { match: /\b(social|media|marketing)/i,            tag: "marketing" },
  { match: /\b(bookkeep|accounting)/i,               tag: "bookkeeping" },
  { match: /\b(admin|administrative)/i,              tag: "admin" },
  { match: /\b(finance|accountant)/i,                tag: "finance" },
];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query    = (searchParams.get("q") || "").trim();
  const location = (searchParams.get("location") || "Boston, MA").trim();
  const isRemote = /remote|flexible/i.test(location);

  const analyzed = analyze(query);

  const tasks = isRemote
    ? [remotiveFetch(query), jobicyFetch(query), museFetch("remote"), adzunaFetch(query, "remote")]
    : [museFetch("boston"), adzunaFetch(query, "boston")];

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
  const noQuery = !analyzed.tokens.length || analyzed.allGeneric;
  for (const job of byId.values()) {
    // Seniority cut: Bella is entry-level, so drop titles that imply
    // years of experience. Applied even on the no-query fallback.
    if (SENIOR_TITLE_RE.test(job.title || "")) continue;
    const score = scoreJob(job, analyzed);
    if (noQuery || score >= MIN_SCORE) {
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

// ─── FETCH: JOBICY ───────────────────────────────────────────────────────────
// Jobicy has no keyword search API. We fetch a broad US-geo pool AND
// additional tag-filtered pools hinted by the query (design, education,
// marketing, etc). The scorer does the final filtering.

async function jobicyFetch(query) {
  const urls = [`${JOBICY_BASE}?count=50&geo=usa`];
  const seenTags = new Set();
  for (const hint of JOBICY_TAG_HINTS) {
    if (hint.match.test(query) && !seenTags.has(hint.tag)) {
      seenTags.add(hint.tag);
      urls.push(`${JOBICY_BASE}?count=30&tag=${hint.tag}`);
    }
  }

  const pages = await Promise.allSettled(urls.map(safeFetchJson));
  const seen = new Set();
  const out  = [];
  for (const p of pages) {
    const data = p.status === "fulfilled" ? p.value : null;
    for (const job of data?.jobs || []) {
      const id = `job-${job.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(shapeJobicy(job, id));
      if (out.length >= CANDIDATE_CAP) return out;
    }
  }
  return out;
}

function shapeJobicy(job, id) {
  const industry = Array.isArray(job.jobIndustry) ? job.jobIndustry.join(", ")
                 : (job.jobIndustry || "");
  const type     = Array.isArray(job.jobType) ? job.jobType[0]
                 : (job.jobType || "Full-Time");
  const salary   = (job.annualSalaryMin && job.annualSalaryMax)
    ? `$${job.annualSalaryMin}–$${job.annualSalaryMax}`
    : null;
  const excerpt  = stripHtml(job.jobExcerpt || job.jobDescription || "").slice(0, 350);
  return {
    id,
    title:       job.jobTitle || "Job",
    company:     job.companyName || "Company",
    location:    job.jobGeo || "Remote",
    description: excerpt,
    salary,
    posted:      formatDate(job.pubDate),
    url:         job.url,
    remote:      true,
    type,
    category:    industry,
  };
}

// ─── FETCH: ADZUNA ───────────────────────────────────────────────────────────
// Real Boston-area local listings. Requires ADZUNA_APP_ID + ADZUNA_APP_KEY as
// Vercel env vars — if unset, we skip silently so the rest of the site works.
// This is the source that actually covers cafes, daycares, bookkeepers, and
// small businesses — the entry-level supply the other three APIs lack.

async function adzunaFetch(query, mode) {
  const appId  = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return [];

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: "30",
    sort_by: "date",
  });
  if (query) params.set("what", query);
  if (mode === "boston") {
    params.set("where", "Boston, MA");
    params.set("distance", "25");  // miles; covers Malden/Cambridge/Somerville/Quincy
  } else {
    // Adzuna's "remote" filter is fuzzy; pass it as a keyword instead and let
    // the scorer + seniority filter do the rest.
    const what = query ? `${query} remote` : "remote";
    params.set("what", what);
  }

  const data = await safeFetchJson(`${ADZUNA_BASE}?${params}`);
  const out = [];
  for (const job of data?.results || []) {
    out.push(shapeAdzuna(job, `adz-${job.id}`));
    if (out.length >= CANDIDATE_CAP) break;
  }
  return out;
}

function shapeAdzuna(job, id) {
  const loc = job.location?.display_name || "Boston area";
  const salary = (job.salary_min && job.salary_max)
    ? `$${Math.round(job.salary_min / 1000)}k–$${Math.round(job.salary_max / 1000)}k`
    : null;
  return {
    id,
    title:       job.title || "Job",
    company:     job.company?.display_name || "Company",
    location:    loc,
    description: stripHtml(job.description || "").slice(0, 350),
    salary,
    posted:      formatDate(job.created),
    url:         job.redirect_url,
    remote:      /remote/i.test(loc) || /remote/i.test(job.title || ""),
    type:        job.contract_time || job.contract_type || "See listing",
    category:    job.category?.label || "",
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
// Matching uses left-bounded (prefix-bounded) stems: `\bteach` matches
// "teacher" and "teaching" but not "ruteach" — and critically `\bart` does
// not match "parts" (the "a" in "parts" isn't at a word boundary).
//
// Gate (multi-token queries): at least one NON-generic token must have a
// prefix-bounded stem hit in the title or category. OR semantics so
// "baker pastry" matches "Senior Baker" AND "Pastry Chef", while "Office
// Assistant" is still blocked for "teaching assistant" (the only non-generic
// token, "teaching", is absent). The scorer does the actual ranking; the
// gate just guarantees no totally-irrelevant results slip through.
//
// Points:
//   +15  exact phrase appears in title
//   +10  every token has a prefix-bounded stem in title
//   + 5  per stem hit in title
//   + 3  per stem hit in category
//   + 2  every token prefix-stem-matches in description

function scoreJob(job, a) {
  // No content tokens (empty query, or tokens entirely generic like "entry"):
  // skip filtering and treat everything as a potential match. This is what
  // makes the "Any Remote" pill (q="remote part time entry" → ["entry"]) work.
  if (!a.tokens.length || a.allGeneric) return 1;

  const title = (job.title || "").toLowerCase();
  const category = (job.category || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();
  const titleCat = `${title} ${category}`;

  // Gate:
  //   - Multi-token query: at least one NON-generic token must prefix-stem-hit
  //     in title or category. OR semantics, so "baker pastry" matches both
  //     "Senior Baker" and "Pastry Chef" while still blocking "Office
  //     Assistant" from matching "teaching assistant".
  //   - Single-token query: the token must prefix-stem-hit in title, category,
  //     or description.
  if (a.tokens.length > 1) {
    const nonGeneric = a.tokens.filter(t => !GENERIC_TOKENS.has(t));
    if (!nonGeneric.length || !nonGeneric.some(t => prefixStemHit(titleCat, t))) {
      return 0;
    }
  } else {
    if (!prefixStemHit(`${titleCat} ${desc}`, a.tokens[0])) return 0;
  }

  let score = 0;

  if (a.phrase.includes(" ") && title.includes(a.phrase)) score += 15;

  if (a.tokens.every(t => prefixStemHit(title, t))) score += 10;

  // Per-token (not per-stem) — each token contributes at most +5/+3 regardless
  // of how many of its stem/synonym variants hit, avoiding double-counts when
  // e.g. "designer" matches both "designer" and "design" stems in one word.
  for (const t of a.tokens) {
    if (prefixStemHit(title, t)) score += 5;
  }
  for (const t of a.tokens) {
    if (prefixStemHit(category, t)) score += 3;
  }
  if (a.tokens.every(t => prefixStemHit(desc, t))) score += 2;

  return score;
}

// Left-bounded: term must start at a word boundary but the word can continue.
// \bteach matches "teacher", "teaching", "teach" — but \bart in "parts" fails
// because "a" is preceded by "p" (word char).
function prefixHit(text, term) {
  return new RegExp(`\\b${term}`, "i").test(text);
}

function prefixStemHit(text, term) {
  // Combines morphology (stemVariants) and domain synonyms (SYNONYM_MAP).
  // Each variant is checked as a prefix match at a word boundary, so
  // "accountant" matches \baccountant but "Account Manager" does not.
  const variants = [...stemVariants(term), ...(SYNONYM_MAP[term] || [])];
  return variants.some(v => prefixHit(text, v));
}

// ─── QUERY ANALYSIS ──────────────────────────────────────────────────────────

function analyze(query) {
  const phrase = query.toLowerCase().trim();
  const tokens = phrase
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !STOP_TOKENS.has(t));

  const stems = new Set();
  for (const t of tokens) {
    for (const v of stemVariants(t)) stems.add(v);
  }

  // True when the user's query contains only self-describing/qualifier words
  // (all tokens are generic). Treat as no-query so we return recent jobs.
  const allGeneric = tokens.length > 0 && tokens.every(t => GENERIC_TOKENS.has(t));

  return { phrase, tokens, stems: [...stems], allGeneric };
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

function mostDistinctiveToken(query) {
  const toks = query.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 4 && !STOP_TOKENS.has(t) && !GENERIC_TOKENS.has(t));
  if (!toks.length) return "";
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
