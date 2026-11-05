/**
 * Lil web search — base experiment: Wikipedia keep layer + Serper live fallback.
 *
 * Search mode only (`POST /api/lil/search`). Chat, code, and games stay
 * model-only. Layers run in priority order and every layer fails open, so a
 * provider outage degrades to fewer sources, never to a lost answer:
 *
 *   1. Wikipedia — live lookup via the Action API. Wikipedia text is
 *      CC BY-SA, so extracts may be kept and re-served with attribution
 *      (the source link is the attribution); a descriptive User-Agent is
 *      mandatory. No key needed.
 *   2. Ceramic — live web search through Cloudflare's Web Search API
 *      (`env.AI.websearch`, gateway `littlables-lil`, provider
 *      `ceramic`, BYOK alias `default` — Katie's own Ceramic key, stored
 *      on the gateway; the key itself never travels in the request).
 *      Runs when Wikipedia leaves the grounding thin (under
 *      `LIL_SEARCH_MIN_SOURCES` grounded sources), and gets the
 *      question's content keywords, not the full sentence — Ceramic is
 *      an exact-match engine, so a conversational question searches
 *      worse than keywords. Live-only, like Serper: Ceramic's own terms
 *      (§7) ban storing or re-serving results, so descriptions are
 *      trimmed to 300 chars, the flagged filter applies, grounding text
 *      goes into the prompt only, and the log stays metadata-only.
 *   3. Serper — live Google results, only when Wikipedia + Ceramic are
 *      still thin (under `LIL_SEARCH_MIN_SOURCES` sources). Needs
 *      `SERPER_API_KEY` as a Worker secret; when it is absent the layer
 *      is skipped, never an error. Serper results are live-only in this
 *      experiment: no Serper title/snippet is stored anywhere (see
 *      `logLilSearch`).
 *
 * Balloons ride along separately (2026-11-05, Katie: back burner — not
 * enough tagged content yet to ground answers): the site's own APPROVED
 * stories in Supabase (free, Katie-curated; unapproved raw ingest never
 * reaches a child) are returned in their own `balloons` list, up to 5,
 * shown in a collapsible section away from the answer's sources. They
 * are NEVER in the grounding prompt, so a loosely-matched balloon can no
 * longer steer the answer — that is exactly what the 2026-11-05 JWST
 * live retest caught ("Safe Space" matched the keyword `space`).
 *
 * Kid-safety: results are filtered against the flagged-topic stems
 * (stocks, crypto, business, death, politics, elections, government,
 * clickbait) before the model sees them, and the model prompt stays
 * age-appropriate. Wikipedia is not written for children, so its extracts
 * are capped and the flagged filter applies to them too. Web-layer results
 * are also screened against a small domain blocklist (`BLOCKED_DOMAINS` —
 * conspiracy/misinformation sites and satire presented as news, starting
 * with theblackvault.com, the site Ceramic surfaced in the 2026-11-05
 * JWST retest). The blocklist does NOT apply to balloons: those are
 * Katie-curated approved stories, and her approval outranks a domain
 * screen. A blocked result is dropped and counted in `flaggedFiltered`
 * alongside stem-filtered results — the log counts safety screens, it
 * does not distinguish which one fired. Wikipedia results get one more
 * screen, relevance (`isRelevantToKeywords`): an article whose title or
 * extract shares no content keyword with the question is dropped and
 * counted in `irrelevantFiltered`, so junk stops counting toward the
 * minimum and the live layers get their turn. The domain blocklist
 * cannot catch that class — wikipedia.org is a fine domain, the article
 * is the problem (Hitachi Magic Wand, 2026-11-05).
 *
 * This module never throws: every failure is reported in the returned
 * `layerErrors` / `serperSkipped` fields so the handler can log it and
 * still answer.
 */

import { STORIES_TABLE, supabaseUrl, supabaseHeaders } from './news-storage.mjs';
import { EXCLUDED_KEYWORD_IDS } from './interest-keywords.mjs';

export const LIL_WIKIPEDIA_USER_AGENT =
  'littlables-lil/1.0 (https://littlables.com; contact hello@littlables.com)';
