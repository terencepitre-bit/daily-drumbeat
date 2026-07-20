// generate-issue.mjs — two-column magazine edition
//
// Content structure (5+2+2+1), unchanged from before:
//   5 = five AI-curated stories   2 = Money Moves + Sports (no AI)
//   2 = This Day in Legacy + The Number (no AI)   1 = closer (AI)
//
// NEW in this version:
//   - Visual design now matches the two-column magazine layout (assets/drumbeat.css)
//   - Green Book section (Business of the Day + Opportunity board) — reads
//     green-book/listings.json, which YOU maintain by hand. Never AI-written.
//   - Writes both issues/YYYY-MM-DD.html (permanent archive copy) AND
//     today.html (stable URL that always shows the latest edition)
//   - index.html is now a separate "Landing" page, not the issue itself

import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

// ---------- CONFIG ----------
const SITE_NAME = "The Daily Drumbeat";
const SITE_URL = "https://thedailydrumbeat.com";
const MODEL = "claude-haiku-4-5-20251001";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FRED_API_KEY = process.env.FRED_API_KEY;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_LIST_ID = process.env.BREVO_LIST_ID;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || SITE_NAME;

const STORY_SECTIONS = [
  { code: "P1", name: "Business & Enterprise", required: false },
  { code: "P2", name: "Policy & Justice", required: true },
  { code: "P3", name: "Economy & Work", required: false },
  { code: "P5", name: "HBCUs & Education", required: false },
  { code: "P11", name: "Black Excellence", required: false }
];

function todayParts(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  const iso = now.toISOString().slice(0, 10);
  const label = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return { iso, label, mm, dd, dayOfYear: Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000) };
}

async function safeFetchJson(url, opts = {}, label = url) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[data] ${label} failed: ${err.message}`);
    return null;
  }
}

// =========================================================
// DATA BOXES — no AI cost (unchanged logic from previous version)
// =========================================================
async function fredLatest(seriesId, extraParams = "") {
  if (!FRED_API_KEY) return null;
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=1${extraParams}`;
  const data = await safeFetchJson(url, {}, `FRED ${seriesId}`);
  const obs = data?.observations?.[0];
  return obs && obs.value !== "." ? { value: obs.value, date: obs.date } : null;
}

