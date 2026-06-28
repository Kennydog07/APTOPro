# APTO Pro

**AI Business Intelligence for Local Businesses**

> Find customers before your competitors do.

APTO Pro is an AI-powered lead generation platform for UK tradespeople and local businesses. The AI scans community groups and local forums 24/7, scores leads, and generates personalised replies.

---

## Project Structure

```
aptopro/
├── public/                  # Static site (Netlify publish directory)
│   ├── index.html           # Marketing site
│   ├── app.html             # Dashboard (auth-gated)
│   ├── ai-engine.html       # AI Lead Engine
│   └── images/
│       └── mascot.png       # APTO Pro mascot
├── netlify/
│   └── functions/
│       └── analyse-lead.js  # Serverless API proxy (keeps API key safe)
├── netlify.toml             # Netlify build + redirect config
├── package.json
├── .env.example             # Copy to .env and fill in your keys
├── .gitignore
└── README.md
```

---

## Quick Deploy

### 1. Clone and set up

```bash
git clone https://github.com/johng34/aptopro.git
cd aptopro
npm install
```

### 2. Set environment variables

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### 3. Run locally

```bash
npm run dev
# Opens at http://localhost:8888
```

### 4. Deploy to Netlify

**Option A — Via GitHub (recommended):**
1. Push repo to GitHub
2. Go to netlify.com → New site → Import from GitHub
3. Select repo — build settings auto-detected from `netlify.toml`
4. Add environment variables in Netlify dashboard → Site Settings → Environment Variables:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com
   - `ALLOWED_ORIGIN` = your Netlify URL (e.g. `https://aptopro.netlify.app`)
5. Deploy

**Option B — Netlify CLI:**
```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

---

## Environment Variables

Set these in Netlify dashboard → Site Settings → Environment Variables:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `ALLOWED_ORIGIN` | Your site URL (for CORS) |
| `STRIPE_SECRET_KEY` | Stripe secret key (Phase 5) |
| `SUPABASE_URL` | Supabase project URL (Phase 5) |
| `SUPABASE_ANON_KEY` | Supabase anon key (Phase 5) |

---

## Architecture

```
Browser → /api/analyse-lead → Netlify Function → Anthropic API
                ↑
         API key never
         reaches browser
```

The serverless function in `netlify/functions/analyse-lead.js` acts as a secure proxy. The Anthropic API key lives only in Netlify's environment — never in client-side code.

---

## Phases

| Phase | Status | Description |
|---|---|---|
| 1 | ✅ Complete | Marketing site |
| 2 | ✅ Complete | Auth + dashboard shell |
| 3 | ✅ Complete | AI lead engine (Claude-powered) |
| 4 | ✅ Complete | Deployment config + secure API proxy |
| 5 | 🔜 Next | Supabase auth + Stripe billing |
| 6 | 🔜 Planned | Real-time lead scanner |
| 7 | 🔜 Planned | Mobile app |

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | HTML/CSS/JS | Zero build complexity, instant Netlify deploy |
| Serverless | Netlify Functions (Node.js) | API key proxy, future webhooks |
| AI | Anthropic Claude (Sonnet 4.6) | Best-in-class reasoning for lead analysis |
| Auth | Supabase (Phase 5) | Postgres + auth + realtime, generous free tier |
| Payments | Stripe (Phase 5) | Industry standard for SaaS subscriptions |
| Hosting | Netlify | CDN, functions, deploy previews, free tier |
| Email | Resend (Phase 5) | Developer-friendly transactional email |

---

## Brand

- **Primary:** Deep Navy `#1B2B5E`
- **Accent:** Construction Yellow `#F5C518`
- **Warm:** Orange `#C4541A`
- **Font:** Plus Jakarta Sans (headings) + Inter (body)
- **Mascot:** The APTO Pro character — used throughout the platform

---

*Built with Claude AI · Deployed on Netlify · Made in the UK 🇬🇧*
