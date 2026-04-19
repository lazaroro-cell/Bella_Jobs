// Free APIs: The Muse + Remotive — no API key needed

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query    = searchParams.get("q") || "";
  const location = searchParams.get("location") || "Boston, MA";
  const page     = parseInt(searchParams.get("page") || "1");

  const isRemote = location.toLowerCase().includes("remote");

  // Try The Muse first (free, covers Boston + remote, entry level)
  try {
    const museParams = new URLSearchParams({
      query,
      page: page - 1,
      results_per_page: 10,
      descending: true,
    });
    if (isRemote) {
      museParams.append("location", "Flexible / Remote");
    } else {
      museParams.append("location", "Boston, MA, US");
      museParams.append("location", "Flexible / Remote");
    }
    museParams.append("level", "Entry Level");
    museParams.append("level", "Mid Level");

    const museRes = await fetch(
      `https://www.themuse.com/api/public/jobs?${museParams}`,
      { headers: { Accept: "application/json" }, next: { revalidate: 300 } }
    );

    if (museRes.ok) {
      const museData = await museRes.json();
      if ((museData.results || []).length > 0) {
        const jobs = museData.results.map(job => ({
          id:          String(job.id),
          title:       job.name,
          company:     job.company?.name || "Company",
          location:    (job.locations || []).map(l => l.name).join(" / ") || "See listing",
          description: stripHtml(job.contents || "").slice(0, 350),
          salary:      null,
          posted:      formatDate(job.publication_date),
          url:         job.refs?.landing_page || `https://www.themuse.com/jobs/${job.id}`,
          remote:      (job.locations || []).some(l =>
            l.name?.toLowerCase().includes("remote") || l.name?.toLowerCase().includes("flexible")
          ),
          type:        "See listing",
          category:    (job.categories || []).map(c => c.name).join(", "),
        }));
        return Response.json({ jobs, total: museData.total || jobs.length });
      }
    }
  } catch (_) {}

  // Fallback: Remotive (free, remote jobs only)
  try {
    const remotiveRes = await fetch(
      `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=10`,
      { next: { revalidate: 300 } }
    );
    if (remotiveRes.ok) {
      const remotiveData = await remotiveRes.json();
      const jobs = (remotiveData.jobs || []).slice(0, 10).map(job => ({
        id:          String(job.id),
        title:       job.title,
        company:     job.company_name,
        location:    job.candidate_required_location || "Remote",
        description: stripHtml(job.description || "").slice(0, 350),
        salary:      job.salary || null,
        posted:      formatDate(job.publication_date),
        url:         job.url,
        remote:      true,
        type:        job.job_type || "Full-time",
        category:    job.category || "",
      }));
      return Response.json({ jobs, total: jobs.length });
    }
  } catch (_) {}

  return Response.json({ jobs: [], total: 0 });
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function formatDate(dateStr) {
  if (!dateStr) return "Recently";
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)} week${Math.floor(diff / 7) > 1 ? "s" : ""} ago`;
  return `${Math.floor(diff / 30)} month${Math.floor(diff / 30) > 1 ? "s" : ""} ago`;
}
