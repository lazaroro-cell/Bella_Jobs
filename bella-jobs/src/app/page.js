"use client";
import { useState, useEffect, useCallback } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id:"design",    label:"🎨 Graphic Design",     q:"graphic designer",        loc:"Boston, MA",   type:"parttime" },
  { id:"illus",     label:"✏️ Illustration",        q:"illustrator digital art",  loc:"remote",       type:"parttime" },
  { id:"edu",       label:"📚 Teaching Assistant",  q:"teaching assistant",       loc:"Boston, MA",   type:"parttime" },
  { id:"preschool", label:"🧸 Preschool / Childcare",q:"preschool teacher",        loc:"Boston, MA",   type:"parttime" },
  { id:"data",      label:"⌨️ Data Entry",          q:"data entry",               loc:"remote",       type:"parttime" },
  { id:"admin",     label:"📋 Admin Assistant",     q:"administrative assistant", loc:"remote",       type:"parttime" },
  { id:"tax",       label:"🧾 Accounting Support",  q:"bookkeeping assistant",    loc:"remote",       type:"parttime" },
  { id:"baking",    label:"🥐 Baking / Food",       q:"baker pastry",             loc:"Boston, MA",   type:"parttime" },
  { id:"creative",  label:"🌟 Social Media",        q:"social media assistant",   loc:"remote",       type:"parttime" },
  { id:"remote",    label:"💻 Any Remote",          q:"remote part time entry",   loc:"remote",       type:"parttime" },
];

const STAGES   = ["Applied", "Interview", "Offer", "Rejected"];
const SCOL = {
  Applied:   { bg:"#eef4ff", br:"#6b9fff", tx:"#1a4db5" },
  Interview: { bg:"#f0faf0", br:"#5cb85c", tx:"#2a6b2a" },
  Offer:     { bg:"#fff0f9", br:"#e060b0", tx:"#8a1a60" },
  Rejected:  { bg:"#f5f5f5", br:"#c0c0c0", tx:"#666"    },
};

// ─── LOCAL STORAGE HELPERS ────────────────────────────────────────────────────

