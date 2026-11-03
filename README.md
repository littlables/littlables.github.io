# Littlables — A Little Scoop of the World

A cozy, family-friendly news feed for curious minds, bringing together stories about family, animals, creativity, technology, world events, and uplifting news.

## Features

- **React SPA with TypeScript & Vite**: Modular, responsive component structure with high performance.
- **6 Visual Themes**: Dark, Dark Purple, Light, Rainbow, Pastel Rainbow, and Pretty Pink with local persistence and system dark/light mode detection.
- **Category Navigation**: Top Currents (all), Childcare & Family, Animals & Nature, Creative Arts, Future Tech & AI, Global Currents, and Uplifting News.
- **Category-Tailored Native Ads**: Loaded from `ads/` JSON files based on the currently selected category (`animals.json`, `childcare.json`, `arts.json`, `tech.json`, `world.json`), inserted at feed positions #2 and #5 with fallback and Google AdSense support.
- **Multilingual Support (i18n)**: 20+ localized languages (English, Marathi, Hindi, Bengali, Tamil, Telugu, Spanish, French, German, Portuguese, Italian, Chinese, Japanese, Korean, Arabic, Russian, Turkish, Indonesian, Vietnamese) with automatic browser locale and timezone detection.
- **Interactive Reactions**: Love ❤️, Mind Blown 🤯, and Cozy 🧸 reactions with live Supabase integration and offline caching.
- **AI Summary Callouts**: Formatted quick AI briefs (`✨ Quick AI Brief`) for approved and verified stories.
- **About & Disclaimer Dialogs**: Fully accessible modal dialogs for background information and transparency.

## Getting Started

### Development
```bash
npm install
npm run dev
```
The dev server runs at `http://0.0.0.0:3000`.

### Local Lil with Ollama

The admin-only `/lil` page uses Ollama on the admin's laptop. Install and start [Ollama](https://ollama.com), then download the configured model (`ollama pull llama3.2:3b` by default). Laptop API settings live in `~/.lil/.env`; use `~/.lil/.env.example` as a template on a new laptop. Ollama's API should be available at `http://127.0.0.1:11434`.

For local development, run `npm run dev` and open `/lil` while signed in as an admin. Vite proxies local Lil requests to the laptop API. In production, build the website on Cloudflare Pages with `npm run build` and `dist` as the output directory; only Ollama and the authenticated Lil API run on the laptop. The Cloudflare Worker verifies the signed-in user is an admin and forwards requests to the laptop's Lil API listener, bound to `127.0.0.1:3010`. The laptop's website, Vite server, and Ollama port are not exposed through the tunnel.

The laptop-only Lil API, logger, configuration, and data are kept together outside the website repository in `~/.lil/`. This folder contains the API source, its dependencies, `.env`, and `LIL_HANDOFF.md`. SQLite and JSONL database/log files are kept in `~/.lil/db/`. The laptop runtime is not deployed with the website.

For local website development, run `npm run dev`. Vite proxies local `/api/lil` requests to `127.0.0.1:3010`, so start the external API separately with `~/.lil/start-api.sh`. The repository's `scripts/start-lil-local.sh` can bootstrap Node.js and website dependencies before starting Vite; it does not start the Lil API.

The Cloudflare side is provisioned: the `littlables-lil` tunnel routes `lil-api.littlables.com` to `http://127.0.0.1:3010`, with a 404 catch-all, and the Worker has `LIL_API_ORIGIN=https://lil-api.littlables.com`. The local API listener exposes the authenticated `/api/lil/search` and `/api/lil/chat` endpoints; the Vite server and Ollama port are not in the tunnel.

On the laptop, install Ollama and download the configured model (`ollama pull llama3.2:3b` for the default). Install `cloudflared`, then open Cloudflare Dashboard → **Networking → Tunnels → littlables-lil → Add a replica**. Copy and run the Linux install command shown there; it contains the private tunnel token and installs `cloudflared` as a system service. Do not paste the token into chat or commit it. Keep the Cloudflare Tunnel service enabled so the API is reachable by the Worker.