export const LIL_SEARCH_MAX_SOURCES = 6;
// Minimum grounded sources before the live layers stop: Wikipedia alone
// returning 3 junk articles used to satisfy the old "3 is enough" gate,
// so Serper — the layer that would have found real news — never ran
// (2026-11-05 environmental question on prod). The layers now keep
// running until 5 grounded sources or the cap of 6.
export const LIL_SEARCH_MIN_SOURCES = 5;
export const LIL_SEARCH_BALLOON_LIMIT = 5;
export const LIL_SEARCH_WIKIPEDIA_LIMIT = 3;
export const LIL_SEARCH_CERAMIC_LIMIT = 5;
export const LIL_SEARCH_SERPER_LIMIT = 5;
export const LIL_SERPER_TIMEOUT_MS = 10_000;
// Cloudflare Web Search API via the Workers AI binding (docs:
// developers.cloudflare.com/web-search/how-to-use — verified 2026-11-05).
// The gateway holds Katie's Ceramic key (built-in `ceramic` slot, alias
// `default`); the binding call names the gateway and alias, the key itself
// never travels in the request. A missing provider/alias fails with 400
// instead of falling back to AI Gateway credits.
export const LIL_CERAMIC_GATEWAY_ID = 'littlables-lil';
export const LIL_CERAMIC_PROVIDER = 'ceramic';
export const LIL_CERAMIC_BYOK_ALIAS = 'default';
export const LIL_SEARCH_TEXT_LIMITS = Object.freeze({
  balloon: 300,
  wikipedia: 500,
  ceramic: 300,
  serper: 300
});