function lsGet(key, fallback = []) {
  if (typeof window === "undefined") return fallback;
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function lsSet(key, val) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const [view,        setView]       = useState("search");
  const [query,       setQuery]      = useState("");
  const [locType,     setLocType]    = useState("both");
  const [jobType,     setJobType]    = useState("parttime");
  const [results,     setResults]    = useState([]);
  const [loading,     setLoading]    = useState(false);
  const [searched,    setSearched]   = useState(false);
  const [activeCat,   setActiveCat]  = useState(null);
  const [saved,       setSaved]      = useState([]);
  const [tracked,     setTracked]    = useState([]);
  const [stageFilter, setStageFilter]= useState("All");
  const [editNote,    setEditNote]   = useState(null);
  const [noteText,    setNoteText]   = useState("");
  const [toast,       setToast]      = useState(null);
  const [total,       setTotal]      = useState(0);
  const [error,       setError]      = useState(null);

  // Load from localStorage on mount
  useEffect(() => {
    setSaved(lsGet("bella_saved", []));
    setTracked(lsGet("bella_tracked", []));
  }, []);

  const showToast = (msg, color = "#5cb85c") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 2800);
  };

  // ── SEARCH ──────────────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async (q, loc, type) => {
    setLoading(true);
    setSearched(true);
    setError(null);
    try {
      let allJobs = [];

      if (loc === "both") {
        const [r1, r2] = await Promise.all([
          fetch(`/api/jobs?q=${encodeURIComponent(q)}&location=Boston%2C%20MA&type=${type}`).then(r => r.json()),
          fetch(`/api/jobs?q=${encodeURIComponent(q)}&location=remote&type=${type}`).then(r => r.json()),
        ]);
        const seen = new Set();
        for (const j of [...(r1.jobs||[]), ...(r2.jobs||[])]) {
          if (!seen.has(j.id)) { seen.add(j.id); allJobs.push(j); }
        }
        setTotal((r1.total||0) + (r2.total||0));
      } else {
        const location = loc === "boston" ? "Boston, MA" : "remote";
        const r = await fetch(`/api/jobs?q=${encodeURIComponent(q)}&location=${encodeURIComponent(location)}&type=${type}`).then(r => r.json());
        allJobs = r.jobs || [];
        setTotal(r.total || 0);
        if (r.error) { setError("Search failed — check your API keys in Vercel."); }
      }

      setResults(allJobs);
      if (allJobs.length === 0 && !error) showToast("No results — try different keywords", "#f5a742");
    } catch (e) {
      setError("Something went wrong. Please try again.");
      setResults([]);
    }
    setLoading(false);
  }, []);

  const doSearch = () => {
    if (!query.trim()) return;
    setActiveCat(null);
    fetchJobs(query, locType, jobType);
  };

  const searchCat = (cat) => {
    setActiveCat(cat.id);
    setQuery(cat.q);
    const loc = locType === "both" ? "both" : locType === "remote" ? "remote" : cat.loc === "remote" ? "remote" : "boston";
    fetchJobs(cat.q, loc, cat.type);
  };

  // ── SAVE / APPLY / TRACK ─────────────────────────────────────────────────────

  const isTracked = id => tracked.some(t => t.id === id);
  const isSaved   = id => saved.some(s => s.id === id);

  const saveJob = (job) => {
    if (isSaved(job.id) || isTracked(job.id)) return;
    const next = [{ ...job, savedAt: new Date().toLocaleDateString() }, ...saved];
    setSaved(next); lsSet("bella_saved", next);
    showToast("💾 Saved!");
  };

  const unsaveJob = (id) => {
    const next = saved.filter(s => s.id !== id);
    setSaved(next); lsSet("bella_saved", next);
    showToast("Removed", "#f5a742");
  };

  const applyJob = (job) => {
    window.open(job.url, "_blank", "noopener,noreferrer");
    if (!isTracked(job.id)) {
      const entry = {
        ...job,
        appliedAt: new Date().toLocaleDateString(),
        stage: "Applied",
        note: "",
        stageHistory: [{ stage:"Applied", date: new Date().toLocaleDateString() }],
      };
      const next = [entry, ...tracked];
      setTracked(next); lsSet("bella_tracked", next);
      if (isSaved(job.id)) {
        const ns = saved.filter(s => s.id !== job.id);
        setSaved(ns); lsSet("bella_saved", ns);
      }
      showToast("✅ Opening listing + tracking application!");
    } else {
      showToast("↗️ Opening listing...");
    }
  };

  const updateStage = (id, stage) => {
    const next = tracked.map(t => t.id === id
      ? { ...t, stage, stageHistory:[...(t.stageHistory||[]), { stage, date: new Date().toLocaleDateString() }] }
      : t
    );
    setTracked(next); lsSet("bella_tracked", next);
    showToast(`Updated to ${stage}!`, SCOL[stage]?.br || "#5cb85c");
  };

  const saveNote = (id) => {
    const next = tracked.map(t => t.id === id ? { ...t, note: noteText } : t);
    setTracked(next); lsSet("bella_tracked", next);
    setEditNote(null); showToast("Note saved! 📝");
  };

  const removeTracked = (id) => {
    const next = tracked.filter(t => t.id !== id);
    setTracked(next); lsSet("bella_tracked", next);
    showToast("Removed", "#f5a742");
  };

  const filtered  = stageFilter === "All" ? tracked : tracked.filter(t => t.stage === stageFilter);
  const stageCounts = STAGES.reduce((a, s) => ({ ...a, [s]: tracked.filter(t => t.stage === s).length }), {});

  // ── RENDER ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight:"100vh", background:"#faf8f4" }}>

      {/* TOAST */}
      {toast && (
        <div style={{ position:"fixed", top:18, left:"50%", transform:"translateX(-50%)", background:toast.color, color:"#fff", padding:"10px 22px", borderRadius:30, fontSize:13, fontWeight:700, zIndex:1000, boxShadow:"0 4px 20px rgba(0,0,0,0.15)", whiteSpace:"nowrap", pointerEvents:"none" }}>
          {toast.msg}
        </div>
      )}

      {/* HEADER */}
      <header style={{ background:"linear-gradient(135deg,#ff9a7b 0%,#ffd4a8 55%,#ffb7d5 100%)", padding:"26px 24px 20px", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:-30, right:-30, width:130, height:130, background:"rgba(255,255,255,0.12)", borderRadius:"50%" }}/>
        <div style={{ position:"absolute", bottom:-40, left:"38%", width:90, height:90, background:"rgba(255,255,255,0.08)", borderRadius:"50%" }}/>
        <div style={{ position:"relative" }}>
          <div style={{ fontSize:10, letterSpacing:3, textTransform:"uppercase", color:"rgba(255,255,255,0.75)", marginBottom:3 }}>✨ real jobs · updated daily</div>
          <div style={{ fontSize:26, fontWeight:900, color:"#fff", letterSpacing:-0.5 }}>Hey Bella! 👋</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.82)", marginTop:3 }}>Boston / Malden · Remote friendly · Entry level</div>
        </div>

        {/* NAV */}
        <nav style={{ display:"flex", gap:8, marginTop:16 }}>
          {[
            { id:"search",  label:"🔍 Find Jobs" },
            { id:"saved",   label:`💾 Saved${saved.length > 0 ? ` (${saved.length})` : ""}` },
            { id:"tracker", label:`📋 Applied${tracked.length > 0 ? ` (${tracked.length})` : ""}` },
          ].map(tab => (
            <button key={tab.id} onClick={() => setView(tab.id)} style={{ background:view===tab.id?"rgba(255,255,255,0.95)":"rgba(255,255,255,0.28)", border:"none", borderRadius:20, padding:"7px 16px", fontSize:12, fontWeight:700, color:view===tab.id?"#c87a50":"rgba(255,255,255,0.9)", fontFamily:"inherit", transition:"all 0.2s" }}>
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* CONTENT */}
      <main style={{ padding:"20px 20px 40px", maxWidth:860, margin:"0 auto" }}>

        {/* ══ SEARCH ══════════════════════════════════════════════════════════ */}
        {view === "search" && (
          <div>
            {/* Search bar */}
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch()}
                placeholder="Search... 'graphic design', 'bakery Boston', 'data entry remote'..."
                style={{ flex:1, background:"#fff", border:"2px solid #ffe0cc", borderRadius:13, padding:"12px 16px", fontSize:13, fontFamily:"inherit", outline:"none", color:"#2d2820" }}
              />
              <button onClick={doSearch} disabled={loading || !query.trim()} style={{ background:"linear-gradient(135deg,#ff9a7b,#ff6b6b)", border:"none", borderRadius:13, padding:"12px 20px", color:"#fff", fontSize:13, fontWeight:800, fontFamily:"inherit", opacity:loading || !query.trim() ? 0.55 : 1, minWidth:80 }}>
                {loading ? "..." : "Search"}
              </button>
            </div>

            {/* Filters */}
            <div style={{ display:"flex", gap:7, flexWrap:"wrap", marginBottom:16 }}>
              {[["both","🗺️ Boston + Remote"],["boston","📍 Boston"],["remote","💻 Remote"]].map(([v,l]) => (
                <Pill key={v} active={locType===v} color="#ff9a7b" onClick={() => setLocType(v)}>{l}</Pill>
              ))}
              <div style={{ width:1, background:"#ffe0cc", margin:"0 3px" }}/>
              {[["parttime","Part-time"],["fulltime","Full-time"],["internship","Internship"],["contract","Contract"]].map(([v,l]) => (
                <Pill key={v} active={jobType===v} color="#e060b0" onClick={() => setJobType(v)}>{l}</Pill>
              ))}
            </div>

            {/* Category pills */}
            <div style={{ marginBottom:18 }}>
              <div style={{ fontSize:10, color:"#c9a98a", letterSpacing:2, textTransform:"uppercase", marginBottom:8 }}>Browse by category</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
                {CATEGORIES.map(cat => (
                  <button key={cat.id} onClick={() => searchCat(cat)} style={{ background:activeCat===cat.id?"linear-gradient(135deg,#ff9a7b,#ffb7d5)":"#fff", border:`1.5px solid ${activeCat===cat.id?"transparent":"#ffe0cc"}`, borderRadius:25, padding:"7px 14px", fontSize:12, fontWeight:700, color:activeCat===cat.id?"#fff":"#7a5c48", fontFamily:"inherit", transition:"all 0.2s", boxShadow:activeCat===cat.id?"0 3px 12px rgba(255,154,123,0.35)":"none" }}>
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* States */}
            {loading && <Center icon="✨" title="Searching real job listings..." sub="Pulling from thousands of employers" />}
            {error   && <Center icon="⚠️" title="Something went wrong" sub={error} />}
            {!loading && !searched && <Center icon="🌸" title="What are you looking for today?" sub="Search above or tap a category to get started" />}
            {!loading && searched && !error && results.length === 0 && <Center icon="🌿" title="No results found" sub="Try different keywords or adjust the filters above" />}

            {/* Results */}
            {!loading && results.length > 0 && (
              <>
                <div style={{ fontSize:10, color:"#c9a98a", letterSpacing:2, textTransform:"uppercase", marginBottom:12 }}>
                  {results.length} jobs found
                </div>
                <div style={{ display:"grid", gap:10 }}>
                  {results.map(job => (
                    <JobCard key={job.id} job={job}
                      onSave={!isSaved(job.id) && !isTracked(job.id) ? () => saveJob(job) : null}
                      onApply={() => applyJob(job)}
                      saved={isSaved(job.id)}
                      applied={isTracked(job.id)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ══ SAVED ════════════════════════════════════════════════════════════ */}
        {view === "saved" && (
          <div>
            <h2 style={{ fontSize:18, fontWeight:900, marginBottom:4 }}>Saved Jobs 💾</h2>
            <p style={{ fontSize:12, color:"#b8a898", marginBottom:16 }}>Jobs you're interested in. Hit Apply when you're ready — opens the listing directly.</p>
            {saved.length === 0
              ? <Center icon="🌻" title="Nothing saved yet" sub="Tap 💾 Save on any job to add it here" />
              : <div style={{ display:"grid", gap:10 }}>
                  {saved.map(job => (
                    <JobCard key={job.id} job={job}
                      onSave={null}
                      onApply={() => applyJob(job)}
                      saved={true}
                      applied={isTracked(job.id)}
                      onUnsave={() => unsaveJob(job.id)}
                    />
                  ))}
                </div>
            }
          </div>
        )}

        {/* ══ TRACKER ══════════════════════════════════════════════════════════ */}
        {view === "tracker" && (
          <div>
            <h2 style={{ fontSize:18, fontWeight:900, marginBottom:4 }}>My Applications 📋</h2>
            <p style={{ fontSize:12, color:"#b8a898", marginBottom:14 }}>Track everything you've applied to. Update the stage as things progress.</p>

            {/* Stage filter */}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
              {["All", ...STAGES].map(s => {
                const c = SCOL[s] || {};
                const active = stageFilter === s;
                return (
                  <button key={s} onClick={() => setStageFilter(s)} style={{ background:active?(c.bg||"#fff8f3"):"#fff", border:`1.5px solid ${active?(c.br||"#ff9a7b"):"#ffe0cc"}`, borderRadius:20, padding:"5px 13px", fontSize:11, fontWeight:700, color:active?(c.tx||"#a0522d"):"#b8a898", fontFamily:"inherit" }}>
                    {s} {s==="All" ? `(${tracked.length})` : stageCounts[s] > 0 ? `(${stageCounts[s]})` : ""}
                  </button>
                );
              })}
            </div>

            {filtered.length === 0
              ? <Center icon="📭" title={stageFilter==="All" ? "No applications yet!" : `No ${stageFilter} applications`} sub={stageFilter==="All" ? "Hit Apply on any job to start tracking it." : "Switch to All to see everything."} />
              : <div style={{ display:"grid", gap:10 }}>
                  {filtered.map(job => (
                    <TrackerCard key={job.id} job={job}
                      onStageChange={s => updateStage(job.id, s)}
                      onEditNote={() => { setEditNote(job.id); setNoteText(job.note||""); }}
                      onRemove={() => removeTracked(job.id)}
                      onOpen={() => window.open(job.url, "_blank", "noopener,noreferrer")}
                      editingNote={editNote === job.id}
                      noteText={noteText}
                      setNoteText={setNoteText}
                      onSaveNote={() => saveNote(job.id)}
                      onCancelNote={() => setEditNote(null)}
                    />
                  ))}
                </div>
            }
          </div>
        )}
      </main>
    </div>
  );
}

// ─── JOB CARD ─────────────────────────────────────────────────────────────────

function JobCard({ job, onSave, onApply, saved, applied, onUnsave }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background:"#fff", borderRadius:14, padding:"16px 18px", boxShadow:"0 2px 14px rgba(255,154,123,0.07)", border:"1px solid #ffeee6" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginBottom:3 }}>
            <span style={{ fontSize:14, fontWeight:800, color:"#2d2820" }}>{job.title}</span>
            {job.remote && <Tag bg="#eefaf0" br="#b8e8c8" tx="#3a9a5a">Remote</Tag>}
            {job.type   && <Tag bg="#eef4ff" br="#bdd0ff" tx="#4a70d0">{job.type}</Tag>}
          </div>
          <div style={{ fontSize:12, color:"#7a5c48", fontWeight:700, marginBottom:3 }}>{job.company}</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", fontSize:11, color:"#b8a898" }}>
            <span>📍 {job.location}</span>
            {job.salary && <span>💰 {job.salary}</span>}
            <span>🕒 {job.posted}</span>
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:5, flexShrink:0 }}>
          {!applied
            ? <button onClick={onApply} style={{ background:"linear-gradient(135deg,#ff9a7b,#ff6b6b)", border:"none", borderRadius:10, padding:"8px 15px", color:"#fff", fontSize:12, fontWeight:800, fontFamily:"inherit", boxShadow:"0 3px 10px rgba(255,107,107,0.3)", whiteSpace:"nowrap" }}>↗ Apply</button>
            : <div style={{ background:"#eefaf0", border:"1px solid #5cb85c", borderRadius:10, padding:"7px 12px", color:"#3a8a3a", fontSize:11, fontWeight:700, textAlign:"center" }}>✓ Applied</div>
          }
          {onSave && !applied && (
            <button onClick={onSave} style={{ background:"#fff8f3", border:"1px solid #ffe0cc", borderRadius:10, padding:"6px 13px", color:"#c87a50", fontSize:11, fontWeight:700, fontFamily:"inherit" }}>💾 Save</button>
          )}
          {saved && onUnsave && (
            <button onClick={onUnsave} style={{ background:"#fff8f3", border:"1px solid #ffe0cc", borderRadius:10, padding:"6px 11px", color:"#c87a50", fontSize:11, fontFamily:"inherit" }}>× Remove</button>
          )}
        </div>
      </div>

      {job.description && (
        <>
          <button onClick={() => setExpanded(!expanded)} style={{ background:"none", border:"none", color:"#c9a98a", fontSize:11, fontFamily:"inherit", marginTop:9, padding:0 }}>
            {expanded ? "▲ Less" : "▼ More info"}
          </button>
          {expanded && (
            <div style={{ marginTop:8, fontSize:12, color:"#6a5048", lineHeight:1.7, background:"#faf8f4", borderRadius:9, padding:"10px 13px" }}>
              {job.description.length > 400 ? job.description.slice(0, 400) + "..." : job.description}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── TRACKER CARD ─────────────────────────────────────────────────────────────

function TrackerCard({ job, onStageChange, onEditNote, onRemove, onOpen, editingNote, noteText, setNoteText, onSaveNote, onCancelNote }) {
  const sc = SCOL[job.stage] || SCOL.Applied;
  return (
    <div style={{ background:"#fff", borderRadius:14, padding:"14px 16px", boxShadow:"0 2px 12px rgba(255,154,123,0.06)", border:`1px solid ${sc.br}55` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, marginBottom:10 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:800, color:"#2d2820", marginBottom:2 }}>{job.title}</div>
          <div style={{ fontSize:11, color:"#7a5c48", fontWeight:700, marginBottom:2 }}>{job.company}</div>
          <div style={{ fontSize:10, color:"#b8a898" }}>
            📍 {job.location} · Applied {job.appliedAt}
            {job.salary && ` · 💰 ${job.salary}`}
          </div>
        </div>
        <div style={{ display:"flex", gap:5, flexShrink:0 }}>
          <button onClick={onOpen}   style={{ background:"#eef4ff", border:"1px solid #bdd0ff", borderRadius:7, padding:"5px 10px", color:"#4a70d0", fontSize:11, fontWeight:700, fontFamily:"inherit" }}>↗ Open</button>
          <button onClick={onRemove} style={{ background:"#fff0f0", border:"1px solid #ffb8b8", borderRadius:7, padding:"5px 9px",  color:"#d05050", fontSize:11, fontFamily:"inherit" }}>×</button>
        </div>
      </div>

      {/* Stage buttons */}
      <div style={{ marginBottom:10 }}>
        <div style={{ fontSize:9, color:"#c9a98a", letterSpacing:1, textTransform:"uppercase", marginBottom:5 }}>Status</div>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
          {STAGES.map(s => {
            const c = SCOL[s];
            const active = job.stage === s;
            return (
              <button key={s} onClick={() => onStageChange(s)} style={{ background:active?c.bg:"#faf8f4", border:`1px solid ${active?c.br:"#ece8e0"}`, borderRadius:20, padding:"4px 12px", fontSize:11, fontWeight:active?800:500, color:active?c.tx:"#b8a898", fontFamily:"inherit", transition:"all 0.15s" }}>
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Note */}
      {!editingNote
        ? <div onClick={onEditNote} style={{ background:"#faf8f4", borderRadius:9, padding:"8px 11px", fontSize:11, color:job.note?"#6a5048":"#c9a98a", border:"1px dashed #ece8e0", minHeight:32, lineHeight:1.5, cursor:"pointer" }}>
            {job.note || "+ Add a note (interview tips, contact info, next steps...)"}
          </div>
        : <div>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Notes, tips, contacts..." style={{ width:"100%", background:"#faf8f4", border:"1px solid #ffd4b0", borderRadius:9, padding:"8px 11px", fontSize:11, color:"#2d2820", outline:"none", resize:"vertical", minHeight:65 }}/>
            <div style={{ display:"flex", gap:6, marginTop:6 }}>
              <button onClick={onSaveNote}   style={{ background:"linear-gradient(135deg,#ff9a7b,#ff6b6b)", border:"none", borderRadius:8, padding:"6px 14px", color:"#fff", fontSize:11, fontWeight:800, fontFamily:"inherit" }}>Save</button>
              <button onClick={onCancelNote} style={{ background:"#f0ece8", border:"none", borderRadius:8, padding:"6px 11px", color:"#9a7a68", fontSize:11, fontFamily:"inherit" }}>Cancel</button>
            </div>
          </div>
      }

      {/* Stage history */}
      {(job.stageHistory||[]).length > 1 && (
        <div style={{ marginTop:8, fontSize:10, color:"#c9a98a", lineHeight:1.6 }}>
          {job.stageHistory.map((h, i) => (
            <span key={i}>{h.stage} ({h.date}){i < job.stageHistory.length - 1 ? " → " : ""}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MICRO COMPONENTS ─────────────────────────────────────────────────────────

function Center({ icon, title, sub }) {
  return (
    <div style={{ textAlign:"center", padding:"48px 20px", color:"#c9a98a" }}>
      <div style={{ fontSize:44, marginBottom:10 }}>{icon}</div>
      <div style={{ fontSize:14, fontWeight:700, color:"#9a7a68", marginBottom:5 }}>{title}</div>
      <div style={{ fontSize:12 }}>{sub}</div>
    </div>
  );
}

function Tag({ bg, br, tx, children }) {
  return <span style={{ fontSize:9, background:bg, color:tx, border:`1px solid ${br}`, borderRadius:20, padding:"2px 7px", fontWeight:800 }}>{children}</span>;
}

function Pill({ active, color, onClick, children }) {
  return (
    <button onClick={onClick} style={{ background:active?"#fff8f3":"#fff", border:`1.5px solid ${active?color:"#ffe0cc"}`, borderRadius:20, padding:"5px 12px", fontSize:11, fontWeight:700, color:active?color:"#b8a898", fontFamily:"inherit" }}>
      {children}
    </button>
  );
}