async function fetchFinnhubQuote(symbol) {
  if (!FINNHUB_API_KEY) return {};
  const data = await safeFetchJson(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`, {}, `Finnhub ${symbol}`);
  if (!data || data.c == null) return {};
  return { price: data.c, changePct: data.dp };
}

async function fetchMoneyMoves() {
  const [mortgage, sp500, dow, cpiYoy, unone, rlj, carv, crypto] = await Promise.all([
    fredLatest("MORTGAGE30US"), fredLatest("SP500"), fredLatest("DJIA"),
    fredLatest("CPIAUCSL", "&units=pc1"),
    fetchFinnhubQuote("UONE"), fetchFinnhubQuote("RLJ"), fetchFinnhubQuote("CARV"),
    safeFetchJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd", {}, "CoinGecko")
  ]);
  return {
    mortgage30yr: mortgage?.value ? `${Number(mortgage.value).toFixed(2)}%` : null,
    sp500: sp500?.value ? Number(sp500.value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : null,
    dow: dow?.value ? Number(dow.value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : null,
    cpiYoy: cpiYoy?.value ? `${Number(cpiYoy.value).toFixed(1)}%` : null,
    btc: crypto?.bitcoin?.usd ? `$${Math.round(crypto.bitcoin.usd).toLocaleString()}` : null,
    eth: crypto?.ethereum?.usd ? `$${Math.round(crypto.ethereum.usd).toLocaleString()}` : null,
    tickers: [{ symbol: "UONE", ...unone }, { symbol: "RLJ", ...rlj }, { symbol: "CARV", ...carv }].filter(t => t.price != null)
  };
}

const HBCU_SCHOOLS = [
  "Alabama A&M", "Alabama State", "Alcorn State", "Arkansas-Pine Bluff", "Bethune-Cookman",
  "Bowie State", "Coppin State", "Delaware State", "Elizabeth City State", "Fayetteville State",
  "Florida A&M", "Grambling", "Hampton", "Howard", "Jackson State", "Johnson C. Smith",
  "Lincoln (PA)", "Livingstone", "Mississippi Valley State", "Morehouse", "Morgan State",
  "Norfolk State", "North Carolina A&T", "North Carolina Central", "Prairie View A&M",
  "Savannah State", "Shaw", "South Carolina State", "Southern University", "Southern",
  "Tennessee State", "Texas Southern", "Tuskegee", "Virginia State", "Virginia Union",
  "Winston-Salem State"
];

async function fetchEspnScoreboard(sportPath, dateIso) {
  const dateParam = dateIso ? `?dates=${dateIso.replace(/-/g, "")}&limit=200` : "?limit=200";
  const data = await safeFetchJson(`https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard${dateParam}`, {}, `ESPN ${sportPath}`);
  return data?.events || [];
}
function summarizeGame(ev) {
  const comp = ev.competitions?.[0];
  const [a, b] = comp?.competitors || [];
  if (!a || !b) return null;
  const state = ev.status?.type?.state;
  const scoreStr = state === "pre" ? "" : ` ${a.score}-${b.score}`;
  const when = state === "pre" ? ` (${new Date(ev.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} ET)` : state === "in" ? " (live)" : " (final)";
  return `${a.team.shortDisplayName} vs ${b.team.shortDisplayName}${scoreStr}${when}`;
}
async function fetchSportsBox() {
  const { iso: todayIso } = todayParts(0);
  const { iso: yestIso } = todayParts(-1);
  const hbcuPaths = ["football/college-football", "basketball/mens-college-basketball", "basketball/womens-college-basketball"];
  const hbcuGamesRaw = (await Promise.all(hbcuPaths.flatMap(p => [fetchEspnScoreboard(p, todayIso), fetchEspnScoreboard(p, yestIso)]))).flat();
  const hbcuGames = hbcuGamesRaw.filter(ev => {
    const names = ev.competitions?.[0]?.competitors?.map(c => c.team.displayName).join(" ") || "";
    return HBCU_SCHOOLS.some(school => names.includes(school));
  }).map(summarizeGame).filter(Boolean).slice(0, 5);

  const majorPaths = ["football/nfl", "basketball/nba", "baseball/mlb", "hockey/nhl"];
  const lastNightRaw = (await Promise.all(majorPaths.map(p => fetchEspnScoreboard(p, yestIso)))).flat();
  const lastNight = lastNightRaw.filter(ev => ev.status?.type?.state === "post").map(summarizeGame).filter(Boolean).slice(0, 4);
  const onDeckRaw = (await Promise.all(majorPaths.map(p => fetchEspnScoreboard(p, todayIso)))).flat();
  const onDeck = onDeckRaw.filter(ev => ev.status?.type?.state === "pre").map(summarizeGame).filter(Boolean).slice(0, 4);

  return { hbcuGames, lastNight, onDeck };
}

const LEGACY_KEYWORDS = /african|black|slave|civil rights|jim crow|naacp|segregat|harlem renaissance|negro|colored|freedmen|apartheid|jamaica|haiti|caribbean|pan-african|reparations|underground railroad/i;
async function fetchThisDayInLegacy() {
  const { mm, dd } = todayParts(0);
  const data = await safeFetchJson(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`, { headers: { "User-Agent": `${SITE_NAME} (${SITE_URL})` } }, "Wikipedia On This Day");
  if (!data) return null;
  const hit = (data.events || []).find(e => LEGACY_KEYWORDS.test(e.text || "") || (e.pages || []).some(p => LEGACY_KEYWORDS.test(p.extract || p.description || "")));
  if (!hit) return null;
  const link = hit.pages?.[0]?.content_urls?.desktop?.page || "https://en.wikipedia.org/wiki/Portal:Black_history";
  return { year: hit.year, text: hit.text, url: link };
}
async function fetchTheNumber(dayOfYear) {
  if (dayOfYear % 2 === 0) {
    const m = await fredLatest("MORTGAGE30US");
    return m ? { label: "30-yr mortgage avg", value: `${Number(m.value).toFixed(2)}%`, source: "FRED" } : null;
  } else {
    const h = await fredLatest("BOAAAHORUSQ156N");
    return h ? { label: "Black homeownership", value: `${Number(h.value).toFixed(1)}%`, source: "Census via FRED" } : null;
  }
}

// ---- Green Book: reads YOUR file, never AI-generated ----
async function fetchGreenBook() {
  try {
    const raw = await readFile("green-book/listings.json", "utf-8");
    const data = JSON.parse(raw);
    return {
      business: data.businessOfTheDay?.[0] || null,
      opportunity: data.opportunities?.[0] || null
    };
  } catch {
    console.warn("[data] green-book/listings.json missing or invalid - skipping Green Book box");
    return { business: null, opportunity: null };
  }
}

// =========================================================
// 5 STORIES + 1 CLOSER — only part that calls Claude
// =========================================================
const CURATION_PROMPT = `You are the morning news curator for ${SITE_NAME}, a free daily newsletter
covering news that materially affects Black America.

Use the web_search tool to find real news published in the last 24-48 hours.

Curate exactly 5 stories, one for each of these sections:
${STORY_SECTIONS.map(s => `- ${s.code}: ${s.name}${s.required ? " (MUST run every single day, even on a slow news day)" : ""}`).join("\n")}
If P11 (Black Excellence) has more real wins than usual, you may run it twice and skip a
non-required section instead, but you must still produce exactly 5 stories total.

ALSO curate exactly 1 "closer": either a short uplifting Culture & Community or Health &
Wellness story, OR a brief attributed quote (under 15 words, from a real historical or
contemporary Black figure) meant to end the newsletter on joy or community rather than news.

For EACH of the 5 stories you must have called web_search and found at least 2 separate
outlets reporting on it, or one outlet plus one primary source. NEVER invent a URL — only
cite URLs that actually appeared in your own web_search results this run.

Output ONLY valid JSON, no markdown fences, no commentary, exactly this shape:
{
  "stories": [
    { "section": "P1", "headline": "...", "blurb": "2-3 original sentences, 25-70 words",
      "sources": [{"name":"...","url":"..."},{"name":"...","url":"..."}] }
  ],
  "closer": {
    "type": "story" or "quote",
    "headline": "only if type is story",
    "text": "the blurb, or the quote itself",
    "attribution": "only if type is quote - who said it",
    "sources": [{"name":"...","url":"..."}]
  }
}

Rules:
- Exactly 5 stories, each with exactly 2 sources (P2 Policy & Justice is mandatory).
- Blurbs are summaries in your own words, never close paraphrases of source wording.
- No opinion pieces presented as news, no tabloid gossip.
- Headlines under 12 words.`;

async function curateContent() {
  const { label } = todayParts(0);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4000, system: CURATION_PROMPT,
      messages: [{ role: "user", content: `Today is ${label}. Curate today's 5 stories and 1 closer now.` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 18 }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const textBlocks = data.content.filter(b => b.type === "text").map(b => b.text);
  const raw = textBlocks[textBlocks.length - 1] || "";
  // Extract just the {...} object even if Claude added a sentence before/after it
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) throw new Error(`No JSON object found in Claude's response: ${raw.slice(0, 300)}`);
  const jsonStr = raw.slice(jsonStart, jsonEnd + 1);
  return JSON.parse(jsonStr);
}
async function urlIsAlive(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" }
    });
    return res.status < 400;
  } catch { return false; }
}
async function validateStories(stories) {
  const kept = [];
  for (const s of stories) {
    if (!s.sources || s.sources.length < 2) continue;
    const checks = await Promise.all(s.sources.map(src => urlIsAlive(src.url)));
    if (checks.every(Boolean)) kept.push(s); else console.warn(`Dropped story "${s.headline}" - a source link failed`);
  }
  return kept;
}