// First-pass flagged-topic filter, mirroring the eight interests excluded
// from front-page feeds (stocks, cryptocurrency, business-news, clickbait,
// death, politics, elections, government). Word-boundary matching, so
// "crypto" does not flag "cryptography" and "stocks" does not flag
// "livestock". This is a coarse screen for search results, not the
// "shot"/"shooting" are deliberately absent: "flu shots" and "shooting
// stars" are ordinary kids' topics, and the classification screen in
// searchApprovedBalloons catches violent uses instead. This is a coarse
// screen for search results, not the embedding classifier — the
// filtered-out count is logged, not hidden.
const FLAGGED_STEMS = [
  'stock market', 'stock price', 'stocks', 'stock',
  'cryptocurrency', 'crypto', 'bitcoin', 'blockchain',
  'investing', 'earnings', 'merger', 'acquisition', 'layoff',
  'obituary', 'obituaries', 'murder', 'fatal', 'death',
  'killed', 'killing', 'dead', 'dies', 'died', 'deadly', 'deceased',
  'stabbed', 'suicide', 'homicide', 'assault',
  'election', 'voting', 'candidate', 'politician', 'political',
  'government', 'senate', 'congress', 'parliament',
  'clickbait'
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FLAGGED_PATTERN = new RegExp(
  `\\b(?:${FLAGGED_STEMS.map(escapeRegExp).join('|')})s?\\b`,
  'i'
);

export function isFlaggedText(text) {
  if (typeof text !== 'string' || !text) return false;
  return FLAGGED_PATTERN.test(text);
}

export function trimText(text, maxLength) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength).trimEnd()}…`;
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Domain blocklist for the WEB layers only (Wikipedia, Ceramic, Serper).
// These are sites whose results should never ground a child's answer,
// whatever the query: conspiracy/misinformation outlets and satire
// presented as news. The flagged-stem filter cannot catch them — a
// theblackvault.com headline about "classified briefings" carries no
// flagged word. To add a domain, add one line here; subdomains are
// covered automatically. Balloons are exempt (see the module header):
// Katie's approval of a story outranks a domain screen.
export const BLOCKED_DOMAINS = Object.freeze(new Set([
  'theblackvault.com', // conspiracy / UFO document site — the observed case (2026-11-05 JWST retest)
  'infowars.com', // conspiracy and misinformation
  'naturalnews.com', // health misinformation
  'beforeitsnews.com', // conspiracy aggregator
  'theonion.com' // satire presented as news — a model can mistake it for real reporting
]));

export function isBlockedDomain(domain) {
  if (typeof domain !== 'string' || !domain) return false;
  const host = domain.toLowerCase().replace(/^www\./, '');
  for (const blocked of BLOCKED_DOMAINS) {
    if (host === blocked || host.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

// Relevance variants for the Wikipedia screen: the shared plural
// variants, plus the singular for words ending in 's' — 'pandas' must
// match an article titled 'Panda'. Words ending in 'ies' already get
// their singular from keywordVariants ('stories' → 'story'), and short
// words are excluded so 'news' never becomes 'new' and 'gas' never
// becomes 'ga'.
function relevanceVariants(word) {
  const variants = [...keywordVariants(word)];
  if (!word.endsWith('ies') && word.endsWith('s') && word.length > 4) {
    variants.push(word.slice(0, -1));
  }
  return variants;
}

// Wikipedia relevance screen: keep a result only if its title or
// extract shares at least one of the question's content keywords (or a
// plural/singular variant) with the question. Wikipedia's full-text
// search treats a conversational question as a bag of words — for the
// 2026-11-05 environmental question it returned Elizabeth Berkley, a
// Hitachi Magic Wand, and Machiavellianism, none of whose extracts
// contains inspiring, positive, environmental, nature, or stories.
// Empty keywords (a content-free question) match nothing, so Wikipedia
// contributes nothing and the live layers get their turn. This is a
// heuristic, not a guarantee: a loosely-related article whose extract
// happens to contain one keyword still passes.
export function isRelevantToKeywords(title, snippet, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return false;
  const text = `${title || ''} ${snippet || ''}`;
  if (!text.trim()) return false;
  return keywords.some((keyword) =>
    relevanceVariants(keyword).some((variant) =>
      new RegExp(`\\b${escapeRegExp(variant)}\\b`, 'i').test(text)
    )
  );
}

// Question words and filler: a natural-language question ("What new space
// discoveries happened recently...?") is mostly words that match everything
// (`what`, `new`, `news`) or nothing (the whole sentence as one term). Only
// the content words go into the balloon query. Words under 3 letters are
// dropped by the length check, so they need no entry here.
const SEARCH_STOP_WORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'why', 'how',
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'has', 'had',
  'are', 'was', 'were', 'will', 'would', 'could', 'should',
  'about', 'into', 'over', 'after', 'before', 'under', 'between', 'through',
  'during', 'while', 'their', 'there', 'these', 'those', 'they', 'them',
  'then', 'than', 'some', 'such', 'more', 'most', 'other', 'only', 'also',
  'just', 'like', 'make', 'made', 'many', 'much', 'very', 'your', 'our',
  'new', 'news', 'says', 'said', 'report', 'reports', 'year', 'years',
  'first', 'time', 'today', 'week', 'month', 'world', 'his', 'her', 'its',
  'recently', 'recent', 'happened', 'happen', 'tell', 'please', 'can',
  'get', 'got', 'any', 'all', 'each', 'not', 'but', 'out', 'now', 'here',
  'again', 'once', 'along', 'across', 'behind', 'beyond', 'plus', 'except',
  'without', 'within', 'toward', 'towards', 'until', 'upon', 'per', 'via'
]);

export const LIL_SEARCH_MAX_KEYWORDS = 5;

/**
 * Reduce a question to its content keywords, in order, deduplicated and
 * capped. "What new space discoveries happened recently from the James
 * Webb telescope?" → ["space", "discoveries", "james", "webb", "telescope"].
 * Returns [] when nothing topical survives (the caller then skips balloons).
 */
export function extractSearchKeywords(query, { maxKeywords = LIL_SEARCH_MAX_KEYWORDS } = {}) {
  const words = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !SEARCH_STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, maxKeywords);
}

// Plural sibling for a keyword: "discoveries" → "discovery",
// "telescope" → "telescopes". Words already ending in "s" stay as-is —
// deriving a singular ("james" → "jame") only adds junk matches.
function keywordVariants(word) {
  if (word.endsWith('ies') && word.length > 4) return [word, `${word.slice(0, -3)}y`];
  if (!word.endsWith('s')) return [word, `${word}s`];
  return [word];
}

function wikipediaUrl(query, limit) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(limit),
    prop: 'extracts|info',
    exintro: '1',
    explaintext: '1',
    exchars: String(LIL_SEARCH_TEXT_LIMITS.wikipedia),
    inprop: 'url',
    gsrnamespace: '0'
  });
  return `https://en.wikipedia.org/w/api.php?${params.toString()}`;
}

/**
 * One Wikipedia lookup. Returns `{ results, error }` where results are
 * `{ title, url, snippet, domain }` and error is null on success.
 * Never throws; any failure yields `{ results: [], error }`.
 */