After installing the tunnel service, enable it at boot with `sudo systemctl enable --now cloudflared` and check it with `sudo systemctl status cloudflared`. The tunnel's public hostname should point to `http://127.0.0.1:3010`; do not configure routes for the website port `3000` or Ollama port `11434`.

Install the external API dependencies once with `npm install --prefix ~/.lil`. The laptop's systemd unit is kept outside the website repository at `~/.lil/littlables-lil.service`. Install it and enable the local services:

```sh
sudo cp ~/.lil/littlables-lil.service /etc/systemd/system/littlables-lil.service
sudo systemctl daemon-reload
sudo systemctl enable --now ollama littlables-lil
```

Check the local API with `curl http://127.0.0.1:3010/api/health` and inspect logs with `sudo journalctl -u littlables-lil -f`. The laptop must be awake and online, with Ollama, the Lil API service, and Cloudflare Tunnel running. If it sleeps or loses internet, Lil is unavailable until it reconnects. The Cloudflare Worker code must also be deployed before the public page can use the route. Ollama answers are generated locally and do not include live search or verified sources.

### Local Lil model call

- **Model:** Set by `OLLAMA_MODEL` (default `llama3.2:3b`)
- **Location:** `~/.lil/lil-api.mjs` → `/api/lil/search`
- **Trigger:** Admin submits a question on `/lil`
- **What it does:** Sends the question to the Ollama API on the laptop, archives the exchange, and returns the answer to the page. The Cloudflare Worker verifies the Supabase admin session before forwarding deployed requests through the laptop tunnel.
- **Availability:** The laptop, Ollama, Lil API service, and Cloudflare Tunnel must remain online for deployed Lil requests to work.


## AI / LLM usage (Cloudflare Workers AI)

All AI model calls go through Cloudflare Workers AI (`env.AI.run`). The site makes the following AI model calls:

### 1. Story curation (editorial picks)
- **Model:** `@cf/meta/llama-3.2-3b-instruct`
- **Location:** `cloudflare-worker/src/news-storage.mjs` → `runAiStoryCuration()`
- **Trigger:** 3× daily (morning / afternoon / evening slots) + manual "Curate" button in admin panel
- **Calls per run:** 1 per category (up to 7 — one for each of childcare, animals, arts, tech, world, uplifting, all)
- **What it does:** Receives the top heuristic-scored candidates per category plus the editor's taste profile, recent approvals, and recent rejections. Returns a JSON array of up to 5 picks per category: `[{id, score (75–99), reason}]`. These are recommendations for the editor to approve — not shown to visitors.
- **Config:** `max_tokens: 450`, `temperature: 0.25`

### 2. Admin story summaries
- **Model:** `@cf/meta/llama-3.2-3b-instruct`
- **Location:** `cloudflare-worker/src/index.js` → `generateAdminSummary()`
- **Trigger:** On-demand from the admin panel (rate-limited per GitHub user via `SUMMARY_RATE_LIMITER`)
- **What it does:** Generates a concise summary of a story for the admin's review workflow.

### 3. Ad image generation
- **Models:** `@cf/meta/llama-3.2-3b-instruct` (scene description) → `@cf/black-forest-labs/flux-1-schnell` (image, fallback: `@cf/bytedance/stable-diffusion-xl-lightning`)
- **Location:** `cloudflare-worker/src/index.js` (admin image generation endpoint)
- **Trigger:** On-demand from the admin panel when creating ad creatives (`POST /admin/api/image`); rendered images are also served publicly via `GET /ai-image?prompt&seed` (IP-rate-limited, edge- and memory-cached, so repeat loads cost no calls)
- **What it does:** Generates a scene description from the story/article text, then renders an AI image for use as ad creative. FLUX runs at `num_steps: 8`; the fallback model runs only when FLUX fails.

### 4. Taste Reader AI reason
- **Model:** `@cf/meta/llama-3.2-3b-instruct`
- **Location:** `cloudflare-worker/src/index.js` → `POST /api/taste-reader/reason`
- **Trigger:** On-demand from the Taste Reader page (admin only, rate-limited via `SUMMARY_RATE_LIMITER`)
- **What it does:** Given a balloon's title + description, generates one short sentence for why an editor might not like it. The text fills the reader's notes field for editing — it is only saved if the admin saves it (as kind `ai_reason`).
- **Config:** `max_tokens: 120`, `temperature: 0.3`

