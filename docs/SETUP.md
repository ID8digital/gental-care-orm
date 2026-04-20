# Gental Care ORM Engine — Setup & Handoff Guide
### Bidco Africa · Managed by ID8 Digital

---

## What this system does

Every comment, DM, ad comment, and mention on Gental Care's Facebook and Instagram
is automatically picked up, classified by Claude AI, and either:
- **Auto-replied** with an on-brand response (71% of queries)
- **Escalated** to a Zoho Desk ticket for human review (product complaints, sensitive queries)
- **Hidden/deleted** automatically (spam, betting links)
- **Liked** (positive comments)

TikTok comments on your own videos are also processed once the TikTok API is approved.

---

## File structure

```
gental-care-orm/
├── server/
│   ├── index.js          ← Main webhook server (Node.js)
│   ├── package.json      ← Dependencies
│   └── test-local.js     ← Run before deploying to test Claude
├── dashboard/
│   └── index.html        ← Management dashboard (open in browser)
├── .env.example          ← Template for all environment variables
├── render.yaml           ← Render.com deployment config
└── docs/
    └── SETUP.md          ← This file
```

---

## Who does what

| Person | Responsibility |
|---|---|
| **Tech person** (1–2 hrs) | Deploy to Render, set env vars, connect Meta app |
| **Team manager** | Open dashboard/index.html, monitor escalations daily |
| **Social team** | Handle Zoho Desk tickets for escalated queries |
| **ID8 Digital** | Update workflows, add new brands, monthly review |

---

## Step-by-step deployment

### Step 1 — Upload to GitHub
Push the `gental-care-orm/` folder to a new private GitHub repo.

### Step 2 — Deploy on Render (free tier)
1. Go to render.com → New → Web Service
2. Connect your GitHub repo
3. Render detects `render.yaml` automatically
4. Region: Singapore (closest to Kenya)
5. Click Deploy

Your server will be live at:
`https://gental-care-orm-engine.onrender.com`

### Step 3 — Set environment variables in Render
In Render → your service → Environment tab, add:

**Required for MVP:**
```
ANTHROPIC_API_KEY     = sk-ant-...
META_APP_SECRET       = (from Meta Developer portal)
META_PAGE_ACCESS_TOKEN = (long-lived page token)
META_VERIFY_TOKEN     = gental_care_webhook_2025
```

**Add later:**
```
ZOHO_OAUTH_TOKEN      = (from Zoho Desk)
ZOHO_ORG_ID           = (from Zoho settings)
ZOHO_DEPARTMENT_ID    = (Gental Care dept ID)
TIKTOK_ACCESS_TOKEN   = (after TikTok app approval)
```

### Step 4 — Create Meta Developer App
1. Go to developers.facebook.com
2. Create App → Business type
3. Add "Webhooks" product
4. Subscribe to Page events: `messages`, `feed`, `mention`
5. Add Instagram Graph API → subscribe to `comments`, `messages`
6. Webhook URL: `https://gental-care-orm-engine.onrender.com/webhook/meta`
7. Verify token: `gental_care_webhook_2025`

### Step 5 — Get a Page Access Token
1. Meta Graph API Explorer → select Gental Care Page
2. Generate token with permissions: `pages_manage_engagement`, `pages_messaging`, `pages_read_engagement`
3. Extend to long-lived token (60 days) via token debugger
4. For permanent token: use a System User token (recommended for production)

### Step 6 — Test it works
1. Comment on a Gental Care post from a test account
2. Check Render logs — you should see the webhook fire
3. Wait ~10 seconds — auto-reply should appear
4. Check `/health` endpoint for integration status

### Step 7 — Submit Meta App for Review
For replying to comments from accounts other than the Page admin, Meta requires app review.
Submit for: `pages_manage_engagement`, `pages_messaging`
Review time: 1–5 business days.
During review, test only with Page admin account.

---

## Monthly maintenance

- **Renew Page Access Token** every 60 days (or set up auto-renewal)
- **Review escalation patterns** — if the same type of query keeps escalating, add it to the workflow
- **Check Render logs** monthly for errors
- **Zoho OAuth token** may need renewal — set calendar reminder at 90 days

---

## Adding another Bidco brand

1. In `server/index.js`, the `BRAND_CONTEXT` constant holds all brand knowledge
2. Duplicate and update it for the new brand (e.g. Msafi, Noodies)
3. Add a new webhook route in `index.js` (e.g. `/webhook/meta/msafi`)
4. Create a new Meta App subscription for that brand's page
5. Update the dashboard with the new brand tab

---

## Costs

| Item | Cost |
|---|---|
| Render (starter plan) | $7/month |
| Anthropic Claude API | ~$0.003 per query · ~$5–15/month for Gental Care volume |
| Meta Webhooks | Free |
| TikTok API | Free |
| Zoho Desk | Your existing licence |
| **Total running cost** | **~$15–25/month** |

---

## Support

For technical issues: check Render logs first (`Logs` tab in Render dashboard).
For workflow updates (new response templates): contact ID8 Digital.
For Meta/TikTok API issues: developers.facebook.com/support