export async function searchWikipedia(env, query, { limit = LIL_SEARCH_WIKIPEDIA_LIMIT } = {}) {
  try {
    const response = await fetch(wikipediaUrl(query, limit), {
      headers: {
        'User-Agent': LIL_WIKIPEDIA_USER_AGENT,
        Accept: 'application/json'
      }
    });
    if (!response.ok) return { results: [], error: `http-${response.status}` };
    const data = await response.json().catch(() => null);
    const pages = data?.query?.pages;
    if (!Array.isArray(pages)) return { results: [], error: 'bad-response' };
    const results = [];
    for (const page of pages) {
      if (!page || typeof page.title !== 'string' || !page.title) continue;
      const url = typeof page.canonicalurl === 'string' && page.canonicalurl
        ? page.canonicalurl
        : `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`;
      results.push({
        title: page.title,
        url,
        snippet: trimText(page.extract || '', LIL_SEARCH_TEXT_LIMITS.wikipedia),
        domain: 'wikipedia.org'
      });
    }
    return { results, error: null };
  } catch {
    return { results: [], error: 'fetch-failed' };
  }
}

/**
 * One Serper search. Returns `{ results, skipped, error }`:
 * - no `SERPER_API_KEY` configured → `{ results: [], skipped: 'no-key', error: null }`
 * - call fails → `{ results: [], skipped: null, error }`
 * Never throws; a hung call is aborted after `LIL_SERPER_TIMEOUT_MS`.
 */