// =========================================================
// HTML BUILDING — new two-column design
// =========================================================
function sectionLabel(code) { return STORY_SECTIONS.find(s => s.code === code)?.name || code; }

function pageHead(title) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — ${SITE_NAME}</title>
<link rel="stylesheet" href="assets/drumbeat.css"></head>
<body>`;
}
function header(active) {
  const items = [["index.html", "Landing"], ["today.html", "Today's Edition"], ["archive.html", "Archive"], ["manifesto.html", "About"], ["advertise.html", "Advertise"]];
  return `<div class="site-header">
    <a href="index.html" class="logo">THE DAILY <span class="D">D</span>RUMBEAT</a>
    <div class="nav">${items.map(([href, label]) => `<a href="${href}"${href === active ? ' class="active"' : ""}>${label}</a>`).join("")}</div>
  </div>`;
}
function footer() {
  return `<div class="site-footer">
    <div class="logo2">THE DAILY <span class="D">D</span>RUMBEAT</div>
    <div class="fine">News about us. For us. By the beat of the drum.<br>
      <a href="corrections.html">Corrections: corrections@thedailydrumbeat.com</a>
      &nbsp;|&nbsp; All sources free to access &nbsp;|&nbsp; A Pitre Media publication</div>
  </div>`;
}

function storyBlock(s) {
  const sources = s.sources.map(src => `<span class="pill">[${src.name}]</span>`).join(" ");
  return `<div class="story">
    <div class="tag">[ ${s.section} &middot; ${sectionLabel(s.section).toUpperCase()} ]</div>
    <h2>${s.headline}</h2>
    <p>${s.blurb}</p>
    <div class="story-footer">
      <div class="sources"><span class="label">Sources</span> ${sources}</div>
      <button class="copy-link" onclick="navigator.clipboard.writeText('${(s.headline + " — " + s.sources[0].url).replace(/'/g, "&#39;")}'); this.textContent='Copied';">Copy Link</button>
    </div>
  </div>`;
}

function moneyMovesBox(m) {
  const rows = [];
  if (m.sp500) rows.push(["S&P 500", m.sp500, ""]);
  if (m.dow) rows.push(["Dow Jones", m.dow, ""]);
  if (m.mortgage30yr) rows.push(["30-Yr Mortgage", m.mortgage30yr, "FRED / Freddie Mac"]);
  if (m.cpiYoy) rows.push(["CPI (YoY)", m.cpiYoy, "BLS via FRED"]);
  if (m.btc) rows.push(["Bitcoin", m.btc, "CoinGecko"]);
  if (m.eth) rows.push(["Ethereum", m.eth, "CoinGecko"]);
  if (!rows.length && !m.tickers.length) return "";
  const tickerRows = m.tickers.map(t => {
    const dir = t.changePct >= 0 ? "change-up" : "change-down";
    return `<tr><td class="asset">${t.symbol}</td><td>$${t.price.toFixed(2)}</td><td class="${dir}">${t.changePct >= 0 ? "+" : ""}${t.changePct.toFixed(1)}%</td></tr>`;
  }).join("");
  return `<div class="box">
    <div class="box-head">
      <div class="tag">[ P4 &middot; MONEY MOVES ]</div>
      <span class="badge">Auto via free APIs — zero credits</span>
    </div>
    <table>${rows.map(([a, v, s]) => `<tr><td class="asset">${a}</td><td>${v}</td><td class="source-note">${s}</td></tr>`).join("")}</table>
    ${m.tickers.length ? `<div style="margin-top:14px; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--muted);">Black Wall Street Watch</div><table style="margin-top:6px;">${tickerRows}</table>` : ""}
    <div class="sponsor-note">Data via Finnhub (free), FRED (free), CoinGecko (free) &middot; <a href="advertise.html">Sponsor this box</a></div>
  </div>`;
}

function sportsBox(s) {
  if (!s.hbcuGames.length && !s.lastNight.length && !s.onDeck.length) return "";
  const list = (arr) => arr.map(g => `<div style="padding:6px 0; border-bottom:1px solid var(--border); font-size:14px;">${g}</div>`).join("");
  return `<div class="box">
    <div class="box-head">
      <div class="tag">[ P6 &middot; HBCU SPORTS ONLY ]</div>
      <span class="badge">Auto via ESPN API — free</span>
    </div>
    ${s.hbcuGames.length ? list(s.hbcuGames) : `<div style="font-size:13px; color:var(--muted);">No HBCU games found today.</div>`}
    ${s.lastNight.length || s.onDeck.length ? `<div style="margin-top:14px; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--muted);">Majors — last night / on deck</div>${list([...s.lastNight, ...s.onDeck])}` : ""}
  </div>`;
}

function greenBookBox(gb) {
  if (!gb.business && !gb.opportunity) return "";
  return `<div class="box">
    <div class="box-head">
      <div class="tag">[ GB &middot; THE GREEN BOOK ]</div>
      <span class="badge">Sponsored</span>
    </div>
    ${gb.business ? `
    <div class="tag" style="font-size:11px;">Business of the Day</div>
    <h3 style="margin:6px 0 4px; font-size:17px;">${gb.business.name}</h3>
    <div style="font-size:13px; color:var(--muted); margin-bottom:8px;">${gb.business.tagline || ""}</div>
    <p style="font-size:14px; line-height:1.6;">${gb.business.description || ""}</p>
    ${gb.business.discountCode ? `<p style="font-size:13px; font-style:italic;">${gb.business.discountCode}</p>` : ""}
    <a href="${gb.business.url}" style="font-size:12px; font-weight:700; letter-spacing:1px; text-transform:uppercase; text-decoration:underline;">${gb.business.cta || "Visit Business"} &rarr;</a>
    ` : ""}
    ${gb.opportunity ? `
    <div style="border-top:1px solid var(--border); margin-top:18px; padding-top:16px;">
      <div class="tag" style="font-size:11px;">Opportunity</div>
      <h3 style="margin:6px 0 4px; font-size:17px;">${gb.opportunity.title} &mdash; ${gb.opportunity.amount}${gb.opportunity.deadline ? ` &mdash; Deadline ${gb.opportunity.deadline}` : ""}</h3>
      <p style="font-size:14px; line-height:1.6;">${gb.opportunity.description || ""}</p>
      <a href="${gb.opportunity.url}" style="font-size:12px; font-weight:700; letter-spacing:1px; text-transform:uppercase; text-decoration:underline;">${gb.opportunity.cta || "Apply"} &rarr;</a>
    </div>` : ""}
    <div class="sponsor-note">Free + monetizable &middot; Want to be featured? <a href="advertise.html">Advertise</a></div>
  </div>
  <div class="box" style="text-align:center; border-style:dashed; color:var(--muted); font-size:12px; letter-spacing:1px; text-transform:uppercase;">Ad Slot — Money Moves Sponsor &middot; 300x100 &middot; <a href="advertise.html" style="color:var(--red);">Available</a></div>`;
}

function drumRoll(legacy, theNumber) {
  return `<div class="drumroll">
    <div class="drumroll-head"><div class="dot">D</div><h3>The Drum Roll</h3></div>
    <div class="drumroll-body">
      <div>
        <div class="kicker">The Number</div>
        ${theNumber ? `<div class="big">${theNumber.value} &mdash; ${theNumber.label}</div><div class="note">[${theNumber.source}]</div>` : `<div class="note">Not available today.</div>`}
      </div>
      <div>
        <div class="kicker">This Day in Legacy</div>
        ${legacy ? `<div class="big" style="font-size:16px; font-weight:400; line-height:1.6;"><b>${legacy.year}</b> &mdash; ${legacy.text} <a href="${legacy.url}" style="color:var(--red); font-size:12px;">[More]</a></div>` : `<div class="note">Not available today.</div>`}
      </div>
    </div>
  </div>`;
}

function closerBlock(closer, issueUrl) {
  if (!closer) return "";
  const shareText = `via Drumbeat: ${closer.type === "quote" ? `"${closer.text}" — ${closer.attribution}` : closer.text} ${issueUrl}`.replace(/'/g, "&#39;");
  const body = closer.type === "quote"
    ? `<div class="serif" style="font-style:italic; font-size:22px;">&ldquo;${closer.text}&rdquo;</div><div style="font-size:14px; color:var(--muted); margin-top:8px;">&mdash; ${closer.attribution}</div>`
    : `<h3 style="margin:0;">${closer.headline}</h3><p style="margin-top:8px;">${closer.text}</p>`;
  return `<div class="box" style="text-align:center;">
    ${body}
    <button class="copy-link" style="margin-top:14px;" onclick="navigator.clipboard.writeText('${shareText}'); this.textContent='Copied';">Copy Link — via thedailydrumbeat.com</button>
  </div>`;
}

function todayEditionHtml({ dateLabel, volume, stories, closer, moneyMoves, sports, legacy, theNumber, greenBook, issueUrl, storyCount }) {
  return `${pageHead(dateLabel)}
  ${header("today.html")}
  <div class="wrap" style="padding-top:40px;">
    <div class="hero" style="padding-top:0;">
      <div class="maintitle" style="font-size:40px;">THE DAILY <span class="D">D</span>RUMBEAT</div>
      <div class="hero .volbar" style="max-width:760px; margin:20px auto 0; border-top:1px solid var(--ink); border-bottom:1px solid var(--ink); padding:10px 0; font-size:13px; letter-spacing:2px; text-transform:uppercase; color:var(--muted);">TODAY'S EDITION &mdash; ${volume} &mdash; ${dateLabel}</div>
      <div class="stats"><span class="pill">${storyCount} stories</span><span class="pill">8 sections</span><span class="pill">5 min</span></div>
    </div>

    <div class="two-col" style="margin-top:40px;">
      <div>${stories.map(storyBlock).join("\n        ")}</div>
      <div>
        ${moneyMovesBox(moneyMoves)}
        ${sportsBox(sports)}
        ${greenBookBox(greenBook)}
      </div>
    </div>

    ${drumRoll(legacy, theNumber)}
    <div style="margin-top:18px;">${closerBlock(closer, issueUrl)}</div>
  </div>
  ${footer()}