> **Note for contributors:** If you add a new LLM call, document it in this section (model, location, trigger, purpose).

### 4. Embedding-based category validation
- **Model:** `@cf/baai/bge-base-en-v1.5` (768-dim text embeddings)
- **Location:** `cloudflare-worker/src/embedding-classifier.mjs`
- **Trigger:** Manual via admin panel ("Validate Categories" button) → `POST /admin/api/stories/validate-categories`
- **What it does:** Classifies unapproved stories into categories via cosine similarity against pre-computed category description vectors. Flags mismatches where the embedding-predicted category disagrees with the query-assigned category (confidence ≥ 0.35). Results stored in `embedding_category` / `embedding_confidence` columns for review. Used to validate (not override) the query-based categorization.

### 5. Interest keyword tagging
- **Model:** `@cf/baai/bge-base-en-v1.5` (768-dim text embeddings)
- **Location:** `cloudflare-worker/src/embedding-classifier.mjs` → `classifyStoryKeywords()`; keyword list in `cloudflare-worker/src/interest-keywords.mjs` (156 keywords in 16 groups)
- **Trigger:** Same validation run as #4 (no extra AI calls per story — the story embedding is reused)
- **What it does:** Tags stories with up to 3 interest keywords at cosine similarity ≥ 0.45. Keywords are a cross-cutting layer — never shown as categories. Stored in the `interest_keywords` column; served via `GET /feed?keyword=` for custom boards and hand-editable in the admin panel (grouped picker).
- **Vector persistence:** Keyword description vectors are embedded once and stored in the `keyword_embeddings` Supabase table (`getPersistedKeywordEmbeddings()` in `news-storage.mjs`), backfilled 25/run as a standalone warmup step. Tagging is all-or-nothing — it waits until all 156 vectors exist. Vectors are keyed by `KEYWORD_DESCRIPTIONS_VERSION`; bumping it recomputes them when descriptions are sharpened.
- **Flagged (excluded) keywords:** Keywords with `excluded: true` (currently 8: `stocks`, `cryptocurrency`, `business-news`, `clickbait`, `death` in the "Flagged" group, plus `politics`, `elections`, `government` in the "Politics" group) label content we don't want on the front page. They classify normally and show with 🚫 styling in the admin panel, but `getStoredNewsFeed()` filters out any story carrying one from all category feeds including "all" (`not.ov` + explicit NULL pass-through). They remain available via `GET /feed?keyword=` so custom boards can still use them. No auto-ban — flagging is labeling only.

### 6. LLM keyword correction
- **Model:** `@cf/meta/llama-3.2-3b-instruct`
- **Location:** `cloudflare-worker/src/index.js` → `POST /admin/api/stories/:id/llm-keywords`
- **Trigger:** Manual via the "🤖 AI tags" button on each validation-list row
- **What it does:** Reads the story's title + description and picks up to 3 keywords from the 156-keyword list by meaning (not word association — e.g. a Musk/Starlink story gets satellite/geopolitics-appropriate tags, not electric cars). Corrects embedding misfires; the row updates in place. Budget: 1 story fetch + 1 LLM call + 1 PATCH per click.

### 7. Ad auto-tag
- **Model:** `@cf/baai/bge-base-en-v1.5` (768-dim text embeddings)
- **Location:** `cloudflare-worker/src/index.js` → `POST /admin/api/ads/auto-tag`
- **Trigger:** Manual via the admin panel ("Auto-tag new" and rerun buttons)
- **What it does:** Tags ads with interest keywords so they can match stories. Processes 15 ads per invocation; the client loops with an offset until done.