export async function searchSerper(env, query, { limit = LIL_SEARCH_SERPER_LIMIT, timeoutMs = LIL_SERPER_TIMEOUT_MS } = {}) {
  const apiKey = env?.SERPER_API_KEY;
  if (typeof apiKey !== 'string' || !apiKey) {
    return { results: [], skipped: 'no-key', error: null };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, num: limit }),
      signal: controller.signal
    });
    if (!response.ok) return { results: [], skipped: null, error: `http-${response.status}` };
    const data = await response.json().catch(() => null);
    const organic = data?.organic;
    if (!Array.isArray(organic)) return { results: [], skipped: null, error: 'bad-response' };
    const results = [];
    for (const item of organic) {
      if (!item || typeof item.title !== 'string' || !item.title ||
          typeof item.link !== 'string' || !item.link) continue;
      results.push({
        title: item.title,
        url: item.link,
        snippet: trimText(item.snippet || '', LIL_SEARCH_TEXT_LIMITS.serper),
        domain: domainOf(item.link)
      });
    }
    return { results, skipped: null, error: null };
  } catch (err) {
    if (err && err.name === 'AbortError') return { results: [], skipped: null, error: 'timeout' };
    return { results: [], skipped: null, error: 'fetch-failed' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * One Ceramic search through Cloudflare's Web Search API. Returns
 * `{ results, error }` where results are `{ title, url, snippet, domain }`.
 *
 * The call goes through the Workers AI binding — `env.AI.websearch` with
 * the gateway ID, provider `ceramic`, and the BYOK alias `default` — and
 * returns a standard `Response` whose JSON is
 * `{ items: [{ url, title, description, ... }], metadata }` (Cloudflare
 * docs, verified 2026-11-05). The caller passes the question's content
 * keywords as the query (Ceramic is an exact-match engine; a full
 * conversational question searches worse than keywords).
 *
 * Never throws; any failure yields `{ results: [], error }`:
 * - no `env.AI.websearch` binding (older compatibility date, or a test env
 *   without the method) → `'unavailable'`
 * - non-OK response (a missing provider/alias fails with 400) →
 *   `http-<status>`
 * - malformed body → `'bad-response'`, thrown call → `'fetch-failed'`.
 * Ceramic descriptions can run to 8,000 chars, so they are trimmed to the
 * same 300 as Serper's before the model ever sees them.
 */
export async function searchCeramic(env, query, { limit = LIL_SEARCH_CERAMIC_LIMIT } = {}) {
  if (typeof env?.AI?.websearch !== 'function') {
    return { results: [], error: 'unavailable' };
  }
  try {
    const response = await env.AI.websearch({
      gatewayId: LIL_CERAMIC_GATEWAY_ID,
      query,
      provider: LIL_CERAMIC_PROVIDER,
      byokAlias: LIL_CERAMIC_BYOK_ALIAS,
      limit
    });
    if (!response || response.ok === false) {
      return { results: [], error: `http-${response?.status || 'unknown'}` };
    }
    const data = await response.json().catch(() => null);
    const items = data?.items;
    if (!Array.isArray(items)) return { results: [], error: 'bad-response' };
    const results = [];
    for (const item of items) {
      if (!item || typeof item.title !== 'string' || !item.title ||
          typeof item.url !== 'string' || !item.url) continue;
      results.push({
        title: item.title,
        url: item.url,
        snippet: trimText(item.description || '', LIL_SEARCH_TEXT_LIMITS.ceramic),
        domain: domainOf(item.url)
      });
    }
    return { results, error: null };
  } catch {
    return { results: [], error: 'fetch-failed' };
  }
}

function balloonToSource(row) {
  // searchNewsStories returns normalized stories: article_url is `link`,
  // ai_summary is `aiSummary`, source_name is `source`. Accept the raw
  // column names too so a future shape change degrades instead of dropping.
  const url = typeof row?.link === 'string' && row.link
    ? row.link
    : typeof row?.article_url === 'string' ? row.article_url : '';
  if (!url) return null;
  const title = typeof row?.title === 'string' ? row.title : '';
  if (!title) return null;
  const sourceName = typeof row?.source === 'string' && row.source
    ? row.source
    : typeof row?.source_name === 'string' ? row.source_name : '';
  return {
    title,
    url,
    snippet: trimText(row.description || row.aiSummary || row.ai_summary || '', LIL_SEARCH_TEXT_LIMITS.balloon),
    domain: domainOf(url) || sourceName,
    layer: 'balloons'
  };
}

/**
 * Approved balloons for a question. Approved-only (Katie-curated) and
 * keyword-matched: the question's content keywords are OR-matched against
 * title/description/ai_summary, newest first. Rows carrying an excluded
 * interest keyword (the site's own classification: stocks, crypto,
 * business-news, clickbait, death, politics, elections, government) are
 * dropped here and counted in `flaggedFiltered`; the stem filter in the
 * orchestrator is only the backstop for untagged rows. Returns
 * `{ sources, flaggedFiltered, error }`. Never throws.
 */
export async function searchApprovedBalloons(env, query, {
  limit = LIL_SEARCH_BALLOON_LIMIT,
  fetchLimit = 20
} = {}) {
  const keywords = extractSearchKeywords(query);
  if (keywords.length === 0) return { sources: [], flaggedFiltered: 0, error: null };
  const terms = [...new Set(keywords.flatMap(keywordVariants))];
  const clauses = [];
  for (const term of terms) {
    clauses.push(
      `title.ilike.*${term}*`,
      `description.ilike.*${term}*`,
      `ai_summary.ilike.*${term}*`
    );
  }
  try {
    const params = new URLSearchParams({
      select: 'title,article_url,description,ai_summary,source_name,interest_keywords,approved,published_at',
      approved: 'eq.true',
      removed: 'eq.false',
      or: `(${clauses.join(',')})`,
      order: 'published_at.desc.nullslast,fetched_at.desc',
      limit: String(fetchLimit)
    });
    const response = await fetch(supabaseUrl(env, STORIES_TABLE, params), {
      headers: supabaseHeaders(env)
    });
    if (!response.ok) return { sources: [], flaggedFiltered: 0, error: `http-${response.status}` };
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows)) return { sources: [], flaggedFiltered: 0, error: 'bad-response' };
    const sources = [];
    let flaggedFiltered = 0;
    for (const row of rows) {
      if (sources.length >= limit) break;
      // The query already filters approved, but enforce it client-side too:
      // a row that is not approved is never a Lil source, whatever the
      // query returned.
      if (row?.approved !== true) continue;
      const tagged = Array.isArray(row.interest_keywords) ? row.interest_keywords : [];
      if (tagged.some((k) => EXCLUDED_KEYWORD_IDS.has(k))) {
        flaggedFiltered += 1;
        continue;
      }
      const source = balloonToSource(row);
      if (!source) continue;
      sources.push(source);
    }
    return { sources, flaggedFiltered, error: null };
  } catch {
    return { sources: [], flaggedFiltered: 0, error: 'fetch-failed' };
  }
}

