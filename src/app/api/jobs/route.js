export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query    = searchParams.get("q") || "";
  const location = searchParams.get("location") || "Boston, MA";
  const jobType  = searchParams.get("type") || "";
  const page     = searchParams.get("page") || "1";

  const APP_ID  = process.env.ADZUNA_APP_ID;
  const APP_KEY = process.env.ADZUNA_APP_KEY;

  if (!APP_ID || !APP_KEY) {
    return Response.json({ error: "API keys not configured" }, { status: 500 });
  }

  // Build Adzuna query params
  const params = new URLSearchParams({
    app_id:   APP_ID,
    app_key:  APP_KEY,
    results_per_page: "12",
    what:     query,
    where:    location,
    content_type: "application/json",
    page,
  });

  // Map job type
  if (jobType === "parttime")   params.set("full_time", "0");
  if (jobType === "fulltime")   params.set("full_time", "1");
  if (jobType === "contract")   params.set("contract",  "1");
  if (jobType === "internship") params.set("permanent", "0");

  try {
    const url = `https://api.adzuna.com/v1/api/jobs/us/search/${page}?${params}`;
    const res = await fetch(url, { next: { revalidate: 300 } }); // cache 5 min

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: "Adzuna error", detail: text }, { status: res.status });
    }

    const data = await res.json();

    // Normalize results
    const jobs = (data.results || []).map(job => ({
      id:          job.id,
      title:       job.title,
      company:     job.company?.display_name || "Company not listed",
      location:    job.location?.display_name || location,
      description: job.description,
      salary_min:  job.salary_min ? Math.round(job.salary_min) : null,
      salary_max:  job.salary_max ? Math.round(job.salary_max) : null,
      salary:      formatSalary(job.salary_min, job.salary_max),
      posted:      formatDate(job.created),
      url:         job.redirect_url,
      remote:      isRemote(job),
      type:        job.contract_time === "full_time" ? "Full-time" : job.contract_time === "part_time" ? "Part-time" : job.contract_type === "contract" ? "Contract" : "Part-time",
      category:    job.category?.label || "",
    }));

    return Response.json({ jobs, total: data.count || 0 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

function formatSalary(min, max) {
  if (!min && !max) return null;
  const fmt = (n) => n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}/hr`;
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `From ${fmt(min)}`;
  if (max) return `Up to ${fmt(max)}`;
  return null;
}

function formatDate(dateStr) {
  if (!dateStr) return "Recently";
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7)  return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)} week${Math.floor(diff / 7) > 1 ? "s" : ""} ago`;
  return `${Math.floor(diff / 30)} month${Math.floor(diff / 30) > 1 ? "s" : ""} ago`;
}

function isRemote(job) {
  const text = `${job.title} ${job.description} ${job.location?.display_name || ""}`.toLowerCase();
  return text.includes("remote") || text.includes("work from home") || text.includes("wfh");
}
