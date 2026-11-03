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

### Local Lil with Open WebUI and Ollama

Lil's admin-only `/lil` page now offers two views: the existing Lil page and Open WebUI. Both use the local Ollama model. Lil requests still pass through the Cloudflare Worker and the authenticated laptop API; the API archives each user prompt, assistant response, and runtime error in SQLite/FTS and JSONL. Open WebUI has its own persistent data in `~/.lil/db/open-webui/`.

The laptop runtime stays outside this website repository in `~/.lil/`. It contains the API, logger, Open WebUI Compose configuration, service settings, and handoff notes. The public website remains on Cloudflare Pages; its Worker continues to authenticate site-admin requests before forwarding them to the laptop API.

#### Start Open WebUI locally

Install Docker Engine with the Compose plugin, and install/start [Ollama](https://ollama.com) with the desired model (default: `ollama pull llama3.2:3b`). Then start Open WebUI:

```sh
~/.lil/start-openwebui.sh
```

Open WebUI listens only on `127.0.0.1:3011`; Ollama stays on `127.0.0.1:11434`. The Open WebUI data directory is persisted under `~/.lil/db/`. On first startup, visit `http://127.0.0.1:3011` on the laptop and create the administrator account **before** exposing the hostname. In Open WebUI, disable public sign-ups, enable API keys, and create a separate least-privileged account/key for the Lil API where possible. Keep Open WebUI plugins disabled unless they are needed and reviewed.

Set `OPENWEBUI_API_KEY` and the model ID shown by Open WebUI in `~/.lil/.env` (see `~/.lil/.env.example`). Keep `.env` private; the key is only used by the laptop API and must never go in the website or Worker configuration. The API calls Open WebUI at `http://127.0.0.1:3011/api/chat/completions`, then writes the exchange to Lil's existing archive.

#### Remote Open WebUI through Cloudflare

The existing Cloudflare Tunnel hostname `lil-api.littlables.com` must continue to point to `http://127.0.0.1:3010` for authenticated Lil API requests. The `lil.littlables.com` hostname must also use the laptop API port as a **fail-closed fallback**, not port 3011:

| Hostname | Local service |
| --- | --- |
| `lil-api.littlables.com` | `http://127.0.0.1:3010` |
| `lil.littlables.com` | `http://127.0.0.1:3010` |

Do not expose port `3011` on the laptop's network interface and do not route the Ollama port. The Cloudflare Worker must be attached to the custom route `lil.littlables.com/*`; it verifies the user's Littlables Supabase session and admin status before proxying Open WebUI requests through the authenticated laptop API. The tunnel's port-3010 fallback prevents a missing Worker route from exposing Open WebUI directly.

In Cloudflare **Workers & Pages**, add the route `lil.littlables.com/*` to the existing `hello-ai` Worker. Keep the Tunnel's `lil.littlables.com` public hostname pointed at port 3010 as a fail-closed fallback; do not point that hostname directly at Open WebUI on port 3011. The Worker route should intercept the hostname and use the existing `LIL_API_ORIGIN=https://lil-api.littlables.com` to reach the laptop proxy.

Set two Cloudflare Worker secrets: `LIL_WEBUI_SESSION_SECRET` (a new random value) and `LIL_OPENWEBUI_PROXY_SECRET` (a different random value). Put the matching `LIL_OPENWEBUI_PROXY_SECRET` in `~/.lil/.env`; the Worker and laptop values must match. Generate strong random values locally (for example, `openssl rand -hex 32`) and enter them directly into the Worker Secrets settings and local `.env`; never put them in the website, Worker source, repository, or chat. The Worker also needs its existing Supabase bindings. The gateway session expires after 15 minutes; admin status is checked when the session is created, so removing an admin may take up to 15 minutes to take effect. Keep Open WebUI's own login and disabled public sign-ups enabled; the Littlables admin check is an additional gate, not a replacement for Open WebUI authentication. This route does not require Cloudflare Access or its billing authorization.

For production, the Open WebUI container's Content Security Policy permits framing only by `https://littlables.com` (and itself); localhost origins are also allowed for local Vite development. Do not add a broad frame policy. The container binds to loopback and restarts with Docker; keep Docker and the existing `cloudflared` service enabled at boot (`sudo systemctl enable --now docker cloudflared`).

#### Website and laptop API

For local website development, run `npm run dev` and open `/lil` while signed in as a site admin. Vite proxies `/api/lil` to `127.0.0.1:3010`, so start the external API separately with `~/.lil/start-api.sh`. The repository's `scripts/start-lil-local.sh` can bootstrap Node.js and website dependencies before starting Vite; it does not start either laptop service.

The Cloudflare Worker uses `LIL_API_ORIGIN=https://lil-api.littlables.com`. The API listens on loopback at port 3010, and the Worker forwards the browser session ID so conversations remain grouped in the local archive. Install the external API dependencies once with `npm install --prefix ~/.lil`. Start the laptop API manually with `~/.lil/start-api.sh` and leave its terminal open while using Lil. The same API provides the secret-protected Open WebUI reverse-proxy endpoint used by the Worker.

The floating Lil avatar appears across the site only while the laptop API, Open WebUI, and configured Ollama model are reachable. The status endpoint exposes only an online/offline boolean. Set `OLLAMA_BASE_URL` and `OLLAMA_MODEL` in `~/.lil/.env` to match the local Ollama service and model; the avatar is hidden on `/lil` and `lil.littlables.com`.

Check the local API with `curl http://127.0.0.1:3010/api/health`; errors appear in the terminal running `start-api.sh`. The laptop must be awake and online, with Ollama, Open WebUI, the Lil API, Docker, and Cloudflare Tunnel running. If it sleeps or loses internet, Lil and remote Open WebUI are unavailable until it reconnects. Ollama answers are generated locally and are not checked against live web sources.


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