/**
 * Run the grounding layers (Wikipedia, then Ceramic when thin, then Serper
 * when still thin) and gather balloons separately.
 *
 * Returns:
 * - `sources`: public grounding sources, `{ title, url, domain }`,
 *   Wikipedia + Ceramic + Serper only, capped at
 *   `LIL_SEARCH_MAX_SOURCES`. These are the sources the answer is
 *   grounded in — and the only ones shown in the Sources section.
 * - `balloons`: the site's own approved stories, `{ title, url, domain }`,
 *   up to `LIL_SEARCH_BALLOON_LIMIT`, keyword-matched and
 *   classification-screened like before — but NEVER in `grounding`, so
 *   they cannot steer the answer. The frontend shows them in their own
 *   collapsible section, away from the answer's sources.
 * - `grounding`: the grounding sources plus their short text, for the
 *   model prompt only — never returned to the client and never logged.
 * - `layersUsed`: grounding layers that contributed at least one source
 *   (balloons are not a grounding layer, so they are never listed).
 * - `searchQueries`: the web searches actually executed, as
 *   `"Wikipedia: <query>"` / `"Ceramic: <keywords>"` /
 *   `"Serper: <query>"` pills (balloons are the site's own content, not a
 *   web search, so they are not listed). Ceramic gets the content
 *   keywords, not the full question — it is an exact-match engine.
 * - `counts`: `{ balloons, wikipedia, ceramic, serper, flaggedFiltered, irrelevantFiltered }`.
 * - `layerErrors`: `{ <layer>: <error> }` for layers that failed.
 * - `serperSkipped`: `'no-key'` when Serper was skipped for want of a key,
 *   else null.
 * - `latencyMs`: wall time for the whole gather.
 *
 * Never throws.
 */