</body></html>`;
}

function landingHtml({ dateLabel, volume, stories, issueUrl, storyCount }) {
  const summary = stories.slice(0, 3).map(s => s.headline).join(", ");
  const sectionCards = [
    ...stories.map(s => [s.section, sectionLabel(s.section), s.headline]),
    ["P4", "Money Moves", "Markets &middot; Mortgage &middot; Crypto"],
    ["P6", "Sports", "HBCU sports only"],
    ["GB", "The Green Book", "Business of the day + grant"]
  ];
  return `${pageHead("Landing")}
  ${header("index.html")}
  <div class="hero">
    <div class="maintitle">THE DAILY <span class="D">D</span>RUMBEAT</div>
    <div class="tagline">News about us. For us. By the beat of the drum.</div>
    <div class="volbar">${volume} &mdash; ${dateLabel}</div>
    <div class="summary">In today&rsquo;s Drumbeat: ${summary}.</div>
    <a href="today.html" class="btn-primary">Read Today's Edition &rarr;</a>
    <div class="stats"><span class="pill">${storyCount} stories</span><span class="pill">8 sections</span><span class="pill">five minutes</span><span class="pill">The Drum Roll + Green Book</span></div>
  </div>

  <div class="inside-today wrap">
    <h3>Inside Today</h3>
    <div class="sub">All 8 sections</div>
    <div class="section-grid">
      ${sectionCards.map(([code, name, preview]) => `<a href="today.html"><div class="stag">[ ${code} &middot; ${name.toUpperCase()} ]</div><div class="stitle">${preview}</div></a>`).join("\n      ")}
    </div>
  </div>

  <div class="subscribe-box">
    <div>
      <h4>Get the Drumbeat in your inbox</h4>
      <p>Five minutes every weekday. No spam. Unsubscribe anytime.</p>
    </div>
    <a href="https://1a3e105b.sibforms.com/serve/MUIFAIJL5UKBuRKB0t2SMRcCN7dPVIDPS3wraCIqU8bOsCk_66TFY1aS5ovPumAlVJoBIkt2Zlz4Sm1ZQHNhm0siu2bk2mg_JfqsMDb_ZUUMDQ6FFiG9mkYwawb9VGtIkRyftpMI051EtSZvYQxGINXN6a53vz039oP4Oq6JE5YbUko_1Wj8VK1818z-wNjiClOYANVT1k7fwNKYyw==" class="btn-primary" style="margin-top:0;">Subscribe free &rarr;</a>
  </div>
  ${footer()}
