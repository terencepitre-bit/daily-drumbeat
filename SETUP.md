# The Daily Drumbeat — Automation Setup

You will do five things, none of which involve writing code: (1) get four free API keys,
(2) create a Brevo signup form and copy its link into two files, (3) put everything into
a GitHub repo, (4) paste the keys into GitHub as "secrets," (5) tell Netlify to deploy
from that repo. After that, it runs itself every weekday at ~6am.

## What this replaces
Your Perplexity setup was searching and writing ~25+ full stories a day. This
does 5, using Claude (much cheaper per run) with real web search built in, and
throws out any story where a source link doesn't actually load.

## Cost estimate
- Claude API: roughly $0.05–$0.20 per day → **$1–$5/month**
- GitHub: free (public or private repo, this workflow uses ~2 min/day, way under the free 2,000 min/month)
- Netlify: free tier, same as you have now
- Brevo: free tier covers up to 300 emails/day and 9,000/month — fine unless your list gets large
- **Total: comfortably under $10/month**, well inside your $50 budget.

---

## What's actually in an issue now (the "5+2+2+1")
- **5 stories** — Business, Policy & Justice (runs every day, no exceptions), Economy & Labor, HBCUs & Education, Black Excellence. Written by Claude, each with 2 checked sources.
- **2 automated data boxes** — Money Moves (S&P 500, Dow, 30-yr mortgage rate, CPI, BTC/ETH, and your three Black-owned stock tickers UONE/RLJ/CARV) and Sports (HBCU scoreboard + last night's/tonight's major games). No AI involved — straight from free data feeds.
- **2 brief voice blocks** — "This Day in Legacy" (a Black-history event that happened on today's date, pulled from Wikipedia) and "The Number" (alternates daily between the mortgage rate and the Black homeownership rate). Also no AI.
- **1 closer** — a short joy/community story or a brief quote, with a "Copy link — via thedailydrumbeat.com" button.

## The redesign (two-column layout + Green Book)
The site now matches the two-column magazine layout, with a few structural changes:
- **`index.html`** is now the "Landing" page (hero + section previews + inline subscribe box).
- **`today.html`** is a stable link that always shows the latest edition — this is what "Today's Edition" in the nav points to. It gets overwritten every morning.
- **`issues/YYYY-MM-DD.html`** is still the permanent, dated archive copy of each edition.
- **`assets/drumbeat.css`** is the one shared stylesheet every page links to. Change a color or font here once and it updates everywhere.
- **Corrections** moved out of the top nav (to match the new design) but is still linked in every page footer.

## The Green Book — you maintain this, not AI
Open **`green-book/listings.json`** any time to change what shows as "Business of the Day" and "Opportunity." The script always features whatever is *first* in each list — add a new entry above an old one to swap it, or remove entries you're done running. Delete the two sample entries before going live; they're clearly marked `SAMPLE —` so you can't miss them. This file is never touched by Claude — what you put in is exactly what publishes.

## Setting up the Advertise page's inquiry form
`advertise.html` has a free contact form (via Netlify Forms — no extra account, no code). To get notified when someone submits it:
1. Deploy the site to Netlify as normal (Step 5 below).
2. In Netlify: **Site settings → Forms** — you should see "advertise-inquiry" listed automatically after your first deploy.
3. **Forms → Form notifications → Add notification → Email notification** — put in your email so you hear about inquiries right away.
Netlify's free tier includes 100 form submissions a month, which is far more than you'll need at this stage.


## Step 1 — Get an Anthropic (Claude) API key
1. Go to https://console.anthropic.com and sign up / log in.
2. Add a small amount of credit (e.g. $10 — it'll last months at this volume).
3. Go to **Settings → API Keys → Create Key**. Copy it somewhere safe — you can't view it again.

## Step 1b — Get a FRED API key (free, powers most of the data boxes)
1. Go to https://fredaccount.stlouisfed.org, create a free account.
2. Once logged in, go to **My Account → API Keys → Request API Key**.
3. Copy the key. This one key covers the mortgage rate, S&P 500, Dow, CPI, and Black homeownership rate — you don't need separate accounts for each.

## Step 1c — Get a Finnhub API key (free, powers UONE/RLJ/CARV)
1. Go to https://finnhub.io/register, sign up free.
2. Your API key is shown right on your dashboard after signup. Copy it.
(You mentioned already having accounts for mortgage rate and Black stock data — if those are FRED and Finnhub, you can reuse those same keys here instead of making new ones.)

## Step 2 — Get your Brevo details + create your signup form
1. Log into Brevo.
2. **Contacts → Lists** — open or create the list you want subscribers to land in. Note the **List ID** (a number, shown in the list settings).
3. **Settings → SMTP & API → API Keys** — create a key, copy it. (This key is only used by the GitHub Action to *send* the daily email — it never touches your website, so there's no security exposure on the site itself.)
4. **Senders** — make sure the "from" email address you want (e.g. `news@thedailydrumbeat.com`) is a verified sender in Brevo.
5. **Contacts → Forms → Create a form.** Pick the list from step 2 as the destination, style it if you want (or leave defaults), and click **Publish**.
6. On the published form's page, copy the **shareable link** (Brevo shows this right after publishing — it looks like `https://sibforms.com/serve/...`). This is the only new thing you need — a plain link, no code.

## Step 2b — Drop your Brevo link into the site (two places, one time only)
1. Open **`subscribe.html`** in GitHub's editor (or on your computer before uploading). Find the text `PASTE_YOUR_BREVO_FORM_LINK_HERE` and replace it with the link from Step 2, step 6.
2. Open **`scripts/generate-issue.mjs`**, search for `PASTE_YOUR_BREVO_FORM_LINK_HERE` (it appears once, inside the landing-page template), and replace it there too. This is the only reason you'd ever edit that file by hand — everything else in it runs itself.
Both "Subscribe" buttons across the site now point straight to your real Brevo form. No API key, no custom code, and Brevo handles unsubscribes, double opt-in, and compliance for you automatically.

## Step 3 — Put everything in GitHub
1. Go to https://github.com, create a free account if needed, then **New repository** (name it e.g. `daily-drumbeat`, keep it private if you prefer).
2. On the repo page, use **"Add file → Upload files"** and drag in every file from the zip (after doing Step 2b above).
3. Commit the upload.

## Step 4 — Add your keys as GitHub Secrets
In your new repo: **Settings → Secrets and variables → Actions → New repository secret**. Add each of these one at a time:

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the key from Step 1 |
| `FRED_API_KEY` | the key from Step 1b |
| `FINNHUB_API_KEY` | the key from Step 1c |
| `BREVO_API_KEY` | the key from Step 2 |
| `BREVO_LIST_ID` | the list ID number from Step 2 |
| `BREVO_SENDER_EMAIL` | your verified sender email from Step 2 |

These four Brevo/data keys are only ever used inside GitHub's automation — none of them are exposed on the public website.

## Step 5 — Connect Netlify to this repo
1. In Netlify: **Add new site → Import an existing project → GitHub** → pick your `daily-drumbeat` repo.
2. Build settings: leave "Build command" blank, "Publish directory" = `.` (this matches your existing `netlify.toml`, so it should auto-fill correctly).
3. Deploy. That's it — no environment variables needed on the Netlify side anymore, since subscriptions now go straight to Brevo's own hosted form instead of running through a custom function.

## Step 6 — Test it before waiting for 6am
1. In your GitHub repo, go to the **Actions** tab → **Daily Drumbeat Issue** → **Run workflow** (this is the manual trigger, top right).
2. Watch it run (takes ~1-2 minutes). Green check = it worked, and you'll see a new commit with today's issue.
3. Check your live Netlify site — the homepage and archive should now show today's issue, and a real email should land if your Brevo list has a test contact in it.
4. Click the Subscribe button anywhere on the site and confirm it lands on your real Brevo form.


## Where the 5 stories come from
The prompt Claude uses to pick and write the stories lives in
`scripts/generate-issue.mjs`, in the `CURATION_PROMPT` constant near the top.
You can open that file right on GitHub and edit that block of text any time —
no coding needed, it's just instructions in plain English. For example you
could add "always include one HBCU sports story" or "avoid celebrity gossip
entirely."

## About sources and site attribution
Every story ships with exactly 2 real, link-checked sources under it, labeled
"Sources:". Each issue page and every email also carries "The Daily Drumbeat"
branding and links back to thedailydrumbeat.com in the footer and in the
"Copy for social" box, so anything reposted still points back to the site.

## Data box sources, for reference
- Money Moves: FRED (mortgage rate, S&P 500, Dow, CPI), CoinGecko (BTC/ETH, no key needed), Finnhub (UONE/RLJ/CARV)
- Sports: ESPN's public scoreboard data, filtered against a list of HBCU school names built into the script
- This Day in Legacy: Wikipedia's "On this day" feed, filtered for Black-history keywords
- The Number: FRED, alternating daily between the mortgage rate and Black homeownership rate

If a data source is briefly down, that one box just doesn't appear that day — it won't break
the rest of the issue.