export async function searchLilWebSources(env, query, {
  balloonLimit = LIL_SEARCH_BALLOON_LIMIT,
  wikipediaLimit = LIL_SEARCH_WIKIPEDIA_LIMIT,
  ceramicLimit = LIL_SEARCH_CERAMIC_LIMIT,
  serperLimit = LIL_SEARCH_SERPER_LIMIT
} = {}) {
  const startedAt = Date.now();
  const merged = [];
  const balloonList = [];
  const counts = { balloons: 0, wikipedia: 0, ceramic: 0, serper: 0, flaggedFiltered: 0, irrelevantFiltered: 0 };
  const layerErrors = {};
  const layersUsed = [];
  const searchQueries = [];
  let serperSkipped = null;
  // The question's content keywords, computed once: the Wikipedia
  // relevance screen and the Ceramic query both use them.
  const questionKeywords = extractSearchKeywords(query);

  const takeInto = (list, candidates, cap) => {
    let added = 0;
    for (const candidate of candidates) {
      if (list.length >= cap) break;
      if (!candidate) continue;
      // Domain screen — web layers only. Balloons are Katie-curated and
      // exempt: her approval outranks a domain screen.
      if (candidate.layer !== 'balloons' && isBlockedDomain(candidate.domain)) {
        counts.flaggedFiltered += 1;
        continue;
      }
      if (isFlaggedText(`${candidate.title} ${candidate.snippet || ''}`)) {
        counts.flaggedFiltered += 1;
        continue;
      }
      // Relevance screen — Wikipedia only. Its full-text search returns
      // junk for conversational questions, and a junk result must not
      // count toward the minimum, or the live layers never run.
      if (candidate.layer === 'wikipedia' && !isRelevantToKeywords(candidate.title, candidate.snippet, questionKeywords)) {
        counts.irrelevantFiltered += 1;
        continue;
      }
      list.push(candidate);
      added += 1;
    }
    return added;
  };

  // Balloons ride along separately — approved, Katie-curated,
  // keyword-matched, classification-screened. They are gathered first so
  // their fetch failure is reported, but they never enter `merged`, so
  // they can neither ground the answer nor suppress the web layers.
  try {
    const balloons = await searchApprovedBalloons(env, query, { limit: balloonLimit });
    if (balloons.error) {
      layerErrors.balloons = balloons.error;
    } else {
      counts.flaggedFiltered += balloons.flaggedFiltered;
      counts.balloons = takeInto(balloonList, balloons.sources, balloonLimit);
    }
  } catch {
    layerErrors.balloons = 'fetch-failed';
  }

  // 1. Wikipedia grounds the answer.
  {
    const wiki = await searchWikipedia(env, query, { limit: wikipediaLimit });
    if (wiki.error) {
      layerErrors.wikipedia = wiki.error;
    } else {
      // The search ran, even if it found nothing — list it; a failed call
      // is not listed, so the frontend never shows a search that did not
      // actually execute.
      searchQueries.push(`Wikipedia: ${query}`);
      counts.wikipedia = takeInto(merged, wiki.results.map((r) => ({ ...r, layer: 'wikipedia' })), LIL_SEARCH_MAX_SOURCES);
      if (counts.wikipedia > 0) layersUsed.push('wikipedia');
    }
  }

  // 2. Ceramic is the live fallback, only when the grounding is still
  // thin (under LIL_SEARCH_MIN_SOURCES) — and it gets the content
  // keywords, not the full question, because it is an exact-match
  // engine. No keywords survive the stopword strip (e.g. "What is it?")
  // → skip it silently.
  if (merged.length < LIL_SEARCH_MIN_SOURCES) {
    const ceramicQuery = questionKeywords.join(' ');
    if (ceramicQuery) {
      const ceramic = await searchCeramic(env, ceramicQuery, { limit: ceramicLimit });
      if (ceramic.error) {
        layerErrors.ceramic = ceramic.error;
      } else {
        // The search ran, even if it found nothing — list it, like
        // Wikipedia; a failed call is not listed.
        searchQueries.push(`Ceramic: ${ceramicQuery}`);
        counts.ceramic = takeInto(merged, ceramic.results.map((r) => ({ ...r, layer: 'ceramic' })), LIL_SEARCH_MAX_SOURCES);
        if (counts.ceramic > 0) layersUsed.push('ceramic');
      }
    }
  }

  // 3. Serper is the last live fallback, only when the grounding is
  // still thin (under LIL_SEARCH_MIN_SOURCES).
  if (merged.length < LIL_SEARCH_MIN_SOURCES) {
    const serper = await searchSerper(env, query, { limit: serperLimit });
    if (serper.skipped) {
      serperSkipped = serper.skipped;
    } else if (serper.error) {
      layerErrors.serper = serper.error;
    } else {
      searchQueries.push(`Serper: ${query}`);
      counts.serper = takeInto(merged, serper.results.map((r) => ({ ...r, layer: 'serper' })), LIL_SEARCH_MAX_SOURCES);
      if (counts.serper > 0) layersUsed.push('serper');
    }
  }

  return {
    sources: merged.map(({ title, url, domain }) => ({ title, url, domain })),
    balloons: balloonList.map(({ title, url, domain }) => ({ title, url, domain })),
    grounding: merged.map(({ title, url, snippet }) => ({ title, url, text: snippet })),
    layersUsed,
    searchQueries,
    counts,
    layerErrors,
    serperSkipped,
    latencyMs: Date.now() - startedAt
  };
}

/**
 * Metadata-only search audit log (Katie, 2026-11-04: log metadata only, no
 * full snippets). One row per search turn in `lil_search_log` — counts,
 * result URLs, and domains only. No result titles, descriptions, or
 * snippets are ever passed in or stored, so this log can never be read back
 * as a search index. Fail-open: returns false on any failure, never throws,
 * and never blocks the answer.
 */
export async function logLilSearch(env, {
  userId,
  query,
  layersUsed = [],
  counts = {},
  resultUrls = [],
  domains = [],
  latencyMs = 0,
  status = 'ok',
  errorType = null
} = {}) {
  try {
    if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY || !userId) return false;
    const response = await fetch(supabaseUrl(env, 'lil_search_log'), {
      method: 'POST',
      headers: supabaseHeaders(env),
      body: JSON.stringify({
        user_id: userId,
        query: typeof query === 'string' ? query : '',
        layers: Array.isArray(layersUsed) ? layersUsed : [],
        balloons_count: counts.balloons || 0,
        wikipedia_count: counts.wikipedia || 0,
        ceramic_count: counts.ceramic || 0,
        serper_count: counts.serper || 0,
        flagged_filtered: counts.flaggedFiltered || 0,
        irrelevant_filtered: counts.irrelevantFiltered || 0,
        result_urls: Array.isArray(resultUrls) ? resultUrls : [],
        domains: Array.isArray(domains) ? domains : [],
        latency_ms: latencyMs || 0,
        status,
        error_type: errorType
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}