</body></html>`;
}

function archiveHtml(manifest) {
  const rows = manifest.map(e => `<a href="${e.file}" class="archive-row">
      <span class="d">${e.dateLabel}</span><span class="v">${e.volume}</span><span class="c">${e.storyCount} stories &rarr;</span>
      <div class="s">${e.summary}</div>
    </a>`).join("\n    ");
  return `${pageHead("Archive")}
  ${header("archive.html")}
  <div class="wrap" style="max-width:900px; padding-top:56px;">
    <h1 style="font-size:40px;">The Archive</h1>
    <div class="sub" style="font-size:13px; letter-spacing:3px; text-transform:uppercase; color:var(--muted); margin:8px 0 24px;">${manifest.length} editions</div>
    <div>${rows}</div>
  </div>
  ${footer()}
</body></html>`;
}

// =========================================================
// EMAIL
// =========================================================
async function sendBrevoCampaign({ dateLabel, issueUrl, stories, closer }) {
  if (!BREVO_API_KEY || !BREVO_LIST_ID || !BREVO_SENDER_EMAIL) { console.warn("Brevo env vars missing - skipping email send."); return; }
  const htmlContent = `<div style="font-family:Georgia,serif; max-width:600px; margin:0 auto;">
    <h1 style="color:#8E2A2B;">The Daily Drumbeat — ${dateLabel}</h1>
    ${stories.map(s => `<div style="margin-bottom:20px;">
      <div style="font-size:12px; color:#8E2A2B; text-transform:uppercase; letter-spacing:1px;">${sectionLabel(s.section)}</div>
      <h2 style="font-family:Georgia,serif; margin:6px 0;">${s.headline}</h2>
      <p style="font-family:Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6;">${s.blurb}</p>
      <p style="font-size:13px; color:#6E6A60;">Sources: ${s.sources.map(src => `<a href="${src.url}">${src.name}</a>`).join(" &middot; ")}</p>
    </div>`).join("")}
    ${closer ? `<p style="font-style:italic;">${closer.type === "quote" ? `&ldquo;${closer.text}&rdquo; — ${closer.attribution}` : closer.text}</p>` : ""}
    <p><a href="${issueUrl}" style="background:#8E2A2B; color:#fff; padding:12px 24px; text-decoration:none;">Read online</a></p>
    <p style="font-size:12px; color:#6E6A60;">The Daily Drumbeat &middot; ${SITE_URL}</p>
  </div>`;
  const createRes = await fetch("https://api.brevo.com/v3/emailCampaigns", {
    method: "POST", headers: { "content-type": "application/json", "api-key": BREVO_API_KEY },
    body: JSON.stringify({ name: `Drumbeat ${dateLabel}`, subject: `The Daily Drumbeat — ${dateLabel}`, sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL }, type: "classic", htmlContent, recipients: { listIds: [Number(BREVO_LIST_ID)] } })
  });
  if (!createRes.ok) { console.error("Brevo campaign create failed:", await createRes.text()); return; }
  const { id } = await createRes.json();
  const sendRes = await fetch(`https://api.brevo.com/v3/emailCampaigns/${id}/sendNow`, { method: "POST", headers: { "api-key": BREVO_API_KEY } });
  if (!sendRes.ok) console.error("Brevo send failed:", await sendRes.text()); else console.log("Brevo campaign sent.");
}