### 8. Ad matching on the public site
- **Model:** `@cf/baai/bge-base-en-v1.5` (768-dim text embeddings)
- **Location:** `cloudflare-worker/src/index.js` → `POST /ads/match`
- **Trigger:** Visitor feed loads — the frontend sends untagged stories from the current feed and gets ranked ad IDs back
- **What it does:** Embeds up to 20 untagged stories per feed load, queries the ad keyword tags, and returns ranked ad matches per story. This is the only embedding use triggered by visitors rather than the admin panel (besides #9).

### 9. Playroom description fallback
- **Model:** `@cf/baai/bge-base-en-v1.5` (768-dim text embeddings)
- **Location:** `cloudflare-worker/src/news-storage.mjs` (playroom feed)
- **Trigger:** Visitor playroom/space pages with no pills selected
- **What it does:** Embeds the playroom description (plus space names) and finds the most similar interests (cosine similarity ≥ 0.35, top 5) so the page still shows relevant stories instead of an empty feed.

### Live usage counts
- **Storage:** `supabase/ai_usage_daily.sql` — one row per UTC day per model per use (`usage_date`, `model`, `usage_key`, `calls`, `errors`). No prompts, story ids, user ids, or IPs are stored, and the table stays tiny (at most ~15 rows a day), so no retention job is needed.
- **Counting:** `cloudflare-worker/src/ai-usage-log.mjs` — each call site tallies in memory and flushes once per request or run via the `increment_ai_usage` RPC (one extra subrequest at most, batched across all uses). `calls` counts successful invocations, `errors` counts failed ones. A flush never throws: if logging fails, the feature still works and the counts just gap.
- **Display:** `GET /admin/api/ai-usage` (admin-session + same-origin gated) returns the last 30 days (up to 90 via `?days=`); the admin panel's "AI usage" section shows Today and Last 7 days per row plus a totals line for the visible rows. Counts start the day the migration deploys — there is no backfill of past usage.

## Cloudflare Worker news providers

The Worker serves saved stories from Supabase; it does not call news providers on public feed requests. Provider metadata, category mappings, required credentials, and update pacing are centralized in `cloudflare-worker/src/news-provider-config.mjs`. Each adapter in `cloudflare-worker/src/feeds/` owns its provider request and response parsing. Shared timeouts, bounded retries, response-size limits, URL validation, and story normalization are in `cloudflare-worker/src/feed-utils.mjs`.

Configured providers are GNews, Bing News, NewsData.io, TheNewsAPI.com, WorldNewsAPI, and Reddit RSS. Configure the API keys for the providers you use from `cloudflare-worker/`:

```bash
npx wrangler secret put GNEWS_API_KEY
npx wrangler secret put NEWSDATA_API_KEY
npx wrangler secret put THENEWSAPI_API_KEY
npx wrangler secret put WORLDNEWSAPI_API_KEY
```

Bing News and Reddit RSS do not require API keys. Reddit uses public subreddit Atom/RSS feeds and has a longer request pause/retry backoff to respect its tighter unauthenticated rate limits. The admin dashboard reports whether each required secret is configured and disables provider updates when credentials are missing. Updates pause between topic requests and retry transient failures; run providers independently to avoid sharing provider quotas. Add a provider by defining its metadata and topic mapping, implementing an adapter, registering it in `news-feeds.mjs`, then adding adapter tests.

### Production Build
```bash
npm run build
npm run preview
```

### GitHub Actions Deployment (Pages + Cloudflare Worker)

`.github/workflows/deploy.yml` deploys the frontend to GitHub Pages and automatically tests and deploys the Cloudflare Worker (`cloudflare-worker/`) **only when files in `cloudflare-worker/` have changed** (or when manually triggered via `workflow_dispatch` with `deploy_worker: true`).

Worksheet printables: SVGs in `img/svg/worksheets/` are converted to US Letter PDF/JPG (`public/img/worksheets/`, 2550×3300 at 300 DPI) by the workflow's convert-worksheets job whenever an SVG changes. Note: the converter's auto-commit carries `[skip ci]`, which Pages also honors — so converted outputs only go live with the next regular (non-`[skip ci]`) push to the branch.

Configure the following GitHub Actions repository secrets for Worker deployment:
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with **Edit Cloudflare Workers** permissions.
- `CLOUDFLARE_ACCOUNT_ID` — Your Cloudflare Account ID.
- `WRANGLER_TOML` *(optional)* — Custom `wrangler.toml` contents if not using `cloudflare-worker/wrangler.example.toml`.
