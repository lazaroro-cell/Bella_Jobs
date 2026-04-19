# Bella's Job Finder

A real job search tool for Bella — pulls live listings from Adzuna, tracks applications, saves favorites.

---

## STEP-BY-STEP SETUP (do this once, takes ~20 minutes)

---

### STEP 1 — Get your free Adzuna API key

1. Go to **https://developer.adzuna.com**
2. Click "Register" at the top right
3. Fill in your name and email — no credit card needed
4. Verify your email
5. Log in and click "Create New App"
6. Name it anything (e.g. "Bella Jobs")
7. Copy your **App ID** and **App Key** — you'll need these in Step 4

---

### STEP 2 — Put this code on GitHub

1. Go to **https://github.com** and create a free account (or log in)
2. Click the **+** button → "New repository"
3. Name it: `bella-jobs`
4. Leave it Public
5. Click "Create repository"
6. On the next page, click "uploading an existing file"
7. Upload ALL the files from this folder (keep the folder structure the same)
8. Click "Commit changes"

---

### STEP 3 — Deploy on Vercel

1. Go to **https://vercel.com**
2. Sign up with your GitHub account (click "Continue with GitHub")
3. Click "Add New Project"
4. Find `bella-jobs` in the list and click "Import"
5. Leave all settings as default
6. **BEFORE clicking Deploy** — scroll down to "Environment Variables"
7. Add these two variables:
   - Name: `ADZUNA_APP_ID` → Value: (your App ID from Step 1)
   - Name: `ADZUNA_APP_KEY` → Value: (your App Key from Step 1)
8. Now click **Deploy**
9. Wait ~2 minutes for it to build
10. Vercel gives you a URL like `bella-jobs.vercel.app`

---

### STEP 4 — Send Bella the link

That's it. She opens the URL in any browser, on any device.
No login, no setup, no installation.

---

## What Bella can do

- **Search** any job by keyword — graphic design, data entry, bakery, whatever
- **Browse categories** — 10 preset buttons for her specific fields
- **Filter** by Boston, Remote, or both — and by job type (part-time, full-time, etc.)
- **Save** jobs she's interested in for later
- **Apply** — opens the real job listing in a new tab AND automatically tracks it
- **Track** — update status (Applied → Interview → Offer → Rejected)
- **Notes** — add notes per job (interview tips, contact names, etc.)
- Everything **saves automatically** in her browser between sessions

---

## Project Structure

```
bella-jobs/
├── src/
│   └── app/
│       ├── api/
│       │   └── jobs/
│       │       └── route.js      ← Adzuna API connection
│       ├── globals.css
│       ├── layout.js
│       └── page.js               ← Main app
├── next.config.js
├── package.json
└── README.md
```

---

## Free tier limits

- **Adzuna free tier:** 250 API calls/month — plenty for personal use
- **Vercel free tier:** Unlimited personal projects, 100GB bandwidth/month
- **Total cost:** $0

---

## Updating the app

If you want to make changes:
1. Edit the files
2. Upload the new versions to GitHub (same repository)
3. Vercel automatically redeploys within ~2 minutes