// =========================================================
// MAIN
// =========================================================
async function main() {
  const { iso, label, dayOfYear } = todayParts(0);

  const [content, moneyMoves, sports, legacy, theNumber, greenBook] = await Promise.all([
    curateContent(), fetchMoneyMoves(), fetchSportsBox(), fetchThisDayInLegacy(), fetchTheNumber(dayOfYear), fetchGreenBook()
  ]);

  const stories = await validateStories(content.stories || []);
  if (stories.length === 0) throw new Error("No stories passed validation today - not publishing.");

  const manifestPath = path.join("issues", "manifest.json");
  let manifest = [];
  try { manifest = JSON.parse(await readFile(manifestPath, "utf-8")); } catch { /* first run */ }

  const volume = `VOL 1 NO ${manifest.length + 1}`;
  const issueFile = `issues/${iso}.html`;
  const issueUrl = `${SITE_URL}/${issueFile}`;

  await mkdir("issues", { recursive: true });
  const html = todayEditionHtml({ dateLabel: label, volume, stories, closer: content.closer, moneyMoves, sports, legacy, theNumber, greenBook, issueUrl, storyCount: stories.length });
  await writeFile(issueFile, html);       // permanent dated archive copy
  await writeFile("today.html", html);     // stable "Today's Edition" URL
  await writeFile("index.html", landingHtml({ dateLabel: label, volume, stories, issueUrl, storyCount: stories.length }));

  manifest.unshift({ date: iso, dateLabel: label, volume, file: issueFile, storyCount: stories.length, summary: stories.map(s => s.headline).join(", ") });
  manifest = manifest.slice(0, 90);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile("archive.html", archiveHtml(manifest));

  await sendBrevoCampaign({ dateLabel: label, issueUrl, stories, closer: content.closer });

  console.log(`Published ${issueFile} (+ today.html, index.html, archive.html) with ${stories.length} stories + closer.`);
}

export { todayEditionHtml, landingHtml, archiveHtml };

// Only auto-run when executed directly (node scripts/generate-issue.mjs),
// not when imported by a test/preview script.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
