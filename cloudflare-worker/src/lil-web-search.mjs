/**
 * Lil web search — base experiment: Wikipedia keep layer + Serper live fallback.
 *
 * Search mode only (`POST /api/lil/search`). Chat, code, and games stay
 * model-only. Layers run in priority order and every layer fails open, so a
 * provider outage degrades to fewer sources, never to a lost answer:
 *
 *   1. littlables balloons — the site's own APPROVED stories in Supabase
 *      (free, Katie-curated; unapproved raw ingest never reaches a child).
 *      The question is reduced to content keywords first — a raw question
 *      fed to the generic keyword feed matches stopwords like `what`/`new`
 *      and returns the newest stories on any topic, which is exactly the
 *      bug the 2026-11-05 JWST live test caught.
 *   2. Wikipedia — live lookup via the Action API. Wikipedia text is
 *      CC BY-SA, so extracts may be kept and re-served with attribution
 *      (the source link is the attribution); a descriptive User-Agent is
 *      mandatory. No key needed.
 *   3. Serper — live Google results, only when balloons + Wikipedia are
 *      thin (< 3 sources). Needs `SERPER_API_KEY` as a Worker secret; when
 *      it is absent the layer is skipped, never an error. Serper results
 *      are live-only in this experiment: no Serper title/snippet is stored
 *      anywhere (see `logLilSearch`).
 *
 * Kid-safety: results are filtered against the flagged-topic stems
 * (stocks, crypto, business, death, politics, elections, government,
 * clickbait) before the model sees them, and the model prompt stays
 * age-appropriate. Wikipedia is not written for children, so its extracts
 * are capped and the flagged filter applies to them too.
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
export const LIL_SEARCH_BALLOON_LIMIT = 5;
export const LIL_SEARCH_WIKIPEDIA_LIMIT = 3;
export const LIL_SEARCH_SERPER_LIMIT = 5;
export const LIL_SERPER_TIMEOUT_MS = 10_000;
export const LIL_SEARCH_TEXT_LIMITS = Object.freeze({
  balloon: 300,
  wikipedia: 500,
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
 * Run the layers in priority order and merge them into one source list.
 *
 * Returns:
 * - `sources`: public sources, `{ title, url, domain }`, balloons first,
 *   capped at `LIL_SEARCH_MAX_SOURCES`.
 * - `grounding`: the same sources plus their short text, for the model
 *   prompt only — never returned to the client and never logged.
 * - `layersUsed`: layers that contributed at least one source.
 * - `searchQueries`: the web searches actually executed, as
 *   `"Wikipedia: <query>"` / `"Serper: <query>"` pills (balloons are the
 *   site's own content, not a web search, so they are not listed).
 * - `counts`: `{ balloons, wikipedia, serper, flaggedFiltered }`.
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
  serperLimit = LIL_SEARCH_SERPER_LIMIT
} = {}) {
  const startedAt = Date.now();
  const merged = [];
  const counts = { balloons: 0, wikipedia: 0, serper: 0, flaggedFiltered: 0 };
  const layerErrors = {};
  const layersUsed = [];
  const searchQueries = [];
  let serperSkipped = null;

  const take = (candidates) => {
    for (const candidate of candidates) {
      if (merged.length >= LIL_SEARCH_MAX_SOURCES) break;
      if (!candidate) continue;
      if (isFlaggedText(`${candidate.title} ${candidate.snippet || ''}`)) {
        counts.flaggedFiltered += 1;
        continue;
      }
      merged.push(candidate);
    }
  };

  // 1. Balloons first — approved, Katie-curated, keyword-matched.
  try {
    const balloons = await searchApprovedBalloons(env, query, { limit: balloonLimit });
    if (balloons.error) {
      layerErrors.balloons = balloons.error;
    } else {
      counts.flaggedFiltered += balloons.flaggedFiltered;
      const before = merged.length;
      take(balloons.sources);
      counts.balloons = merged.length - before;
      if (counts.balloons > 0) layersUsed.push('balloons');
    }
  } catch {
    layerErrors.balloons = 'fetch-failed';
  }

  // 2. Wikipedia fills when balloons are thin.
  if (merged.length < 3) {
    const wiki = await searchWikipedia(env, query, { limit: wikipediaLimit });
    if (wiki.error) {
      layerErrors.wikipedia = wiki.error;
    } else {
      // The search ran, even if it found nothing — list it; a failed call
      // is not listed, so the frontend never shows a search that did not
      // actually execute.
      searchQueries.push(`Wikipedia: ${query}`);
      const before = merged.length;
      take(wiki.results.map((r) => ({ ...r, layer: 'wikipedia' })));
      counts.wikipedia = merged.length - before;
      if (counts.wikipedia > 0) layersUsed.push('wikipedia');
    }
  }

  // 3. Serper is the live fallback, only when still thin.
  if (merged.length < 3) {
    const serper = await searchSerper(env, query, { limit: serperLimit });
    if (serper.skipped) {
      serperSkipped = serper.skipped;
    } else if (serper.error) {
      layerErrors.serper = serper.error;
    } else {
      searchQueries.push(`Serper: ${query}`);
      const before = merged.length;
      take(serper.results.map((r) => ({ ...r, layer: 'serper' })));
      counts.serper = merged.length - before;
      if (counts.serper > 0) layersUsed.push('serper');
    }
  }

  return {
    sources: merged.map(({ title, url, domain }) => ({ title, url, domain })),
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
        serper_count: counts.serper || 0,
        flagged_filtered: counts.flaggedFiltered || 0,
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
