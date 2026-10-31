import { NEWS_CATEGORIES, getNewsProviderConfig } from './news-provider-config.mjs';
import { normalizeInterestKeywords, INTEREST_KEYWORD_IDS, INTEREST_KEYWORDS, KEYWORD_DESCRIPTIONS_VERSION, EXCLUDED_KEYWORD_IDS, SPACE_DEFINITIONS, deriveStoryRegion, isValidInterestKeyword } from './interest-keywords.mjs';
import { embedText, EMBEDDING_MODEL, cosineSimilarity } from './embedding-classifier.mjs';
import { createAiUsageCounter, AI_USAGE_MODEL_LLAMA, AI_USAGE_MODEL_BGE } from './ai-usage-log.mjs';

// Stored keyword vectors are keyed by description version: when descriptions
// are sharpened, old vectors stop matching and get recomputed.
const KEYWORD_VECTOR_MODEL = `${EMBEDDING_MODEL}:kwv${KEYWORD_DESCRIPTIONS_VERSION}`;

export const STORIES_TABLE = 'news_stories';
export const SYNC_RUNS_TABLE = 'provider_sync_runs';
const SYNC_TABLE = 'news_provider_sync';

export function supabaseHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

export function supabaseUrl(env, table, query = '') {
  const base = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}`;
  return query ? `${base}?${query}` : base;
}

async function readRows(response, context) {
  if (!response.ok) throw new Error(`${context} failed (HTTP ${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`${context} returned an invalid response`);
  return rows;
}

// Exported for modules that need raw Supabase row reads (e.g. keyword embeddings).
export { readRows };

function normalizeStory(row) {
  return {
    title: row.title,
    link: row.article_url,
    image: row.image_url || '',
    description: row.description || '',
    content: row.content || '',
    aiSummary: row.ai_summary || '',
    pubDate: row.published_at || '',
    fetchedAt: row.fetched_at || '',
    source: row.source_name || '',
    provider: row.provider,
    category: row.category,
    // Admin-curated frontend category override. Null/empty = use `category`.
    displayCategories: Array.isArray(row.display_categories) && row.display_categories.length > 0
      ? row.display_categories.filter(c => typeof c === 'string')
      : null,
    // Interest keywords (cross-cutting tags, never shown as categories).
    interestKeywords: Array.isArray(row.interest_keywords) && row.interest_keywords.length > 0
      ? row.interest_keywords.filter(k => typeof k === 'string')
      : null
    // NOTE: region/country_code temporarily removed from feed select until
    // the story_region.sql migration succeeds. Re-add after columns exist.
  };
}

/**
 * Effective frontend categories for a story row: the override list when set,
 * otherwise the query-assigned category.
 */
export function effectiveDisplayCategories(row) {
  if (Array.isArray(row.display_categories) && row.display_categories.length > 0) {
    return row.display_categories.filter(c => typeof c === 'string');
  }
  if (Array.isArray(row.displayCategories) && row.displayCategories.length > 0) {
    return row.displayCategories.filter(c => typeof c === 'string');
  }
  const fallback = row.category || 'all';
  return [fallback];
}

// Reaction ranking: content with more total reactions shows above other
// content from the same publish day. Reaction rows are keyed by a
// frontend-computed story ID (not a UUID or URL), so the worker recomputes
// the same ID to join reactions onto feed stories.
export const REACTIONS_TABLE = 'article_reactions';

// Mirrors getStoryId() in src/services/supabaseService.ts exactly — the
// frontend hashes (link + title), lowercased and trimmed. Keep in sync.
export function computeStoryId(link, title) {
  const str = ((link || '') + (title || '')).toLowerCase().trim();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return 's_' + Math.abs(hash).toString(36).slice(0, 10);
}

// One PostgREST query for every story in the feed: total reactions
// (love + mind + cozy) per story ID. Fail-open: any failure logs and
// returns an empty map, so the feed keeps date order instead of breaking.
// Diagnostic logging (2026-10-25): the production lookup failed with its
// error text swallowed by the log pipeline, so every failure path logs the
// HTTP status and response body explicitly as plain strings.
async function fetchReactionTotals(env, items) {
  const totals = new Map();
  const ids = [...new Set(items
    .map(item => computeStoryId(item.link || item.article_url, item.title))
    .filter(Boolean))];
  if (ids.length === 0) return totals;
  try {
    const params = new URLSearchParams({
      select: 'story_id,reaction_type,count',
      story_id: `in.(${ids.join(',')})`
    });
    const response = await fetch(supabaseUrl(env, REACTIONS_TABLE, params), {
      headers: supabaseHeaders(env)
    });
    const bodyText = await response.text();
    if (!response.ok) {
      console.error(`Reaction totals lookup HTTP ${response.status} (ids=${ids.length}): ${bodyText.slice(0, 300)}`);
      return totals;
    }
    let rows;
    try {
      rows = JSON.parse(bodyText);
    } catch (parseErr) {
      console.error(`Reaction totals lookup unparseable body (ids=${ids.length}, first 300 chars): ${bodyText.slice(0, 300)}`);
      return totals;
    }
    if (!Array.isArray(rows)) {
      console.error(`Reaction totals lookup non-array body (ids=${ids.length}, first 300 chars): ${bodyText.slice(0, 300)}`);
      return totals;
    }
    for (const row of rows) {
      const count = Number(row.count) || 0;
      totals.set(row.story_id, (totals.get(row.story_id) || 0) + count);
    }
  } catch (err) {
    console.error(`Reaction totals lookup threw (ids=${ids.length}): message=${err && err.message ? err.message : String(err)} stack=${err && err.stack ? err.stack : 'none'}`);
  }
  return totals;
}

// Pure sort: newest publish day first; within a day, most total reactions
// first; ties by recency; zero-reaction stories keep date order among
// themselves. Returns a new array; the input is untouched.
export function sortItemsByDayReactions(items, totals) {
  const dayOf = item => {
    const raw = item.pubDate || item.published_at || '';
    return raw ? String(raw).slice(0, 10) : '0000-00-00';
  };
  const timeOf = item => {
    const ms = Date.parse(item.pubDate || item.published_at || item.fetchedAt || item.fetched_at || '');
    return Number.isNaN(ms) ? 0 : ms;
  };
  const withIndex = items.map((item, index) => ({ item, index }));
  withIndex.sort((a, b) => {
    const dayA = dayOf(a.item);
    const dayB = dayOf(b.item);
    if (dayA !== dayB) return dayA < dayB ? 1 : -1;
    const totalA = totals.get(computeStoryId(a.item.link || a.item.article_url, a.item.title)) || 0;
    const totalB = totals.get(computeStoryId(b.item.link || b.item.article_url, b.item.title)) || 0;
    if (totalA !== totalB) return totalB - totalA;
    const timeDiff = timeOf(b.item) - timeOf(a.item);
    if (timeDiff !== 0) return timeDiff;
    return a.index - b.index;
  });
  return withIndex.map(entry => entry.item);
}

// Rank one feed's items by day + reactions. Sorts once on load — live
// reactions do not reshuffle an already-loaded feed. Adds no fields.
export async function applyReactionRanking(env, items) {
  if (!items || items.length === 0) return items;
  const totals = await fetchReactionTotals(env, items);
  return sortItemsByDayReactions(items, totals);
}

export async function getStoredNewsFeed(env, category) {
  // Phase 3 cutover: front-page spaces use interest-overlap matching first.
  // A balloon belongs to a space iff its interest_keywords overlap the
  // space's interest list, or an admin override (display_categories) names
  // the space. Falls back to the legacy category column when the interest
  // query returns zero stories or errors. 'all' uses per-category quotas
  // (everything minus excluded interests, balanced across categories).
  // display_categories overrides still win.
  // Balanced 'all': per-category quotas instead of newest-100 overall,
  // so slow categories are actually represented (see getBalancedAllFeed).
  if (category === 'all') return getBalancedAllFeed(env);
  const spaceDef = category && category !== 'all' ? SPACE_DEFINITIONS[category] : null;
  if (spaceDef && (spaceDef.interestIds || []).length > 0) {
    try {
      const interestItems = await getSpaceInterestFeed(env, category, spaceDef.interestIds);
      if (interestItems.length > 0) return { provider: 'supabase', items: await applyReactionRanking(env, interestItems) };
    } catch (err) {
      console.error('Space interest feed failed, falling back to category:', err);
    }
  }
  return getLegacyCategoryFeed(env, category);
}

// Interest-overlap feed for one front-page space: stories whose
// interest_keywords overlap the space's list, plus admin-overridden stories
// (display_categories contains the space). Excluded interests filtered out.
async function getSpaceInterestFeed(env, space, interestIds) {
  const excludedIds = [...EXCLUDED_KEYWORD_IDS];
  const makeQuery = approved => {
    const params = new URLSearchParams({
      select: 'provider,category,display_categories,interest_keywords,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,fetched_at',
      approved: `eq.${approved}`,
      removed: 'eq.false',
      or: `(interest_keywords.ov.{${interestIds.join(',')}},display_categories.cs.{${space}})`,
      order: 'published_at.desc.nullslast,fetched_at.desc',
      limit: '50'
    });
    if (excludedIds.length > 0) {
      params.set('not.and', `(interest_keywords.not.is.null,interest_keywords.ov.{${excludedIds.join(',')}})`);
    }
    return params;
  };
  const [approvedResponse, unapprovedResponse] = await Promise.all([
    fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(true)), { headers: supabaseHeaders(env) }),
    fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(false)), { headers: supabaseHeaders(env) })
  ]);
  const [approvedRows, unapprovedRows] = await Promise.all([
    readRows(approvedResponse, 'Approved space interest feed lookup'),
    readRows(unapprovedResponse, 'Unapproved space interest feed lookup')
  ]);
  const seenUrls = new Set();
  const items = [];
  for (const row of [...approvedRows, ...unapprovedRows]) {
    if (!row.article_url || seenUrls.has(row.article_url)) continue;
    seenUrls.add(row.article_url);
    items.push({ ...normalizeStory(row), approved: row.approved });
  }
  return items;
}

// Balanced 'all' feed: one capped query per front-page category (plus a
// small uncategorized bucket) instead of a single newest-first query.
// The old shape (newest 100 overall) let high-intake categories crowd out
// slow ones — live data showed 33 childcare vs 3 tech / 4 arts / 3 uplifting.
// Quotas: 8 approved + 8 unapproved per category, 4 + 4 uncategorized
// (a backlog to classify, not a category to showcase). Excluded interests
// are filtered on every bucket, same as before. One reaction-totals query
// on top; 15 fetches total, well under the subrequest limit.
const ALL_FEED_CATEGORY_QUOTA = 8;
const ALL_FEED_UNCATEGORIZED_QUOTA = 4;

async function getBalancedAllFeed(env) {
  const excludedIds = [...EXCLUDED_KEYWORD_IDS];
  const exclusionNotAnd = excludedIds.length > 0
    ? `(interest_keywords.not.is.null,interest_keywords.ov.{${excludedIds.join(',')}})`
    : null;
  const select = 'provider,category,display_categories,interest_keywords,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,fetched_at';
  const makeQuery = (approved, limit, categoryFilter) => {
    const params = new URLSearchParams({
      select,
      approved: `eq.${approved}`,
      removed: 'eq.false',
      order: 'published_at.desc.nullslast,fetched_at.desc',
      limit: String(limit)
    });
    if (categoryFilter) {
      // Same display-override rule as the legacy category feed: a story
      // shows under a category when it has no override and its assigned
      // category matches, or when its display_categories names the category.
      params.set('or', `(and(category.eq.${categoryFilter},display_categories.is.null),display_categories.cs.{${categoryFilter}})`);
    } else {
      // Uncategorized bucket: no assigned category (NULL, or the literal
      // 'all' wire stamp some ingestion paths write) and no display override.
      params.set('or', '(category.is.null,category.eq.all)');
      params.set('display_categories', 'is.null');
    }
    if (exclusionNotAnd) params.set('not.and', exclusionNotAnd);
    return params;
  };
  const buckets = NEWS_CATEGORIES.filter(c => c !== 'all');
  const requests = [];
  for (const bucket of buckets) {
    requests.push(
      fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(true, ALL_FEED_CATEGORY_QUOTA, bucket)), { headers: supabaseHeaders(env) }),
      fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(false, ALL_FEED_CATEGORY_QUOTA, bucket)), { headers: supabaseHeaders(env) })
    );
  }
  requests.push(
    fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(true, ALL_FEED_UNCATEGORIZED_QUOTA, null)), { headers: supabaseHeaders(env) }),
    fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(false, ALL_FEED_UNCATEGORIZED_QUOTA, null)), { headers: supabaseHeaders(env) })
  );
  const responses = await Promise.all(requests);
  const rowsArrays = await Promise.all(responses.map((response, i) => readRows(response, `Balanced all feed lookup ${i}`)));
  const seenUrls = new Set();
  const items = [];
  for (const rows of rowsArrays) {
    for (const row of rows) {
      if (!row.article_url || seenUrls.has(row.article_url)) continue;
      seenUrls.add(row.article_url);
      items.push({ ...normalizeStory(row), approved: row.approved });
    }
  }
  return { provider: 'supabase', items: await applyReactionRanking(env, items) };
}

// Legacy category-column feed (pre-Phase 3 behavior, kept as fallback).
async function getLegacyCategoryFeed(env, category) {
  // Stories tagged with an excluded ("Flagged") keyword never appear in
  // front-page category feeds (including "all"). They are still classifiable,
  // visible in the admin panel, and available via keyword feeds for spaces.
  // NULL interest_keywords must pass explicitly: NOT (NULL ov x) is NULL,
  // which would wrongly filter out untagged stories.
  // PostgREST does not allow `not.` inside an or=(...) logic tree, so we use
  // De Morgan's law: NOT (x NOT NULL AND x OVERLAPS {...}) == (x IS NULL OR NOT x OVERLAPS {...})
  const excludedIds = [...EXCLUDED_KEYWORD_IDS];
  const exclusionNotAnd = excludedIds.length > 0
    ? `not.and=(interest_keywords.not.is.null,interest_keywords.ov.{${excludedIds.join(',')}})`
    : null;
  const makeQuery = approved => {
    const params = new URLSearchParams({
      select: 'provider,category,display_categories,interest_keywords,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,fetched_at',
      approved: `eq.${approved}`,
      removed: 'eq.false',
      order: 'published_at.desc.nullslast,fetched_at.desc',
      limit: '50'
    });
    if (category && category !== 'all') {
      // Include admin-overridden stories: a story shows under this category when
      // it has no override (NULL display_categories) and its assigned category
      // matches, or when its display_categories list contains this category.
      // (The PATCH endpoint normalizes empty lists to NULL, so is.null is enough.)
      params.set('or', `(and(category.eq.${category},display_categories.is.null),display_categories.cs.{${category}})`);
    }
    if (exclusionNotAnd) {
      // PostgREST ANDs top-level params: (category match) AND NOT (tagged AND overlaps excluded)
      params.set('not.and', `(interest_keywords.not.is.null,interest_keywords.ov.{${excludedIds.join(',')}})`);
    }
    return params;
  };
  const [approvedResponse, unapprovedResponse] = await Promise.all([
    fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(true)), {
      headers: supabaseHeaders(env)
    }),
    fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(false)), {
      headers: supabaseHeaders(env)
    })
  ]);
  const [approvedRows, unapprovedRows] = await Promise.all([
    readRows(approvedResponse, 'Approved news feed lookup'),
    readRows(unapprovedResponse, 'Unapproved news feed lookup')
  ]);
  const seenUrls = new Set();
  const items = [];
  for (const row of [...approvedRows, ...unapprovedRows]) {
    if (seenUrls.has(row.article_url)) continue;
    seenUrls.add(row.article_url);
    items.push({ ...normalizeStory(row), approved: row.approved });
  }
  return { provider: 'supabase', items: await applyReactionRanking(env, items) };
}

const KEYWORD_EMBEDDINGS_TABLE = 'keyword_embeddings';
// Max keyword descriptions to embed per invocation — the backfill runs as a
// standalone step (never alongside story validation), so this stays safely
// under subrequest budgets.
const KEYWORD_EMBED_CHUNK = 25;
// In-memory cache for the full keyword vector map (per worker isolate).
let cachedKeywordVectors = null;

/**
 * Get embedding vectors for all interest keyword descriptions.
 *
 * Vectors are persisted to the `keyword_embeddings` Supabase table so the
 * 100 descriptions are embedded once, not on every cold start. Missing
 * vectors are backfilled ONE CHUNK per call — the caller (validate endpoint)
 * runs this as a standalone step and returns early while warming up, so the
 * backfill's AI calls never share an invocation budget with story validation.
 *
 * All-or-nothing: `vectors` is null until EVERY keyword has a vector, so
 * stories are never tagged against a partial keyword set.
 *
 * @returns {Promise<{vectors: Map<string,number[]>|null, complete: boolean, done: number, total: number}>}
 */
/**
 * Read-only warmup status: how many keyword vectors are stored, without
 * triggering a backfill round. 1 Supabase lookup, 0 AI calls — safe to
 * poll for progress display.
 */
export async function getKeywordVectorStatus(env) {
  const total = INTEREST_KEYWORDS.length;
  if (cachedKeywordVectors) {
    return { complete: true, done: total, total };
  }
  let done = 0;
  try {
    const params = new URLSearchParams({ select: 'keyword_id,model' });
    const res = await fetch(supabaseUrl(env, KEYWORD_EMBEDDINGS_TABLE, params), {
      headers: supabaseHeaders(env),
    });
    const rows = await readRows(res, 'Keyword vector status check');
    const seen = new Set();
    for (const row of rows) {
      if (row.model === KEYWORD_VECTOR_MODEL && !seen.has(row.keyword_id)) {
        seen.add(row.keyword_id);
        done++;
      }
    }
  } catch (err) {
    console.warn('Keyword vector status check failed:', err?.message || err);
  }
  return { complete: done === total, done, total };
}

export async function getPersistedKeywordEmbeddings(env) {
  const total = INTEREST_KEYWORDS.length;
  if (cachedKeywordVectors) {
    return { vectors: cachedKeywordVectors, complete: true, done: total, total };
  }
  if (!env?.AI) return { vectors: null, complete: false, done: 0, total };

  // 1. Load whatever is already stored.
  const map = new Map();
  let lookupError = null;
  try {
    const params = new URLSearchParams({ select: 'keyword_id,embedding,model' });
    const res = await fetch(supabaseUrl(env, KEYWORD_EMBEDDINGS_TABLE, params), {
      headers: supabaseHeaders(env),
    });
    const rows = await readRows(res, 'Keyword embeddings lookup');
    for (const row of rows) {
      if (
        row.model === KEYWORD_VECTOR_MODEL &&
        Array.isArray(row.embedding) &&
        row.embedding.length > 0
      ) {
        map.set(row.keyword_id, row.embedding);
      }
    }
  } catch (err) {
    lookupError = err?.message || String(err);
    console.warn('Keyword embeddings lookup failed:', lookupError);
  }

  // 2. Backfill ONE chunk of missing vectors per call.
  const missing = INTEREST_KEYWORDS.filter((kw) => !map.has(kw.id));
  const chunk = missing.slice(0, KEYWORD_EMBED_CHUNK);
  let upsertError = null;
  let upserted = 0;
  if (chunk.length > 0) {
    const vectors = await Promise.all(chunk.map((kw) => embedText(env, kw.description)));
    const upserts = [];
    chunk.forEach((kw, j) => {
      if (vectors[j]) {
        map.set(kw.id, vectors[j]);
        upserts.push({ keyword_id: kw.id, embedding: vectors[j], model: KEYWORD_VECTOR_MODEL });
      }
    });
    if (upserts.length > 0) {
      try {
        const upsertParams = new URLSearchParams({ on_conflict: 'keyword_id' });
        const upsertRes = await fetch(supabaseUrl(env, KEYWORD_EMBEDDINGS_TABLE, upsertParams), {
          method: 'POST',
          headers: supabaseHeaders(env, { Prefer: 'resolution=merge-duplicates' }),
          body: JSON.stringify(upserts),
        });
        if (!upsertRes.ok) {
          const errText = await upsertRes.text().catch(() => 'unknown');
          throw new Error(`HTTP ${upsertRes.status}: ${errText.slice(0, 200)}`);
        }
        upserted = upserts.length;
      } catch (err) {
        upsertError = err?.message || String(err);
        console.warn('Keyword embeddings upsert failed:', upsertError);
      }
    }
    const warmupUsage = createAiUsageCounter();
    const warmupSucceeded = vectors.filter((v) => Boolean(v)).length;
    warmupUsage.add(AI_USAGE_MODEL_BGE, 'warmup', warmupSucceeded, chunk.length - warmupSucceeded);
    await warmupUsage.flush(env);
  }

  const done = map.size;
  if (done !== total) {
    console.warn(
      `Keyword embeddings incomplete (${done}/${total}); backfilled ${chunk.length} this run, skipping keyword tagging.`
    );
    return { vectors: null, complete: false, done, total, lookupError, upsertError, upserted };
  }
  cachedKeywordVectors = map;
  return { vectors: map, complete: true, done, total };
}

/** Clear the in-memory keyword vector cache (useful for tests). */
export function clearKeywordVectorCache() {
  cachedKeywordVectors = null;
}

/**
 * Feed of stories tagged with an interest keyword (for custom spaces).
 * Interest keywords never appear as categories; this is the only public
 * read path for them.
 */
export async function getStoriesByKeyword(env, keyword) {
  const makeQuery = approved => {
    const params = new URLSearchParams({
      select: 'provider,category,display_categories,interest_keywords,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,fetched_at',
      approved: `eq.${approved}`,
      removed: 'eq.false',
      'interest_keywords': `cs.{${keyword}}`,
      order: 'published_at.desc.nullslast,fetched_at.desc',
      limit: '50'
    });
    return params;
  };
  const [approvedResponse, unapprovedResponse] = await Promise.all([
    fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(true)), {
      headers: supabaseHeaders(env)
    }),
    fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(false)), {
      headers: supabaseHeaders(env)
    })
  ]);
  const [approvedRows, unapprovedRows] = await Promise.all([
    readRows(approvedResponse, 'Approved keyword feed lookup'),
    readRows(unapprovedResponse, 'Unapproved keyword feed lookup')
  ]);
  const seenUrls = new Set();
  const items = [];
  for (const row of [...approvedRows, ...unapprovedRows]) {
    if (seenUrls.has(row.article_url)) continue;
    seenUrls.add(row.article_url);
    items.push({ ...normalizeStory(row), approved: row.approved });
  }
  return { provider: 'supabase', items };
}

const MAX_PROVIDER_FETCH_LOGS = 300;
export const HOURLY_SYNC_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 3600;

const providerFetchLogsMemory = [];
const providerCooldownMemory = new Map();
const autoSyncStateMemory = {
  enabled: true,
  intervalMs: HOURLY_SYNC_INTERVAL_MS,
  lastRunAt: null,
  lastTrigger: null,
  lastStatus: 'never',
  lastSummary: null,
  updatedBy: 'system',
  updatedAt: null
};
let nextLogId = 1;

export function getProviderCooldownState(providerId) {
  const entry = providerCooldownMemory.get(providerId);
  if (!entry) return null;
  if (entry.cooldownUntil) {
    const expiresAt = Date.parse(entry.cooldownUntil);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      providerCooldownMemory.delete(providerId);
      return null;
    }
  }
  return entry;
}

export function setProviderCooldownState(providerId, {
  cooldownUntil,
  rateLimitResetAt = null,
  retryAfterSeconds = null,
  rateLimitRemaining = null,
  lastError = null,
  failoverProvider = null,
  failoverCategories = []
} = {}) {
  const entry = {
    provider: providerId,
    cooldownUntil: cooldownUntil || new Date(Date.now() + DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS * 1000).toISOString(),
    rateLimitResetAt: rateLimitResetAt || cooldownUntil || null,
    retryAfterSeconds: retryAfterSeconds ?? null,
    rateLimitRemaining: rateLimitRemaining ?? null,
    lastError: lastError || null,
    failoverProvider: failoverProvider || null,
    failoverCategories: Array.isArray(failoverCategories) ? failoverCategories : [],
    recordedAt: new Date().toISOString()
  };
  providerCooldownMemory.set(providerId, entry);
  return entry;
}

export function clearProviderCooldownState(providerId) {
  providerCooldownMemory.delete(providerId);
}

/**
 * Persist a provider cooldown to the DB so it survives worker restarts.
 * Fire-and-forget: call without awaiting, or via ctx.waitUntil.
 */
export async function persistProviderCooldown(env, providerId, cooldownData = {}) {
  try {
    const url = supabaseUrl(env, 'news_provider_sync', new URLSearchParams({
      on_conflict: 'provider'
    }));
    const body = {
      provider: providerId,
      cooldown_until: cooldownData.cooldownUntil || null,
      rate_limit_reset_at: cooldownData.rateLimitResetAt || null,
      status: 'rate_limited',
      last_error: cooldownData.lastError || null,
      updated_at: new Date().toISOString()
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(env),
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.warn(`Failed to persist cooldown for ${providerId}: ${res.status}`);
    }
  } catch (err) {
    console.warn(`Failed to persist cooldown for ${providerId}:`, err.message);
  }
}

/**
 * Load active cooldowns from DB into memory (call on worker startup or when
 * in-memory is empty). Returns count loaded.
 */
export async function loadProviderCooldownsFromDb(env) {
  try {
    const params = new URLSearchParams({
      select: 'provider,cooldown_until,rate_limit_reset_at,last_error',
      cooldown_until: `gt.${new Date().toISOString()}`
    });
    const res = await fetch(supabaseUrl(env, 'news_provider_sync', params), {
      headers: supabaseHeaders(env)
    });
    if (!res.ok) return 0;
    const rows = await res.json();
    let loaded = 0;
    for (const row of rows) {
      if (row.provider && row.cooldown_until) {
        providerCooldownMemory.set(row.provider, {
          provider: row.provider,
          cooldownUntil: row.cooldown_until,
          rateLimitResetAt: row.rate_limit_reset_at || null,
          retryAfterSeconds: null,
          rateLimitRemaining: null,
          lastError: row.last_error || null,
          failoverProvider: null,
          failoverCategories: [],
          recordedAt: new Date().toISOString()
        });
        loaded++;
      }
    }
    return loaded;
  } catch (err) {
    console.warn('Failed to load cooldowns from DB:', err.message);
    return 0;
  }
}

let providerCooldownsLoadedAt = 0;

// Load persisted cooldowns into memory, at most once per maxAgeMs.
// Previously loadProviderCooldownsFromDb had no callers, so a cold-started
// worker forgot every cooldown and re-hammered cooling providers until the
// next 429. Call this at the start of scheduled and manual sync runs.
export async function loadProviderCooldownsFromDbIfStale(env, maxAgeMs = 5 * 60 * 1000) {
  if (Date.now() - providerCooldownsLoadedAt < maxAgeMs) return false;
  const loaded = await loadProviderCooldownsFromDb(env);
  providerCooldownsLoadedAt = Date.now();
  return loaded;
}

/**
 * Enqueue a provider/category fetch for retry after a rate limit (or failure).
 * Upserts: one pending/running row per (provider, category); re-queues with the
 * new not_before time. Done/failed rows are replaced so the combo can retry again.
 */
export async function enqueueProviderRetry(env, providerId, category, { notBefore, error, maxAttempts = 5 } = {}) {
  try {
    const url = supabaseUrl(env, 'provider_retry_queue', new URLSearchParams({ on_conflict: 'provider,category' }));
    const body = {
      provider: providerId,
      category: category || 'all',
      status: 'pending',
      not_before: notBefore || new Date().toISOString(),
      attempts: 0,
      last_error: error || null,
      max_attempts: maxAttempts,
      updated_at: new Date().toISOString()
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...supabaseHeaders(env), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.warn(`Failed to enqueue retry for ${providerId}/${category}: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`Failed to enqueue retry for ${providerId}/${category}:`, err.message);
    return false;
  }
}

/**
 * Fetch due retry jobs (status=pending, not_before <= now), oldest first,
 * and mark them running so concurrent drains don't double-process.
 * Bounded by limit to stay under the subrequest budget.
 */
export async function drainDueRetries(env, { limit = 10 } = {}) {
  try {
    const params = new URLSearchParams({
      select: 'id,provider,category,attempts,max_attempts,last_error',
      status: 'eq.pending',
      not_before: `lte.${new Date().toISOString()}`,
      order: 'created_at.asc',
      limit: String(limit)
    });
    const res = await fetch(supabaseUrl(env, 'provider_retry_queue', params), { headers: supabaseHeaders(env) });
    if (!res.ok) return [];
    const rows = await res.json();
    const claimed = [];
    for (const row of rows) {
      const claimRes = await fetch(
        supabaseUrl(env, 'provider_retry_queue', new URLSearchParams({ id: `eq.${row.id}`, status: 'eq.pending' })),
        {
          method: 'PATCH',
          headers: { ...supabaseHeaders(env), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'running', updated_at: new Date().toISOString() })
        }
      );
      if (claimRes.ok) claimed.push(row);
    }
    return claimed;
  } catch (err) {
    console.warn('Failed to drain retry queue:', err.message);
    return [];
  }
}

/**
 * Mark a retry job done, or re-queue it with backoff when it fails again.
 * Returns 'done' | 'requeued' | 'failed'.
 */
export async function completeRetryJob(env, jobId, { success, notBefore, error } = {}) {
  try {
    if (success) {
      await fetch(supabaseUrl(env, 'provider_retry_queue', new URLSearchParams({ id: `eq.${jobId}` })), {
        method: 'PATCH',
        headers: { ...supabaseHeaders(env), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done', updated_at: new Date().toISOString() })
      });
      return 'done';
    }
    // Re-read attempts to decide between requeue and give-up
    const getRes = await fetch(
      supabaseUrl(env, 'provider_retry_queue', new URLSearchParams({ select: 'attempts,max_attempts', id: `eq.${jobId}` })),
      { headers: supabaseHeaders(env) }
    );
    const rows = getRes.ok ? await getRes.json() : [];
    const attempts = (rows[0]?.attempts ?? 0) + 1;
    const maxAttempts = rows[0]?.max_attempts ?? 5;
    if (attempts >= maxAttempts) {
      await fetch(supabaseUrl(env, 'provider_retry_queue', new URLSearchParams({ id: `eq.${jobId}` })), {
        method: 'PATCH',
        headers: { ...supabaseHeaders(env), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'failed', attempts, last_error: error || null, updated_at: new Date().toISOString() })
      });
      return 'failed';
    }
    // Exponential backoff when no explicit not_before (e.g. non-429 errors): 2^attempts minutes
    const backoffMs = notBefore
      ? null
      : Math.min(2 ** attempts * 60 * 1000, 6 * 3600 * 1000);
    await fetch(supabaseUrl(env, 'provider_retry_queue', new URLSearchParams({ id: `eq.${jobId}` })), {
      method: 'PATCH',
      headers: { ...supabaseHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'pending',
        attempts,
        not_before: notBefore || new Date(Date.now() + backoffMs).toISOString(),
        last_error: error || null,
        updated_at: new Date().toISOString()
      })
    });
    return 'requeued';
  } catch (err) {
    console.warn(`Failed to complete retry job ${jobId}:`, err.message);
    return 'failed';
  }
}

/**
 * Count pending/running retries (for admin display).
 */
export async function countQueuedRetries(env) {
  try {
    const params = new URLSearchParams({ select: 'id', status: 'in.(pending,running)' });
    const res = await fetch(supabaseUrl(env, 'provider_retry_queue', params), {
      headers: { ...supabaseHeaders(env), Prefer: 'count=exact' }
    });
    if (!res.ok) return 0;
    const range = res.headers.get('Content-Range') || '';
    const total = Number(range.match(/\/(\d+|\*)$/)?.[1]);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}

export function getAutoSyncState() {
  const lastRunMs = autoSyncStateMemory.lastRunAt ? Date.parse(autoSyncStateMemory.lastRunAt) : NaN;
  const nextRunMs = Number.isFinite(lastRunMs)
    ? lastRunMs + autoSyncStateMemory.intervalMs
    : Date.now() + autoSyncStateMemory.intervalMs;
  const isStale = autoSyncStateMemory.enabled && (
    !Number.isFinite(lastRunMs) || (Date.now() - lastRunMs) >= autoSyncStateMemory.intervalMs
  );
  return {
    ...autoSyncStateMemory,
    nextRunAt: autoSyncStateMemory.enabled ? new Date(nextRunMs).toISOString() : null,
    isStale
  };
}

export function setAutoSyncState(updates = {}) {
  if (typeof updates.enabled === 'boolean') autoSyncStateMemory.enabled = updates.enabled;
  if (updates.lastRunAt !== undefined) autoSyncStateMemory.lastRunAt = updates.lastRunAt;
  if (updates.lastTrigger !== undefined) autoSyncStateMemory.lastTrigger = updates.lastTrigger;
  if (updates.lastStatus !== undefined) autoSyncStateMemory.lastStatus = updates.lastStatus;
  if (updates.lastSummary !== undefined) autoSyncStateMemory.lastSummary = updates.lastSummary;
  if (updates.updatedBy !== undefined) autoSyncStateMemory.updatedBy = updates.updatedBy;
  autoSyncStateMemory.updatedAt = new Date().toISOString();
  return getAutoSyncState();
}

function normalizeProviderFetchLog(entry) {
  return {
    id: nextLogId++,
    provider: entry.provider || 'unknown',
    providerLabel: entry.providerLabel || entry.provider || 'Unknown',
    category: entry.category || 'all',
    triggerSource: entry.triggerSource || 'manual',
    status: entry.status || 'succeeded',
    httpStatus: entry.httpStatus ?? null,
    durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.round(entry.durationMs)) : 0,
    attemptCount: Number.isFinite(entry.attemptCount) ? Math.max(1, Math.round(entry.attemptCount)) : 1,
    itemsFetched: Number.isFinite(entry.itemsFetched) ? Math.max(0, Math.round(entry.itemsFetched)) : 0,
    storiesSaved: Number.isFinite(entry.storiesSaved) ? Math.max(0, Math.round(entry.storiesSaved)) : 0,
    duplicatesSkipped: Number.isFinite(entry.duplicatesSkipped) ? Math.max(0, Math.round(entry.duplicatesSkipped)) : 0,
    retryAfterSeconds: entry.retryAfterSeconds ?? null,
    rateLimitRemaining: entry.rateLimitRemaining ?? null,
    rateLimitReset: entry.rateLimitReset ?? null,
    requestUrl: entry.requestUrl || '',
    errorMessage: entry.errorMessage || null,
    failoverProvider: entry.failoverProvider || null,
    createdAt: entry.createdAt || new Date().toISOString()
  };
}

function providerFetchLogDbRow(normalized) {
  return {
    provider: normalized.provider,
    category: normalized.category,
    trigger_source: normalized.triggerSource,
    status: normalized.status,
    http_status: normalized.httpStatus,
    duration_ms: normalized.durationMs,
    attempt_count: normalized.attemptCount,
    items_fetched: normalized.itemsFetched,
    stories_saved: normalized.storiesSaved,
    retry_after_seconds: normalized.retryAfterSeconds,
    rate_limit_remaining: normalized.rateLimitRemaining,
    rate_limit_reset: normalized.rateLimitReset,
    request_url: normalized.requestUrl,
    error_message: normalized.errorMessage,
    failover_provider: normalized.failoverProvider,
    created_at: normalized.createdAt
  };
}

export async function recordNewsProviderFetchLog(env, entry) {
  const normalized = normalizeProviderFetchLog(entry);

  providerFetchLogsMemory.unshift(normalized);
  if (providerFetchLogsMemory.length > MAX_PROVIDER_FETCH_LOGS) {
    providerFetchLogsMemory.length = MAX_PROVIDER_FETCH_LOGS;
  }

  // Always persist to Supabase (30-day retention via pruneOldProviderLogs).
  // Failures are logged, never thrown.
  try {
    await fetch(supabaseUrl(env, 'news_provider_logs'), {
        method: 'POST',
        headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
        body: JSON.stringify([providerFetchLogDbRow(normalized)])
      });
    } catch (err) {
      console.warn('Could not persist provider fetch log to Supabase:', err);
    }

  return normalized;
}

// Bulk-persist accumulated fetch-log entries in one POST (Phase 1 batching).
// Falls back to individual posts on failure; never throws, so logging can
// never break a sync run. Returns the number of entries accepted for write.
export async function flushProviderFetchLogs(env, entries) {
  if (!entries?.length) return 0;
  const normalized = entries.map(normalizeProviderFetchLog);
  for (const entry of normalized) providerFetchLogsMemory.unshift(entry);
  if (providerFetchLogsMemory.length > MAX_PROVIDER_FETCH_LOGS) {
    providerFetchLogsMemory.length = MAX_PROVIDER_FETCH_LOGS;
  }
  const rows = normalized.map(providerFetchLogDbRow);
  try {
    const res = await fetch(supabaseUrl(env, 'news_provider_logs'), {
      method: 'POST',
      headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify(rows)
    });
    if (res.ok) return rows.length;
  } catch (err) {
    console.warn('Could not bulk-persist provider fetch logs, falling back to individual posts:', err);
  }
  for (const row of rows) {
    try {
      await fetch(supabaseUrl(env, 'news_provider_logs'), {
        method: 'POST',
        headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
        body: JSON.stringify([row])
      });
    } catch (err) {
      console.warn('Could not persist provider fetch log to Supabase:', err);
    }
  }
  return rows.length;
}

export function getNewsProviderFetchLogs({
  provider = 'all',
  status = 'all',
  category = 'all',
  limit = 100
} = {}) {
  const filtered = providerFetchLogsMemory.filter((log) => {
    if (provider && provider !== 'all' && log.provider !== provider) return false;
    if (category && category !== 'all' && log.category !== category) return false;
    if (status && status !== 'all') {
      if (status === 'failover') {
        if (!log.failoverProvider && log.triggerSource !== 'failover') return false;
      } else if (log.status !== status) {
        return false;
      }
    }
    return true;
  });

  const totalRequests = providerFetchLogsMemory.length;
  const rateLimitedCount = providerFetchLogsMemory.filter(l => l.status === 'rate_limited').length;
  const failedCount = providerFetchLogsMemory.filter(l => l.status === 'failed').length;
  const failoverCount = providerFetchLogsMemory.filter(l => Boolean(l.failoverProvider) || l.triggerSource === 'failover').length;
  const totalDuration = providerFetchLogsMemory.reduce((acc, l) => acc + (l.durationMs || 0), 0);
  const averageLatencyMs = totalRequests > 0 ? Math.round(totalDuration / totalRequests) : 0;

  return {
    logs: filtered.slice(0, Math.max(1, Math.min(300, Number(limit) || 100))),
    totalMatching: filtered.length,
    summary: {
      totalRequests,
      rateLimitedCount,
      failedCount,
      failoverCount,
      averageLatencyMs
    }
  };
}

export function clearNewsProviderFetchLogs() {
  providerFetchLogsMemory.length = 0;
}

/**
 * Delete provider fetch logs older than 30 days. Called from the cron.
 */
export async function pruneOldProviderLogs(env) {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const res = await fetch(
      supabaseUrl(env, 'news_provider_logs', new URLSearchParams({ created_at: `lt.${cutoff}` })),
      { method: 'DELETE', headers: supabaseHeaders(env, { Prefer: 'return=minimal' }) }
    );
    if (!res.ok) console.warn(`Log prune failed: ${res.status}`);
  } catch (err) {
    console.warn('Log prune failed:', err.message);
  }
}

/**
 * Read provider fetch logs from the DB table (last 30 days), newest first.
 * Used by /admin/api/logs so the viewer shows full history, not just in-memory.
 */
export async function getNewsProviderFetchLogsFromDb(env, {
  provider = 'all',
  status = 'all',
  category = 'all',
  limit = 100
} = {}) {
  try {
    const params = new URLSearchParams({
      select: 'provider,category,trigger_source,status,http_status,duration_ms,attempt_count,items_fetched,stories_saved,retry_after_seconds,rate_limit_remaining,rate_limit_reset,request_url,error_message,failover_provider,created_at',
      order: 'created_at.desc',
      limit: String(Math.min(Math.max(limit, 1), 500))
    });
    if (provider && provider !== 'all') params.set('provider', `eq.${provider}`);
    if (category && category !== 'all') params.set('category', `eq.${category}`);
    if (status && status !== 'all') params.set('status', `eq.${status}`);
    const res = await fetch(supabaseUrl(env, 'news_provider_logs', params), { headers: supabaseHeaders(env) });
    if (!res.ok) return { logs: [], totalRequests: 0 };
    const rows = await res.json();
    const logs = rows.map((row, i) => ({
      id: `db-${row.created_at}-${i}`,
      provider: row.provider,
      providerLabel: row.provider,
      category: row.category,
      triggerSource: row.trigger_source,
      status: row.status,
      httpStatus: row.http_status,
      durationMs: row.duration_ms,
      attemptCount: row.attempt_count,
      itemsFetched: row.items_fetched,
      storiesSaved: row.stories_saved,
      duplicatesSkipped: 0,
      retryAfterSeconds: row.retry_after_seconds,
      rateLimitRemaining: row.rate_limit_remaining,
      rateLimitReset: row.rate_limit_reset,
      requestUrl: row.request_url,
      errorMessage: row.error_message,
      failoverProvider: row.failover_provider,
      createdAt: row.created_at
    }));
    return {
      logs,
      totalRequests: logs.length,
      summary: {
        totalRequests: logs.length,
        rateLimitedCount: logs.filter(l => l.status === 'rate_limited').length,
        failedCount: logs.filter(l => l.status === 'failed').length
      }
    };
  } catch (err) {
    console.warn('DB log read failed:', err.message);
    return { logs: [], totalRequests: 0 };
  }
}

// Recent sync runs for the admin panel run strip. Fail-open: if the table
// is missing (migration not yet applied) the strip just shows nothing.
export async function getRecentSyncRuns(env, limit = 5) {
  try {
    const query = new URLSearchParams({
      select: 'id,trigger,provider,status,started_at,finished_at,pairs_total,pairs_done,current_provider,current_category,last_activity_at,last_telemetry,summary',
      order: 'started_at.desc',
      limit: String(limit)
    });
    const res = await fetch(supabaseUrl(env, SYNC_RUNS_TABLE, query), {
      headers: supabaseHeaders(env)
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// Per-provider profile for the admin dashboard: info, live status, last
// runs, 30-day lifetime totals from the request logs, and recent requests.
// Returns null for an unknown provider. The provider row fetch throws on
// failure (the route turns it into a 502); the supplementary sections
// fail open to empty so one bad query cannot blank the whole profile.
// Lifetime totals come from news_provider_logs, which the cron prunes at
// 30 days — so "lifetime" here means the last 30 days, not all time.
export async function getProviderProfile(env, providerId) {
  const config = getNewsProviderConfig(providerId);
  if (!config) return null;
  const rowQuery = new URLSearchParams({
    select: 'provider,status,started_at,last_attempt_at,last_success_at,stories_saved,last_error,cooldown_until,rate_limit_reset_at,updated_at',
    provider: `eq.${providerId}`
  });
  const rowRes = await fetch(supabaseUrl(env, SYNC_TABLE, rowQuery), {
    headers: supabaseHeaders(env)
  });
  if (!rowRes.ok) throw new Error(`Provider status lookup failed (HTTP ${rowRes.status})`);
  const rowRows = await rowRes.json();
  const row = Array.isArray(rowRows) && rowRows.length ? rowRows[0] : {
    provider: providerId,
    status: 'never',
    started_at: null,
    last_attempt_at: null,
    last_success_at: null,
    stories_saved: 0,
    last_error: null,
    cooldown_until: null,
    rate_limit_reset_at: null,
    updated_at: null
  };
  const cooldown = getProviderCooldownState(providerId);
  const runs = await getRecentSyncRuns(env, 20);
  const activeRun = runs.find(r => r.status === 'running') || null;
  const activeEntry = activeRun?.summary?.providers?.find(p => p.provider === providerId) || null;
  const runEntryFor = (run) => {
    const entry = (run.summary?.providers || []).find(p => p.provider === providerId);
    if (entry) return entry;
    if (run.provider === providerId) return { status: null, storiesSaved: null, lastCategory: null };
    return null;
  };
  const lastRuns = [];
  for (const run of runs) {
    const entry = runEntryFor(run);
    if (!entry) continue;
    lastRuns.push({
      id: run.id,
      trigger: run.trigger,
      status: run.status,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      pairsDone: run.pairs_done,
      pairsTotal: run.pairs_total,
      providerStatus: entry?.status ?? entry?.lastStatus ?? null,
      storiesSaved: entry?.storiesSaved ?? null,
      lastCategory: entry?.lastCategory ?? null
    });
  }
  let lifetime = null;
  let recentLogs = [];
  try {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const lifetimeRows = [];
    let offset = 0;
    let truncated = false;
    for (let page = 0; page < 10; page++) {
      const pageQuery = new URLSearchParams({
        select: 'status,items_fetched,stories_saved,created_at',
        provider: `eq.${providerId}`,
        created_at: `gte.${since}`,
        order: 'created_at.desc',
        limit: '1000',
        offset: String(offset)
      });
      const pageRes = await fetch(supabaseUrl(env, 'news_provider_logs', pageQuery), {
        headers: supabaseHeaders(env)
      });
      if (!pageRes.ok) throw new Error(`Provider log lookup failed (HTTP ${pageRes.status})`);
      const pageRows = await pageRes.json();
      if (!Array.isArray(pageRows)) break;
      lifetimeRows.push(...pageRows);
      if (pageRows.length < 1000) break;
      offset += 1000;
      if (page === 9) truncated = true;
    }
    let fetched = 0;
    let saved = 0;
    let succeeded = 0;
    let failed = 0;
    let rateLimited = 0;
    let lastSuccessAt = null;
    for (const logRow of lifetimeRows) {
      fetched += Number(logRow.items_fetched) || 0;
      saved += Number(logRow.stories_saved) || 0;
      if (logRow.status === 'succeeded') {
        succeeded++;
        if (!lastSuccessAt) lastSuccessAt = logRow.created_at;
      } else if (logRow.status === 'failed') {
        failed++;
      } else if (logRow.status === 'rate_limited') {
        rateLimited++;
      }
    }
    lifetime = {
      windowDays: 30,
      totalRequests: lifetimeRows.length,
      fetched,
      saved,
      succeeded,
      failed,
      rateLimited,
      lastSuccessAt,
      truncated
    };
    const recentQuery = new URLSearchParams({
      select: 'category,trigger_source,status,http_status,duration_ms,attempt_count,items_fetched,stories_saved,error_message,created_at',
      provider: `eq.${providerId}`,
      order: 'created_at.desc',
      limit: '10'
    });
    const recentRes = await fetch(supabaseUrl(env, 'news_provider_logs', recentQuery), {
      headers: supabaseHeaders(env)
    });
    if (recentRes.ok) {
      const recentRows = await recentRes.json();
      if (Array.isArray(recentRows)) recentLogs = recentRows;
    }
  } catch (err) {
    console.warn(`Provider profile log aggregation failed for ${providerId}:`, err.message);
    lifetime = null;
    recentLogs = [];
  }
  return {
    provider: {
      id: providerId,
      label: config.label,
      description: config.description || '',
      adapter: config.adapter,
      endpoint: config.endpoint || '',
      categories: Object.keys(config.categories || {}),
      updatePauseMs: config.updatePauseMs || 0,
      credentialName: config.credential || null,
      credentialConfigured: !config.credential || Boolean(env[config.credential]),
      status: row.status,
      startedAt: row.started_at,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      storiesSavedLastRun: row.stories_saved,
      lastError: row.last_error,
      cooldownUntil: cooldown?.cooldownUntil || row.cooldown_until || null,
      rateLimitResetAt: cooldown?.rateLimitResetAt || row.rate_limit_reset_at || null,
      rateLimitRemaining: cooldown?.rateLimitRemaining ?? null,
      updatedAt: row.updated_at
    },
    live: {
      running: row.status === 'running',
      activeRun: activeRun ? {
        id: activeRun.id,
        trigger: activeRun.trigger,
        startedAt: activeRun.started_at,
        currentProvider: activeRun.current_provider,
        currentCategory: activeRun.current_category,
        pairsDone: activeRun.pairs_done,
        pairsTotal: activeRun.pairs_total,
        lastActivityAt: activeRun.last_activity_at
      } : null,
      pairsDone: activeEntry?.pairs ?? 0,
      pairsTotal: activeRun?.pairs_total ?? 7,
      isCurrentPair: activeRun?.current_provider === providerId
    },
    lastRuns,
    lifetime,
    recentLogs
  };
}

// Logs for the admin panel: the database is the source of truth (it
// survives worker redeploys), with the in-memory ring as fallback for
// entries whose DB write failed. Reading the ring alone blanks the list
// after every redeploy.
async function getSnapshotProviderLogs(env) {
  const db = await getNewsProviderFetchLogsFromDb(env, { limit: 100 });
  if (db.logs.length) return db;
  return getNewsProviderFetchLogs({ limit: 100 });
}

export async function getNewsAdminSnapshot(env, providers, pendingProvider = null) {
  const storyCountQuery = new URLSearchParams({ select: 'id' });
  const recentQuery = new URLSearchParams({
    select: 'id,provider,category,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,removed,removed_at,fetched_at,decision_action,decision_by,decision_at,previous_approved,previous_removed,interest_keywords',
    decision_at: 'not.is.null',
    order: 'decision_at.desc'
  });
  const pendingQuery = new URLSearchParams({
    select: 'id,provider,category,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,removed,fetched_at,decision_action,interest_keywords',
    approved: 'eq.false',
    removed: 'eq.false',
    or: '(decision_action.is.null,decision_action.eq.undo)',
    order: 'fetched_at.desc',
    limit: '100'
  });
  if (pendingProvider) pendingQuery.set('provider', `eq.${pendingProvider}`);
  const bannedQuery = new URLSearchParams({
    select: 'id,provider,category,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,removed,removed_at,fetched_at,decision_action,decision_by,decision_at,previous_approved,previous_removed,interest_keywords',
    removed: 'eq.true',
    order: 'removed_at.desc.nullslast',
    limit: '100'
  });
  // Stories awaiting interest classification: not removed, no interest tags yet.
  // These are invisible to Phase 3 interest feeds (except via zero-match fallback).
  const unclassifiedQuery = new URLSearchParams({
    select: 'id',
    removed: 'eq.false',
    interest_keywords: 'is.null'
  });
  const providerCountRequests = providers.map(provider => {
    const query = new URLSearchParams({
      select: 'id',
      provider: `eq.${provider.id}`
    });
    return fetch(supabaseUrl(env, STORIES_TABLE, query), {
      headers: supabaseHeaders(env, { Range: '0-0', Prefer: 'count=exact' })
    });
  });
  const [countResponse, recentResponse, pendingResponse, bannedResponse, syncResponse, unclassifiedResponse, ...providerCountResponses] = await Promise.all([
    fetch(supabaseUrl(env, STORIES_TABLE, storyCountQuery), {
      headers: supabaseHeaders(env, { Range: '0-0', Prefer: 'count=exact' })
    }),
    fetch(supabaseUrl(env, STORIES_TABLE, recentQuery), {
      headers: supabaseHeaders(env)
    }),
    fetch(supabaseUrl(env, STORIES_TABLE, pendingQuery), {
      headers: supabaseHeaders(env)
    }),
    fetch(supabaseUrl(env, STORIES_TABLE, bannedQuery), {
      headers: supabaseHeaders(env)
    }),
    fetch(supabaseUrl(env, SYNC_TABLE, 'select=provider,status,started_at,last_attempt_at,last_success_at,stories_saved,last_error,updated_by'), {
      headers: supabaseHeaders(env)
    }),
    fetch(supabaseUrl(env, STORIES_TABLE, unclassifiedQuery), {
      headers: supabaseHeaders(env, { Range: '0-0', Prefer: 'count=exact' })
    }),
    ...providerCountRequests
  ]);
  if (!countResponse.ok) throw new Error(`Story count lookup failed (HTTP ${countResponse.status})`);
  const contentRange = countResponse.headers.get('Content-Range') || '';
  const total = Number(contentRange.match(/\/(\d+|\*)$/)?.[1]);
  if (!Number.isFinite(total)) throw new Error('Story count lookup returned no exact count');
  if (!unclassifiedResponse.ok) throw new Error(`Unclassified count lookup failed (HTTP ${unclassifiedResponse.status})`);
  const unclassifiedRange = unclassifiedResponse.headers.get('Content-Range') || '';
  const unclassifiedTotal = Number(unclassifiedRange.match(/\/(\d+|\*)$/)?.[1]);
  if (!Number.isFinite(unclassifiedTotal)) throw new Error('Unclassified count lookup returned no exact count');
  const recentRows = await readRows(recentResponse, 'Recent story lookup');
  const pendingRows = await readRows(pendingResponse, 'Unapproved story lookup');
  const bannedRows = await readRows(bannedResponse, 'Banned story lookup');
  const syncRows = await readRows(syncResponse, 'Provider status lookup');
  const syncByProvider = new Map(syncRows.map(row => [row.provider, row]));

  // Derive latest hourly run timestamp if not set in memory yet
  if (!autoSyncStateMemory.lastRunAt && syncRows.length) {
    const latestAttempt = syncRows
      .map(r => Date.parse(r.last_attempt_at || r.last_success_at || ''))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (Number.isFinite(latestAttempt)) {
      autoSyncStateMemory.lastRunAt = new Date(latestAttempt).toISOString();
    }
  }

  const providerTotals = new Map(providers.map((provider, index) => {
    const response = providerCountResponses[index];
    if (!response.ok) throw new Error(`Story count lookup for ${provider.id} failed (HTTP ${response.status})`);
    const range = response.headers.get('Content-Range') || '';
    const total = Number(range.match(/\/(\d+|\*)$/)?.[1]);
    if (!Number.isFinite(total)) {
      throw new Error(`Story count lookup for ${provider.id} returned no exact count`);
    }
    return [provider.id, total];
  }));
  return {
    totalStories: total,
    unclassifiedCount: unclassifiedTotal,
    recentStories: recentRows.map(row => ({
      ...normalizeStory(row),
      id: row.id,
      approved: row.approved,
      removed: row.removed,
      updatedAt: row.decision_at || row.fetched_at || '',
      decisionAction: row.decision_action,
      decisionBy: row.decision_by,
      decisionAt: row.decision_at,
      previousApproved: row.previous_approved,
      previousRemoved: row.previous_removed
    })),
    bannedStories: bannedRows.map(row => ({
      ...normalizeStory(row),
      id: row.id,
      approved: row.approved,
      removed: row.removed,
      updatedAt: row.removed_at || row.decision_at || row.fetched_at || '',
      decisionAction: row.decision_action,
      decisionBy: row.decision_by,
      decisionAt: row.decision_at,
      previousApproved: row.previous_approved,
      previousRemoved: row.previous_removed
    })),
    pendingStories: pendingRows.map(row => ({
      ...normalizeStory(row),
      id: row.id,
      approved: row.approved,
      updatedAt: row.fetched_at || '',
      decisionAction: row.decision_action || ''
    })),
    providers: providers.map(provider => {
      const syncRow = syncByProvider.get(provider.id) || {
        status: 'never',
        started_at: null,
        last_attempt_at: null,
        last_success_at: null,
        stories_saved: 0,
        last_error: null,
        updated_by: null
      };
      const cooldown = getProviderCooldownState(provider.id);
      // Most recent failed/rate-limited call for this provider, for the error breakdown UI
      const lastFailedLog = providerFetchLogsMemory.find((log) =>
        log.provider === provider.id &&
        (log.status === 'rate_limited' || log.status === 'failed' || log.status === 'skipped_cooldown')
      );
      return {
        ...provider,
        total_stories_saved: providerTotals.get(provider.id) || 0,
        ...syncRow,
        ...(cooldown ? {
          cooldown_until: cooldown.cooldownUntil,
          rate_limit_reset_at: cooldown.rateLimitResetAt,
          retry_after_seconds: cooldown.retryAfterSeconds,
          rate_limit_remaining: cooldown.rateLimitRemaining,
          failover_provider: cooldown.failoverProvider,
          failover_categories: cooldown.failoverCategories
        } : {}),
        ...(lastFailedLog ? {
          last_failed_call: {
            requestUrl: lastFailedLog.requestUrl || '',
            category: lastFailedLog.category || 'all',
            httpStatus: lastFailedLog.httpStatus ?? null,
            retryAfterSeconds: lastFailedLog.retryAfterSeconds ?? null,
            rateLimitRemaining: lastFailedLog.rateLimitRemaining ?? null,
            rateLimitReset: lastFailedLog.rateLimitReset || null,
            errorMessage: lastFailedLog.errorMessage || null,
            failoverProvider: lastFailedLog.failoverProvider || null,
            status: lastFailedLog.status,
            createdAt: lastFailedLog.createdAt
          }
        } : {})
      };
    }),
    autoSync: getAutoSyncState(),
    runs: await getRecentSyncRuns(env),
    providerLogs: await getSnapshotProviderLogs(env),
    aiCuration: await ensureAndGetAiCurationSnapshot(env, {
      recentRows,
      bannedRows,
      pendingRows
    })
  };
}

export async function approveNewsStory(env, storyId, approvedBy) {
  const query = new URLSearchParams({
    id: `eq.${storyId}`,
    approved: 'eq.false',
    removed: 'eq.false',
    select: 'id'
  });
  const response = await fetch(supabaseUrl(env, STORIES_TABLE, query), {
    method: 'PATCH',
    headers: supabaseHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      approved: true,
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      decision_action: 'approve',
      decision_by: approvedBy,
      decision_at: new Date().toISOString(),
      previous_approved: false,
      previous_removed: false
    })
  });
  const rows = await readRows(response, 'Story approval update');
  if (rows.length !== 1) return false;
  syncAiStagedPickDecision(Number(storyId), 'approved', approvedBy);
  return true;
}

export async function updateNewsStory(env, storyId, story) {
  const query = new URLSearchParams({
    id: `eq.${storyId}`,
    select: 'id'
  });
  const response = await fetch(supabaseUrl(env, STORIES_TABLE, query), {
    method: 'PATCH',
    headers: supabaseHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      title: story.title,
      category: story.category,
      article_url: story.link,
      image_url: story.image || null,
      description: story.description || null,
      content: story.content || null,
      ai_summary: story.aiSummary || null,
      published_at: story.pubDate || null,
      source_name: story.source || null
    })
  });
  const rows = await readRows(response, 'Story detail update');
  if (rows.length === 1) {
    syncAiStagedPickDetails(Number(storyId), story);
  }
  return rows.length === 1;
}

// Categories a story may be overridden into for frontend display.
// 'all' is excluded — it is the catch-all feed, not a display section.
export const OVERRIDABLE_CATEGORIES = Object.freeze(
  NEWS_CATEGORIES.filter(c => c !== 'all')
);

/**
 * Set the frontend category override for a story.
 * @param {string[]|null} categories - desired display categories; null/empty clears the override.
 * @returns {{ ok: boolean, displayCategories: string[]|null, error?: string }}
 */
export async function setStoryDisplayCategories(env, storyId, categories) {
  const clean = [...new Set(
    (Array.isArray(categories) ? categories : [])
      .map(c => String(c || '').trim().toLowerCase())
      .filter(c => OVERRIDABLE_CATEGORIES.includes(c))
  )];
  // Reject unknown values rather than silently dropping them, so the admin UI
  // can surface typos instead of applying a partial override.
  const requested = (Array.isArray(categories) ? categories : [])
    .map(c => String(c || '').trim().toLowerCase())
    .filter(c => c.length > 0);
  if (requested.some(c => !OVERRIDABLE_CATEGORIES.includes(c))) {
    return { ok: false, displayCategories: null, error: 'Unknown category in override list' };
  }
  const value = clean.length > 0 ? clean : null;
  const query = new URLSearchParams({ id: `eq.${storyId}`, select: 'id' });
  const response = await fetch(supabaseUrl(env, STORIES_TABLE, query), {
    method: 'PATCH',
    headers: supabaseHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({ display_categories: value })
  });
  const rows = await readRows(response, 'Story display-categories update');
  if (rows.length !== 1) return { ok: false, displayCategories: null, error: 'Story was not found' };
  return { ok: true, displayCategories: value };
}

/**
 * Set the interest keywords for a story (admin tagging).
 * @param {string[]|null} keywords - desired keyword ids; null/empty clears them.
 * @returns {{ ok: boolean, interestKeywords: string[]|null, error?: string }}
 */
export async function setStoryInterestKeywords(env, storyId, keywords) {
  const requested = (Array.isArray(keywords) ? keywords : [])
    .map(k => String(k || '').trim().toLowerCase())
    .filter(k => k.length > 0);
  const clean = normalizeInterestKeywords(requested);
  // Reject unknown values rather than silently dropping them, so the admin UI
  // can surface typos instead of applying a partial tag list.
  if (requested.some(k => !INTEREST_KEYWORD_IDS.has(k))) {
    return { ok: false, interestKeywords: null, error: 'Unknown interest keyword' };
  }
  const query = new URLSearchParams({ id: `eq.${storyId}`, select: 'id' });
  // Country/region disabled until story_region migration is confirmed.
  // const { country_code, region } = deriveStoryRegion(clean || []);
  const response = await fetch(supabaseUrl(env, STORIES_TABLE, query), {
    method: 'PATCH',
    headers: supabaseHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({ interest_keywords: clean })
  });
  const rows = await readRows(response, 'Story interest-keywords update');
  if (rows.length !== 1) return { ok: false, interestKeywords: null, error: 'Story was not found' };
  return { ok: true, interestKeywords: clean };
}

export async function createApprovedCustomNewsStory(env, story, approvedBy) {
  const now = new Date().toISOString();
  const query = new URLSearchParams({
    on_conflict: 'provider,category,article_url'
  });
  const response = await fetch(supabaseUrl(env, STORIES_TABLE, query), {
    method: 'POST',
    headers: supabaseHeaders(env, {
      Prefer: 'resolution=merge-duplicates,return=representation'
    }),
    body: JSON.stringify([{
      provider: 'custom',
      category: story.category,
      title: story.title,
      article_url: story.link,
      image_url: story.image || null,
      description: story.description || null,
      content: story.content || null,
      ai_summary: story.aiSummary || null,
      published_at: story.pubDate || null,
      source_name: story.source || null,
      approved: true,
      approved_by: approvedBy,
      approved_at: now,
      removed: false,
      removed_by: null,
      removed_at: null,
      decision_action: 'approve',
      decision_by: approvedBy,
      decision_at: now,
      previous_approved: false,
      previous_removed: false
    }])
  });
  const rows = await readRows(response, 'Custom story publish');
  if (rows.length !== 1 || !Number.isSafeInteger(rows[0].id)) {
    throw new Error('Custom story publish returned an invalid response');
  }
  return rows[0].id;
}

export async function disapproveNewsStory(env, storyId, decidedBy) {
  const lookupQuery = new URLSearchParams({
    id: `eq.${storyId}`,
    removed: 'eq.false',
    select: 'id,approved,removed'
  });
  const lookup = await fetch(supabaseUrl(env, STORIES_TABLE, lookupQuery), {
    headers: supabaseHeaders(env)
  });
  const matchingRows = await readRows(lookup, 'Story disapproval lookup');
  if (matchingRows.length !== 1) return false;
  const previous = matchingRows[0];
  if (previous.removed) return false;
  const query = new URLSearchParams({
    id: `eq.${storyId}`,
    approved: `eq.${previous.approved}`,
    removed: 'eq.false',
    select: 'id'
  });
  const response = await fetch(supabaseUrl(env, STORIES_TABLE, query), {
    method: 'PATCH',
    headers: supabaseHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      approved: false,
      approved_by: null,
      approved_at: null,
      decision_action: 'disapprove',
      decision_by: decidedBy,
      decision_at: new Date().toISOString(),
      previous_approved: previous.approved,
      previous_removed: false
    })
  });
  const rows = await readRows(response, 'Story disapproval update');
  if (rows.length === 1) {
    syncAiStagedPickDecision(Number(storyId), 'disapproved', decidedBy);
  }
  return rows.length === 1;
}

export async function banNewsStory(env, storyId, bannedBy) {
  const query = new URLSearchParams({
    id: `eq.${storyId}`,
    approved: 'eq.false',
    removed: 'eq.false',
    select: 'id'
  });
  const response = await fetch(supabaseUrl(env, STORIES_TABLE, query), {
    method: 'PATCH',
    headers: supabaseHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      removed: true,
      removed_by: bannedBy,
      removed_at: new Date().toISOString(),
      decision_action: 'ban',
      decision_by: bannedBy,
      decision_at: new Date().toISOString(),
      previous_approved: false,
      previous_removed: false
    })
  });
  const rows = await readRows(response, 'Story ban update');
  if (rows.length === 1) {
    syncAiStagedPickDecision(Number(storyId), 'banned', bannedBy);
  }
  return rows.length === 1;
}

export async function undoNewsStoryDecision(env, storyId, undoneBy) {
  const query = new URLSearchParams({
    id: `eq.${storyId}`,
    decision_action: 'in.(approve,disapprove,unapprove,ban)',
    decision_at: 'not.is.null',
    select: 'id,approved,removed,decision_action,decision_at,previous_approved,previous_removed'
  });
  const lookup = await fetch(supabaseUrl(env, STORIES_TABLE, query), {
    headers: supabaseHeaders(env)
  });
  const rows = await readRows(lookup, 'Story decision lookup');
  if (rows.length !== 1 || rows[0].previous_approved == null || rows[0].previous_removed == null) {
    return false;
  }
  const decision = rows[0];
  const updateQuery = new URLSearchParams({
    id: `eq.${storyId}`,
    decision_action: `eq.${decision.decision_action}`,
    decision_at: `eq.${decision.decision_at}`,
    approved: `eq.${decision.approved}`,
    removed: `eq.${decision.removed}`,
    select: 'id'
  });
  const response = await fetch(supabaseUrl(env, updateQuery ? STORIES_TABLE : STORIES_TABLE, updateQuery), {
    method: 'PATCH',
    headers: supabaseHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      approved: decision.previous_approved,
      removed: decision.previous_removed,
      approved_by: decision.previous_approved ? undoneBy : null,
      approved_at: decision.previous_approved ? new Date().toISOString() : null,
      removed_by: decision.previous_removed ? undoneBy : null,
      removed_at: decision.previous_removed ? new Date().toISOString() : null,
      decision_action: 'undo',
      decision_by: undoneBy,
      decision_at: new Date().toISOString(),
      previous_approved: null,
      previous_removed: null
    })
  });
  const updatedRows = await readRows(response, 'Story decision undo');
  if (updatedRows.length === 1) {
    const nextState = decision.previous_removed
      ? 'banned'
      : decision.previous_approved
        ? 'approved'
        : 'staged';
    syncAiStagedPickDecision(Number(storyId), nextState, undoneBy);
  }
  return updatedRows.length === 1;
}

export async function claimNewsProviderSync(env, provider, updatedBy) {
  const response = await fetch(supabaseUrl(env, 'rpc/claim_news_provider_sync'), {
    method: 'POST',
    headers: supabaseHeaders(env),
    body: JSON.stringify({ p_provider: provider, p_updated_by: updatedBy })
  });
  if (!response.ok) throw new Error(`Could not claim provider update (HTTP ${response.status})`);
  const result = await response.json();
  if (typeof result !== 'boolean') throw new Error('Provider update lock returned an invalid response');
  return result;
}

function buildStoryRows(provider, category, stories) {
  const seenUrls = new Set();
  const rows = [];
  let duplicatesSkipped = 0;
  for (const story of stories || []) {
    if (!story?.link || seenUrls.has(story.link)) {
      duplicatesSkipped++;
      continue;
    }
    seenUrls.add(story.link);
    rows.push({
      provider,
      category,
      title: story.title,
      article_url: story.link,
      image_url: story.image || null,
      description: story.description || null,
      content: story.content || null,
      published_at: story.pubDate || null,
      source_name: story.source || null,
      provider_country: story.providerCountry || null,
      fetched_at: new Date().toISOString()
    });
  }
  return { rows, duplicatesSkipped };
}

export async function upsertNewsStories(env, provider, category, stories) {
  if (!stories.length) return { savedCount: 0, duplicatesSkipped: 0 };
  const { rows: uniqueRows, duplicatesSkipped } = buildStoryRows(provider, category, stories);
  if (!uniqueRows.length) return { savedCount: 0, duplicatesSkipped };
  const query = new URLSearchParams({
    on_conflict: 'provider,category,article_url'
  });
  const response = await fetch(supabaseUrl(env, STORIES_TABLE, query), {
    method: 'POST',
    headers: supabaseHeaders(env, {
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify(uniqueRows)
  });
  if (!response.ok) throw new Error(`Saving ${provider}/${category} stories failed (HTTP ${response.status})`);
  return { savedCount: uniqueRows.length, duplicatesSkipped };
}

// Batch variant (Phase 1 batching): one POST for a provider's stories across
// several categories. Rows already carry provider+category, so the upsert
// conflict target is unchanged and semantics match per-category upserts.
// Callers fall back to per-category upsertNewsStories on failure.
export async function upsertNewsStoriesBatch(env, provider, categoryStories) {
  const rows = [];
  let duplicatesSkipped = 0;
  for (const { category, stories } of categoryStories || []) {
    const built = buildStoryRows(provider, category, stories);
    rows.push(...built.rows);
    duplicatesSkipped += built.duplicatesSkipped;
  }
  if (!rows.length) return { savedCount: 0, duplicatesSkipped };
  const query = new URLSearchParams({
    on_conflict: 'provider,category,article_url'
  });
  const response = await fetch(supabaseUrl(env, STORIES_TABLE, query), {
    method: 'POST',
    headers: supabaseHeaders(env, {
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify(rows)
  });
  if (!response.ok) throw new Error(`Saving ${provider} stories failed (HTTP ${response.status})`);
  return { savedCount: rows.length, duplicatesSkipped };
}

export async function finishNewsProviderSync(env, provider, {
  status,
  storiesSaved,
  error = null
}) {
  const query = new URLSearchParams({ provider: `eq.${provider}` });
  const response = await fetch(supabaseUrl(env, SYNC_TABLE, query), {
    method: 'PATCH',
    headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify({
      status,
      started_at: null,
      last_success_at: status === 'succeeded' || status === 'partial' ? new Date().toISOString() : undefined,
      stories_saved: storiesSaved,
      last_error: error,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(`Saving ${provider} update status failed (HTTP ${response.status})`);
}

// Status-only update for paths that must NOT disturb a live sweep's claim.
// Unlike finishNewsProviderSync, this never writes started_at: the retry
// drain calls it after a successful save, and a provider claimed by a
// running sweep keeps its started_at (and therefore its claim) untouched.
// Fail-open: returns false instead of throwing, so a status write can
// never fail a drain job that already saved its stories.
export async function updateProviderSyncStatus(env, provider, {
  status,
  storiesSaved,
  error = null
} = {}) {
  try {
    const query = new URLSearchParams({ provider: `eq.${provider}` });
    const response = await fetch(supabaseUrl(env, SYNC_TABLE, query), {
      method: 'PATCH',
      headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        status,
        last_success_at: status === 'succeeded' ? new Date().toISOString() : undefined,
        stories_saved: storiesSaved,
        last_error: error,
        updated_at: new Date().toISOString()
      })
    });
    if (!response.ok) {
      console.warn(`Saving ${provider} status update failed (HTTP ${response.status})`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`Saving ${provider} status update failed:`, err.message);
    return false;
  }
}

export async function resetNewsProviderSync(env, provider, resetBy) {
  // Clear a stuck "running" lock (e.g. the worker was killed or redeployed
  // mid-sync and finishNewsProviderSync never ran) so the provider can be
  // updated again. Harmless when the provider is not actually stuck.
  const lookupQuery = new URLSearchParams({
    provider: `eq.${provider}`,
    select: 'provider,status,started_at'
  });
  const lookupResponse = await fetch(supabaseUrl(env, SYNC_TABLE, lookupQuery), {
    headers: supabaseHeaders(env)
  });
  const rows = await readRows(lookupResponse, `Provider ${provider} sync state lookup`);
  const wasStuck = rows.length === 1 && rows[0].status === 'running';
  if (wasStuck) {
    const resetQuery = new URLSearchParams({ provider: `eq.${provider}` });
    const response = await fetch(supabaseUrl(env, SYNC_TABLE, resetQuery), {
      method: 'PATCH',
      headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        status: 'failed',
        started_at: null,
        last_error: `Sync lock manually reset by ${resetBy} — the previous run did not finish`,
        updated_by: resetBy,
        updated_at: new Date().toISOString()
      })
    });
    if (!response.ok) throw new Error(`Resetting ${provider} sync state failed (HTTP ${response.status})`);
  }
  return { provider, reset: wasStuck, previousStatus: rows[0]?.status ?? 'never' };
}

export async function unstickAllProviderSyncs(env, resetBy) {
  // Clear every stuck "running" provider lock AND every open run row in
  // one call, so the panel stops showing a ghost live run after a wedge.
  // Harmless when nothing is stuck. Does not stop a live crawl: a chain
  // that is still running rewrites its rows when it finishes.
  const providersReset = [];
  const runsClosed = [];
  const syncQuery = new URLSearchParams({ status: 'eq.running', select: 'provider,status,started_at' });
  const syncResponse = await fetch(supabaseUrl(env, SYNC_TABLE, syncQuery), { headers: supabaseHeaders(env) });
  const syncRows = await readRows(syncResponse, 'Running provider sync state lookup');
  for (const row of syncRows) {
    const result = await resetNewsProviderSync(env, row.provider, resetBy);
    if (result.reset) providersReset.push(row.provider);
  }
  const runsQuery = new URLSearchParams({ status: 'eq.running', select: 'id,summary' });
  const runsResponse = await fetch(supabaseUrl(env, SYNC_RUNS_TABLE, runsQuery), { headers: supabaseHeaders(env) });
  const runRows = await readRows(runsResponse, 'Open sync run lookup');
  for (const row of runRows) {
    const patchQuery = new URLSearchParams({ id: `eq.${row.id}` });
    const response = await fetch(supabaseUrl(env, SYNC_RUNS_TABLE, patchQuery), {
      method: 'PATCH',
      headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        status: 'failed',
        finished_at: new Date().toISOString(),
        current_provider: null,
        current_category: null,
        last_activity_at: new Date().toISOString(),
        summary: { ...(row.summary || {}), unstuck: true, unstuckBy: resetBy }
      })
    });
    if (!response.ok) throw new Error(`Closing sync run ${row.id} failed (HTTP ${response.status})`);
    runsClosed.push(row.id);
  }
  return { ok: true, providersReset, runsClosed };
}

export function buildKeywordOrFilter(queryText) {
  const raw = String(queryText || '')
    .trim()
    .replace(/[-_+]+/g, ' ')
    .replace(/[,()*%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';

  const baseTerms = [raw, ...raw.split(/\s+/).filter(t => t.length >= 2)];
  const expanded = [];
  for (const term of baseTerms) {
    const lower = term.toLowerCase();
    expanded.push(lower);
    if (lower.endsWith('ies') && lower.length > 4) {
      expanded.push(`${lower.slice(0, -3)}y`);
    } else if (lower.endsWith('y') && lower.length > 3 && !/[aeiou]y$/.test(lower)) {
      expanded.push(`${lower.slice(0, -1)}ies`);
    }
    if (lower.endsWith('es') && lower.length > 4) {
      expanded.push(lower.slice(0, -2));
      expanded.push(lower.slice(0, -1));
    } else if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 3) {
      expanded.push(lower.slice(0, -1));
    } else if (lower.length >= 3 && !lower.endsWith('s')) {
      expanded.push(`${lower}s`);
    }
  }

  const uniqueTerms = Array.from(new Set(expanded.filter(Boolean))).slice(0, 6);
  const clauses = [];
  for (const term of uniqueTerms) {
    clauses.push(
      `title.ilike.*${term}*`,
      `description.ilike.*${term}*`,
      `content.ilike.*${term}*`,
      `ai_summary.ilike.*${term}*`,
      `source_name.ilike.*${term}*`,
      `category.ilike.*${term}*`
    );
  }
  return `(${clauses.join(',')})`;
}

export async function getStoredKeywordNewsFeed(env, keyword) {
  const orFilter = buildKeywordOrFilter(keyword);
  if (!orFilter) {
    return { provider: 'supabase', topic: keyword, items: [] };
  }

  const makeQuery = approved => new URLSearchParams({
    select: 'provider,category,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,fetched_at',
    approved: `eq.${approved}`,
    removed: 'eq.false',
    or: orFilter,
    order: 'published_at.desc.nullslast,fetched_at.desc',
    limit: '50'
  });

  const [approvedResponse, unapprovedResponse] = await Promise.all([
    fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(true)), {
      headers: supabaseHeaders(env)
    }),
    fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(false)), {
      headers: supabaseHeaders(env)
    })
  ]);
  const [approvedRows, unapprovedRows] = await Promise.all([
    readRows(approvedResponse, 'Approved keyword news feed lookup'),
    readRows(unapprovedResponse, 'Unapproved keyword news feed lookup')
  ]);
  const seenUrls = new Set();
  const items = [];
  for (const row of [...approvedRows, ...unapprovedRows]) {
    if (seenUrls.has(row.article_url)) continue;
    seenUrls.add(row.article_url);
    items.push({ ...normalizeStory(row), approved: row.approved });
  }
  return { provider: 'supabase', topic: keyword, items };
}

export async function searchNewsStories(env, queryText, limit = 100) {
  const orFilter = buildKeywordOrFilter(queryText);
  if (!orFilter) return [];

  const params = new URLSearchParams({
    select: 'id,provider,category,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,removed,fetched_at,approved_at,removed_at,decision_action,decision_by,decision_at,previous_approved,previous_removed,interest_keywords',
    or: orFilter,
    order: 'published_at.desc.nullslast,fetched_at.desc',
    limit: String(limit)
  });
  try {
    const response = await fetch(supabaseUrl(env, STORIES_TABLE, params), {
      headers: supabaseHeaders(env)
    });
    if (!response.ok) return [];
    const rows = await response.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(row => ({
      ...normalizeStory(row),
      id: row.id,
      approved: row.approved,
      removed: row.removed,
      updatedAt: row.decision_at || row.approved_at || row.removed_at || row.fetched_at || row.published_at || '',
      decisionAction: row.decision_action || (row.removed ? 'ban' : row.approved ? 'approve' : ''),
      decisionBy: row.decision_by || '',
      previousApproved: row.previous_approved,
      previousRemoved: row.previous_removed
    }));
  } catch (err) {
    console.error('searchNewsStories failed:', err);
    return [];
  }
}

/* ============================================================================
 * AI DAILY STORY CURATION & STAGING QUEUE (3x/Day: Morning, Afternoon, Evening)
 * ============================================================================ */

export const AI_CURATION_SLOTS = Object.freeze(['morning', 'afternoon', 'evening']);
export const AI_PICKS_PER_CATEGORY = 5;
const AI_CURATION_MODEL = '@cf/meta/llama-3.2-3b-instruct';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'are', 'was',
  'were', 'will', 'would', 'could', 'should', 'about', 'into', 'over', 'after',
  'before', 'under', 'between', 'through', 'during', 'what', 'when', 'where',
  'which', 'while', 'their', 'there', 'these', 'those', 'they', 'them', 'then',
  'than', 'some', 'such', 'more', 'most', 'other', 'only', 'also', 'just',
  'like', 'make', 'made', 'many', 'much', 'very', 'your', 'our', 'new', 'news',
  'says', 'said', 'report', 'reports', 'year', 'years', 'first', 'time', 'today',
  'week', 'month', 'world', 'how', 'why', 'who', 'its', 'his', 'her', 'has', 'had'
]);

const aiTasteProfileMemory = {
  customInstructions: 'Prioritize joyful, insightful, family-friendly, and high-signal stories across childcare, wildlife conservation, creative arts, breakthrough AI and technology, constructive global currents, and uplifting human-interest news. Avoid clickbait, partisan outrage, repetitive stock tickers, celebrity gossip, or grim crime blotters.',
  preferredKeywords: 'breakthrough, discovery, family, conservation, kindness, innovation, creativity, community, science, wildlife, education, rescue, art',
  mutedKeywords: 'gossip, scandal, lottery, crash, partisan, clickbait, rumor, tragedy, lawsuit',
  updatedAt: null,
  updatedBy: 'system'
};

const aiCurationStateMemory = {
  enabled: true,
  picksPerCategory: AI_PICKS_PER_CATEGORY,
  lastRunAt: null,
  lastSlot: null,
  lastBatchId: null,
  lastTrigger: null,
  lastStatus: 'never',
  lastSummary: null,
  completedSlotsByDate: {},
  updatedAt: null,
  updatedBy: 'system'
};

// Map of storyId -> staged pick entry
const aiStagedPicksMemory = new Map();
const dismissedOrDecidedStoryIds = new Set();
let learnedSignalsCache = {
  approvedCount: 0,
  rejectedCount: 0,
  topApprovedSources: [],
  topApprovedCategories: [],
  topApprovedTerms: [],
  avoidedSources: [],
  avoidedTerms: [],
  recentApprovedSample: [],
  recentRejectedSample: []
};

export function getDateKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCurrentCurationSlot(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

export function getSlotLabel(slot) {
  if (slot === 'morning') return 'Morning Edition (08:00)';
  if (slot === 'afternoon') return 'Afternoon Edition (13:00)';
  if (slot === 'evening') return 'Evening Edition (18:00)';
  return 'Latest Edition';
}

export function getNextCurationWindow(now = new Date()) {
  const scheduleHours = [
    { slot: 'morning', hour: 8 },
    { slot: 'afternoon', hour: 13 },
    { slot: 'evening', hour: 18 }
  ];
  for (const item of scheduleHours) {
    const candidate = new Date(now);
    candidate.setHours(item.hour, 0, 0, 0);
    if (candidate.getTime() > now.getTime()) {
      return { slot: item.slot, nextRunAt: candidate.toISOString() };
    }
  }
  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(8, 0, 0, 0);
  return { slot: 'morning', nextRunAt: tomorrowMorning.toISOString() };
}

function parseCommaList(str) {
  return String(str || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length >= 2);
}

function extractMeaningfulTerms(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^-+|-+$/g, ''))
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

export function computeLearnedTasteSignals(recentRows = [], bannedRows = []) {
  const approvedRows = [];
  const rejectedRows = [];

  for (const row of recentRows) {
    const isApproved = row.approved === true || row.decision_action === 'approve' || row.decisionAction === 'approve';
    const isRejected = row.removed === true ||
      row.decision_action === 'disapprove' || row.decisionAction === 'disapprove' ||
      row.decision_action === 'ban' || row.decisionAction === 'ban';
    if (isApproved && !row.removed) {
      approvedRows.push(row);
    } else if (isRejected) {
      rejectedRows.push(row);
    }
    if (row.id != null && (isApproved || isRejected)) {
      dismissedOrDecidedStoryIds.add(Number(row.id));
    }
  }

  for (const row of bannedRows) {
    if (row.id != null) dismissedOrDecidedStoryIds.add(Number(row.id));
    if (!rejectedRows.some(r => r.id === row.id)) {
      rejectedRows.push(row);
    }
  }

  const approvedSourceCounts = new Map();
  const approvedCatCounts = new Map();
  const approvedTermCounts = new Map();
  const rejectedSourceCounts = new Map();
  const rejectedTermCounts = new Map();

  for (const row of approvedRows) {
    const src = String(row.source_name || row.source || '').trim();
    if (src) approvedSourceCounts.set(src, (approvedSourceCounts.get(src) || 0) + 1);
    const cat = String(row.category || 'all').trim();
    approvedCatCounts.set(cat, (approvedCatCounts.get(cat) || 0) + 1);
    for (const term of extractMeaningfulTerms(`${row.title || ''} ${row.description || ''}`)) {
      approvedTermCounts.set(term, (approvedTermCounts.get(term) || 0) + 1);
    }
  }

  for (const row of rejectedRows) {
    const src = String(row.source_name || row.source || '').trim();
    if (src) rejectedSourceCounts.set(src, (rejectedSourceCounts.get(src) || 0) + 1);
    for (const term of extractMeaningfulTerms(row.title || '')) {
      if ((approvedTermCounts.get(term) || 0) === 0) {
        rejectedTermCounts.set(term, (rejectedTermCounts.get(term) || 0) + 1);
      }
    }
  }

  const topEntries = (map, limit = 8) => Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));

  learnedSignalsCache = {
    approvedCount: approvedRows.length,
    rejectedCount: rejectedRows.length,
    topApprovedSources: topEntries(approvedSourceCounts, 6),
    topApprovedCategories: topEntries(approvedCatCounts, 7),
    topApprovedTerms: topEntries(approvedTermCounts, 10),
    avoidedSources: topEntries(rejectedSourceCounts, 5),
    avoidedTerms: topEntries(rejectedTermCounts, 8),
    recentApprovedSample: approvedRows.slice(0, 12).map(r => ({
      id: r.id,
      title: r.title,
      category: r.category || 'all',
      source: r.source_name || r.source || ''
    })),
    recentRejectedSample: rejectedRows.slice(0, 10).map(r => ({
      id: r.id,
      title: r.title,
      category: r.category || 'all',
      source: r.source_name || r.source || ''
    }))
  };

  return learnedSignalsCache;
}

export function syncAiStagedPickDecision(storyId, nextStatus, decidedBy = 'admin') {
  const numId = Number(storyId);
  if (!Number.isFinite(numId)) return;
  if (nextStatus === 'approved' || nextStatus === 'disapproved' || nextStatus === 'banned') {
    dismissedOrDecidedStoryIds.add(numId);
  } else if (nextStatus === 'staged') {
    dismissedOrDecidedStoryIds.delete(numId);
  }
  const existing = aiStagedPicksMemory.get(numId);
  if (!existing) return;
  existing.status = nextStatus;
  existing.approved = nextStatus === 'approved';
  existing.removed = nextStatus === 'banned';
  existing.decisionAction = nextStatus === 'approved'
    ? 'approve'
    : nextStatus === 'disapproved'
      ? 'disapprove'
      : nextStatus === 'banned'
        ? 'ban'
        : 'undo';
  existing.decisionBy = decidedBy;
  existing.decisionAt = new Date().toISOString();
  existing.updatedAt = existing.decisionAt;
}

export function syncAiStagedPickDetails(storyId, updatedFields = {}) {
  const numId = Number(storyId);
  const existing = aiStagedPicksMemory.get(numId);
  if (!existing) return;
  if (updatedFields.title !== undefined) existing.title = updatedFields.title;
  if (updatedFields.category !== undefined) existing.category = updatedFields.category;
  if (updatedFields.link !== undefined) existing.link = updatedFields.link;
  if (updatedFields.image !== undefined) existing.image = updatedFields.image;
  if (updatedFields.description !== undefined) existing.description = updatedFields.description;
  if (updatedFields.content !== undefined) existing.content = updatedFields.content;
  if (updatedFields.aiSummary !== undefined) existing.aiSummary = updatedFields.aiSummary;
  if (updatedFields.pubDate !== undefined) existing.pubDate = updatedFields.pubDate;
  if (updatedFields.source !== undefined) existing.source = updatedFields.source;
  existing.updatedAt = new Date().toISOString();
}

export function getAiCurationState() {
  const now = new Date();
  const dateKey = getDateKey(now);
  const currentSlot = getCurrentCurationSlot(now);
  const completedSlotsToday = aiCurationStateMemory.completedSlotsByDate[dateKey] || [];
  const isSlotDue = aiCurationStateMemory.enabled && !completedSlotsToday.includes(currentSlot);
  const nextWindow = getNextCurationWindow(now);

  const allPicks = Array.from(aiStagedPicksMemory.values())
    .sort((a, b) => {
      if (a.curatedAt !== b.curatedAt) return (b.curatedAt || '').localeCompare(a.curatedAt || '');
      if (a.category !== b.category) return (a.category || '').localeCompare(b.category || '');
      return (a.rank || 99) - (b.rank || 99);
    });

  const activeStagedPicks = allPicks.filter(pick => pick.status === 'staged' && !pick.approved && !pick.removed);

  const categoryCounts = {};
  for (const cat of NEWS_CATEGORIES) {
    categoryCounts[cat] = activeStagedPicks.filter(p => p.category === cat).length;
  }

  return {
    enabled: aiCurationStateMemory.enabled,
    picksPerCategory: AI_PICKS_PER_CATEGORY,
    currentSlot,
    currentSlotLabel: getSlotLabel(currentSlot),
    isSlotDue,
    lastRunAt: aiCurationStateMemory.lastRunAt,
    lastSlot: aiCurationStateMemory.lastSlot,
    lastBatchId: aiCurationStateMemory.lastBatchId,
    lastTrigger: aiCurationStateMemory.lastTrigger,
    lastStatus: aiCurationStateMemory.lastStatus,
    lastSummary: aiCurationStateMemory.lastSummary,
    nextSlot: nextWindow.slot,
    nextRunAt: aiCurationStateMemory.enabled ? nextWindow.nextRunAt : null,
    completedSlotsToday,
    tasteProfile: { ...aiTasteProfileMemory },
    learnedSignals: learnedSignalsCache,
    stagedPicks: activeStagedPicks,
    recentCuratedPicks: allPicks.slice(0, 105),
    categoryCounts
  };
}

export function updateAiCurationConfig(updates = {}, updatedBy = 'admin') {
  if (typeof updates.enabled === 'boolean') {
    aiCurationStateMemory.enabled = updates.enabled;
  }
  if (typeof updates.customInstructions === 'string') {
    aiTasteProfileMemory.customInstructions = updates.customInstructions.trim().slice(0, 2000);
  }
  if (typeof updates.preferredKeywords === 'string') {
    aiTasteProfileMemory.preferredKeywords = updates.preferredKeywords.trim().slice(0, 1000);
  }
  if (typeof updates.mutedKeywords === 'string') {
    aiTasteProfileMemory.mutedKeywords = updates.mutedKeywords.trim().slice(0, 1000);
  }
  const nowIso = new Date().toISOString();
  aiTasteProfileMemory.updatedAt = nowIso;
  aiTasteProfileMemory.updatedBy = updatedBy;
  aiCurationStateMemory.updatedAt = nowIso;
  aiCurationStateMemory.updatedBy = updatedBy;
  return getAiCurationState();
}

function scoreCandidateStory(story, signals, tasteProfile, engagementSignals = {}) {
  let score = 62;
  const reasons = [];
  const textBlob = `${story.title || ''} ${story.description || ''} ${story.content || ''}`.toLowerCase();
  const titleLower = String(story.title || '').toLowerCase();
  const sourceName = String(story.source || story.source_name || '').trim();

  // 1. Check editable taste profile preferred & muted keywords
  const preferredList = parseCommaList(tasteProfile.preferredKeywords);
  const mutedList = parseCommaList(tasteProfile.mutedKeywords);
  const matchedPreferred = preferredList.filter(kw => textBlob.includes(kw));
  const matchedMuted = mutedList.filter(kw => textBlob.includes(kw));

  if (matchedPreferred.length > 0) {
    score += Math.min(18, matchedPreferred.length * 6);
    reasons.push(`matches taste themes (${matchedPreferred.slice(0, 2).map(k => `'${k}'`).join(', ')})`);
  }
  if (matchedMuted.length > 0) {
    score -= Math.min(35, matchedMuted.length * 15);
  }

  // 2. Check learned historical source affinity
  const approvedSourceHit = signals.topApprovedSources.find(
    s => s.name.toLowerCase() === sourceName.toLowerCase()
  );
  const avoidedSourceHit = signals.avoidedSources.find(
    s => s.name.toLowerCase() === sourceName.toLowerCase()
  );
  if (approvedSourceHit) {
    score += Math.min(14, 5 + approvedSourceHit.count * 2);
    reasons.push(`trusted source (${sourceName}) from past approvals`);
  }
  if (avoidedSourceHit && !approvedSourceHit) {
    score -= Math.min(16, 4 + avoidedSourceHit.count * 3);
  }

  // 3. Check learned historical terms from previously approved stories
  const matchedLearnedTerms = signals.topApprovedTerms
    .filter(t => titleLower.includes(t.name))
    .map(t => t.name);
  if (matchedLearnedTerms.length > 0) {
    score += Math.min(12, matchedLearnedTerms.length * 5);
    reasons.push(`aligns with approved topics (${matchedLearnedTerms.slice(0, 2).join(', ')})`);
  }

  const matchedAvoidedTerms = signals.avoidedTerms
    .filter(t => titleLower.includes(t.name))
    .map(t => t.name);
  if (matchedAvoidedTerms.length > 0) {
    score -= Math.min(18, matchedAvoidedTerms.length * 6);
  }

  // 4. Content quality & completeness signals
  const descLen = String(story.description || '').trim().length;
  if (story.image || story.image_url) {
    score += 5;
  }
  if (descLen >= 90) {
    score += 6;
    if (reasons.length < 2) reasons.push('strong article context & summary depth');
  } else if (descLen < 25) {
    score -= 6;
  }

  // 5. Recency boost
  const pubMs = Date.parse(story.pubDate || story.published_at || story.fetchedAt || story.fetched_at || '');
  if (Number.isFinite(pubMs)) {
    const ageHours = Math.max(0, (Date.now() - pubMs) / (1000 * 3600));
    if (ageHours <= 12) {
      score += 6;
      if (reasons.length < 2) reasons.push('freshly published');
    } else if (ageHours <= 36) {
      score += 3;
    }
  }

  // 6. Reader engagement signals (from story_engagement table)
  // Stories from sources/topics with high CTR get boosted
  const storyHash = hashUrl(story.link || story.article_url || '');
  const engagement = engagementSignals[storyHash];
  if (engagement && engagement.views >= 10) {
    // CTR-based boost: high CTR = readers love this
    if (engagement.ctr >= 0.05) {
      score += 8;
      if (reasons.length < 2) reasons.push(`high reader engagement (${Math.round(engagement.ctr * 100)}% click rate)`);
    } else if (engagement.ctr >= 0.02) {
      score += 4;
    }
    // High absolute clicks also signal quality
    if (engagement.clicks >= 50) {
      score += 4;
    }
  }

  const clampedScore = Math.max(15, Math.min(99, Math.round(score)));
  const categoryLabelMap = {
    all: 'All',
    childcare: 'Childcare & Family',
    animals: 'Animals & Nature',
    arts: 'Creative Arts',
    tech: 'Future Tech & AI',
    world: 'Global Currents',
    uplifting: 'Uplifting News'
  };
  const catLabel = categoryLabelMap[story.category] || story.category || 'All';
  const defaultReason = `High-signal ${catLabel} pick from ${sourceName || story.provider || 'curated feed'} fitting your editorial profile.`;
  const reasonText = reasons.length > 0
    ? `AI Pick (${clampedScore}% match): ${reasons.slice(0, 2).join(' · ')}.`
    : `AI Pick (${clampedScore}% match): ${defaultReason}`;

  return {
    score: clampedScore,
    reason: reasonText.charAt(0).toUpperCase() + reasonText.slice(1)
  };
}

// Extract usable text from a Workers AI model response. Mirrors the AI tags
// extractor in index.js: Workers AI returns an OpenAI-compatible object for
// llama-3.2-3b-instruct, with the text in choices[0].message.content,
// while `response` is itself an object. Older shapes still handled, so a
// plain string or { response: string } keeps working.
export function extractAiText(res, depth = 0) {
  if (typeof res === 'string') return res;
  if (!res || typeof res !== 'object') return '';
  if (typeof res.response === 'string') return res.response;
  if (Array.isArray(res.response)) {
    return res.response.filter((p) => typeof p === 'string').join('');
  }
  const choice = Array.isArray(res.choices) ? res.choices[0] : null;
  if (choice) {
    if (choice.message && typeof choice.message.content === 'string') return choice.message.content;
    if (typeof choice.text === 'string') return choice.text;
  }
  if (typeof res.result === 'string') return res.result;
  if (typeof res.text === 'string') return res.text;
  if (res.response && typeof res.response === 'object' && depth < 2) {
    return extractAiText(res.response, depth + 1);
  }
  return '';
}

async function selectCategoryPicksWithAi(env, category, candidates, signals, tasteProfile, engagementSignals = {}, usage = null) {
  // First pre-score all candidates deterministically
  const scoredCandidates = candidates.map(story => {
    const { score, reason } = scoreCandidateStory(story, signals, tasteProfile, engagementSignals);
    return {
      story,
      heuristicScore: score,
      heuristicReason: reason
    };
  }).sort((a, b) => b.heuristicScore - a.heuristicScore);

  const topPool = scoredCandidates.slice(0, 15);
  if (topPool.length === 0) return [];

  // Attempt Workers AI LLM ranking if env.AI is bound
  if (env?.AI && topPool.length > 1) {
    try {
      const approvedExamples = signals.recentApprovedSample
        .slice(0, 6)
        .map(s => `- [${s.category}] "${s.title}" (${s.source})`)
        .join('\n') || 'None recorded yet';
      const rejectedExamples = signals.recentRejectedSample
        .slice(0, 5)
        .map(s => `- [${s.category}] "${s.title}"`)
        .join('\n') || 'None recorded yet';
      const candidateLines = topPool.map((item, idx) => (
        `${idx + 1}. ID=${item.story.id} | Title: "${item.story.title}" | Source: ${item.story.source || item.story.provider} | Summary: ${(item.story.description || '').slice(0, 140)}`
      )).join('\n');

      const response = await env.AI.run(AI_CURATION_MODEL, {
        messages: [
          {
            role: 'system',
            content: 'You are the editorial AI curator for Littlables. Pick up to 5 news stories from the candidate list that the editor will most enjoy and approve based on their Taste Profile and Past Approval History. Respond ONLY with a valid JSON array of objects: [{"id": <number>, "score": <75-99>, "reason": "<concise 1-sentence reason why editor will enjoy this story>"}].'
          },
          {
            role: 'user',
            content: `Category: ${category}\nEditor Taste Profile: ${tasteProfile.customInstructions}\nPreferred Keywords: ${tasteProfile.preferredKeywords}\nMuted Keywords: ${tasteProfile.mutedKeywords}\n\nRecently Approved Stories:\n${approvedExamples}\n\nRecently Rejected Stories:\n${rejectedExamples}\n\nCandidate Stories:\n${candidateLines}\n\nSelect up to ${AI_PICKS_PER_CATEGORY} best stories as a JSON array.`
          }
        ],
        max_tokens: 450,
        temperature: 0.25
      });
      if (usage) usage.add(AI_USAGE_MODEL_LLAMA, 'curation', 1);

      const rawText = extractAiText(response).trim();
      if (!rawText) {
        console.warn(`AI curation extraction yielded no text for category ${category}: responseType=${typeof response}`);
      }
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          const picked = [];
          const usedIds = new Set();
          for (const entry of parsed) {
            const candidateId = Number(entry?.id);
            const found = topPool.find(c => Number(c.story.id) === candidateId);
            if (found && !usedIds.has(candidateId)) {
              usedIds.add(candidateId);
              picked.push({
                story: found.story,
                score: Number.isFinite(Number(entry.score))
                  ? Math.max(60, Math.min(99, Math.round(Number(entry.score))))
                  : found.heuristicScore,
                reason: typeof entry.reason === 'string' && entry.reason.trim().length > 8
                  ? entry.reason.trim().slice(0, 220)
                  : found.heuristicReason
              });
            }
            if (picked.length >= AI_PICKS_PER_CATEGORY) break;
          }
          // Fill remaining slots up to AI_PICKS_PER_CATEGORY using heuristic top scorers
          for (const fallbackItem of topPool) {
            if (picked.length >= AI_PICKS_PER_CATEGORY) break;
            const cid = Number(fallbackItem.story.id);
            if (!usedIds.has(cid)) {
              usedIds.add(cid);
              picked.push({
                story: fallbackItem.story,
                score: fallbackItem.heuristicScore,
                reason: fallbackItem.heuristicReason
              });
            }
          }
          return picked;
        }
      }
    } catch (err) {
      if (usage) usage.add(AI_USAGE_MODEL_LLAMA, 'curation', 0, 1);
      console.warn(`AI LLM curation fallback used for category ${category}:`, err);
    }
  }

  return topPool.slice(0, AI_PICKS_PER_CATEGORY).map(item => ({
    story: item.story,
    score: item.heuristicScore,
    reason: item.heuristicReason
  }));
}

async function fetchUnapprovedCandidatesByCategory(env) {
  const byCategory = new Map(NEWS_CATEGORIES.map(cat => [cat, []]));
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY) {
    return byCategory;
  }

  const requests = NEWS_CATEGORIES.map(category => {
    const query = new URLSearchParams({
      select: 'id,provider,category,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,removed,fetched_at,decision_action',
      approved: 'eq.false',
      removed: 'eq.false',
      category: `eq.${category}`,
      or: '(decision_action.is.null,decision_action.eq.undo)',
      order: 'published_at.desc.nullslast,fetched_at.desc',
      limit: '30'
    });
    return fetch(supabaseUrl(env, STORIES_TABLE, query), {
      headers: supabaseHeaders(env)
    }).then(res => res.ok ? res.json() : []).catch(() => []);
  });

  const results = await Promise.all(requests);
  NEWS_CATEGORIES.forEach((category, idx) => {
    const rows = Array.isArray(results[idx]) ? results[idx] : [];
    const normalized = rows
      .filter(row => row && row.id != null && !dismissedOrDecidedStoryIds.has(Number(row.id)))
      .map(row => ({
        ...normalizeStory(row),
        id: Number(row.id),
        approved: Boolean(row.approved),
        removed: Boolean(row.removed),
        updatedAt: row.fetched_at || row.published_at || ''
      }));
    byCategory.set(category, normalized);
  });

  return byCategory;
}

export async function runAiStoryCuration(env, {
  slot = null,
  triggerSource = 'manual',
  updatedBy = 'ai-curator',
  force = false,
  preloadedRecentRows = null,
  preloadedBannedRows = null,
  preloadedPendingRows = null
} = {}) {
  const now = new Date();
  const dateKey = getDateKey(now);
  const targetSlot = AI_CURATION_SLOTS.includes(slot) ? slot : getCurrentCurationSlot(now);
  const completedToday = aiCurationStateMemory.completedSlotsByDate[dateKey] || [];

  if (!force && !aiCurationStateMemory.enabled) {
    return {
      skipped: true,
      reason: 'AI daily story curation is currently paused',
      aiCuration: getAiCurationState()
    };
  }

  if (!force && triggerSource !== 'manual' && completedToday.includes(targetSlot)) {
    return {
      skipped: true,
      reason: `${getSlotLabel(targetSlot)} has already been curated today (${dateKey})`,
      aiCuration: getAiCurationState()
    };
  }

  // AI usage counting: one batched flush at the end of the run covers every
  // per-category LLM call (see ai-usage-log.mjs).
  const usage = createAiUsageCounter();

  // Refresh learned signals if rows are available or fetch them from Supabase
  let recentRows = preloadedRecentRows;
  let bannedRows = preloadedBannedRows;
  if ((!recentRows || !bannedRows) && env?.SUPABASE_URL && env?.SUPABASE_SECRET_KEY) {
    try {
      const [recRes, banRes] = await Promise.all([
        fetch(supabaseUrl(env, STORIES_TABLE, new URLSearchParams({
          select: 'id,provider,category,title,description,source_name,approved,removed,decision_action,decision_at',
          decision_at: 'not.is.null',
          order: 'decision_at.desc',
          limit: '60'
        })), { headers: supabaseHeaders(env) }),
        fetch(supabaseUrl(env, STORIES_TABLE, new URLSearchParams({
          select: 'id,provider,category,title,description,source_name,approved,removed,decision_action,removed_at',
          removed: 'eq.true',
          order: 'removed_at.desc.nullslast',
          limit: '40'
        })), { headers: supabaseHeaders(env) })
      ]);
      if (recRes.ok) recentRows = await recRes.json();
      if (banRes.ok) bannedRows = await banRes.json();
    } catch (err) {
      console.warn('Could not refresh history for AI curation:', err);
    }
  }
  if (Array.isArray(recentRows) || Array.isArray(bannedRows)) {
    computeLearnedTasteSignals(recentRows || [], bannedRows || []);
  }

  // Fetch per-category unapproved candidates
  let candidatesByCategory = await fetchUnapprovedCandidatesByCategory(env);

  // Also merge any preloadedPendingRows so categories always have maximum coverage
  if (Array.isArray(preloadedPendingRows) && preloadedPendingRows.length > 0) {
    for (const row of preloadedPendingRows) {
      if (!row || row.id == null || dismissedOrDecidedStoryIds.has(Number(row.id))) continue;
      const cat = NEWS_CATEGORIES.includes(row.category) ? row.category : 'all';
      const list = candidatesByCategory.get(cat) || [];
      if (!list.some(item => Number(item.id) === Number(row.id))) {
        list.push({
          ...normalizeStory(row),
          id: Number(row.id),
          approved: Boolean(row.approved),
          removed: Boolean(row.removed),
          updatedAt: row.fetched_at || row.updatedAt || ''
        });
        candidatesByCategory.set(cat, list);
      }
    }
  }

  // Replace previous 'staged' picks for this same slot or refresh staging queue cleanly
  for (const [existingId, pick] of aiStagedPicksMemory.entries()) {
    if (pick.status === 'staged' && (force || pick.slot === targetSlot)) {
      aiStagedPicksMemory.delete(existingId);
    }
  }

  const batchId = `${dateKey}-${targetSlot}`;
  const curatedAt = now.toISOString();
  const usedStoryIdsInRun = new Set();
  const stagedByCategory = {};
  let totalStagedInRun = 0;

  // Fetch reader engagement signals for CTR-based scoring
  const engagementSignals = await getEngagementSignals(env);

  for (const category of NEWS_CATEGORIES) {
    const rawCandidates = (candidatesByCategory.get(category) || []).filter(
      c => !usedStoryIdsInRun.has(Number(c.id)) && !dismissedOrDecidedStoryIds.has(Number(c.id))
    );

    // Filter out near-duplicates within this batch
    const seenInBatch = [];
    const dedupedCandidates = rawCandidates.filter(candidate => {
      const dups = findNearDuplicates([candidate], seenInBatch, 0.7);
      if (dups.length > 0) return false;
      seenInBatch.push(candidate);
      return true;
    });

    const pickedForCategory = await selectCategoryPicksWithAi(
      env,
      category,
      dedupedCandidates,
      learnedSignalsCache,
      aiTasteProfileMemory,
      engagementSignals,
      usage
    );

    stagedByCategory[category] = pickedForCategory.length;
    pickedForCategory.forEach((item, index) => {
      const storyId = Number(item.story.id);
      usedStoryIdsInRun.add(storyId);
      totalStagedInRun++;
      aiStagedPicksMemory.set(storyId, {
        ...item.story,
        id: storyId,
        storyId,
        category,
        slot: targetSlot,
        slotLabel: getSlotLabel(targetSlot),
        dateKey,
        batchId,
        rank: index + 1,
        score: item.score,
        reason: item.reason,
        curatedAt,
        curatedBy: updatedBy,
        triggerSource,
        status: 'staged'
      });
    });
  }

  const updatedSlots = Array.from(new Set([...completedToday, targetSlot]));
  aiCurationStateMemory.completedSlotsByDate[dateKey] = updatedSlots;
  aiCurationStateMemory.lastRunAt = curatedAt;
  aiCurationStateMemory.lastSlot = targetSlot;
  aiCurationStateMemory.lastBatchId = batchId;
  aiCurationStateMemory.lastTrigger = triggerSource;
  aiCurationStateMemory.lastStatus = totalStagedInRun > 0 ? 'succeeded' : 'empty';
  aiCurationStateMemory.lastSummary = `Staged ${totalStagedInRun} AI-picked stories across ${NEWS_CATEGORIES.length} categories for ${getSlotLabel(targetSlot)}`;
  aiCurationStateMemory.updatedAt = curatedAt;
  aiCurationStateMemory.updatedBy = updatedBy;

  await usage.flush(env);

  return {
    skipped: false,
    slot: targetSlot,
    slotLabel: getSlotLabel(targetSlot),
    batchId,
    totalStagedInRun,
    stagedByCategory,
    aiCuration: getAiCurationState()
  };
}

export async function ensureAndGetAiCurationSnapshot(env, {
  recentRows = [],
  bannedRows = [],
  pendingRows = []
} = {}) {
  computeLearnedTasteSignals(recentRows, bannedRows);

  // Sync any existing staged picks against latest DB rows
  const approvedIdSet = new Set(
    recentRows.filter(r => r.approved && !r.removed).map(r => Number(r.id))
  );
  const disapprovedIdSet = new Set(
    recentRows.filter(r => !r.approved && !r.removed && r.decision_action === 'disapprove').map(r => Number(r.id))
  );
  const bannedIdSet = new Set(
    bannedRows.map(r => Number(r.id))
  );

  for (const [storyId, pick] of aiStagedPicksMemory.entries()) {
    if (bannedIdSet.has(storyId)) {
      pick.status = 'banned';
      pick.removed = true;
      pick.approved = false;
    } else if (approvedIdSet.has(storyId)) {
      pick.status = 'approved';
      pick.approved = true;
      pick.removed = false;
    } else if (disapprovedIdSet.has(storyId)) {
      pick.status = 'disapproved';
      pick.approved = false;
    }
  }

  // If auto-curation is enabled and either no run has happened yet or current slot is due, run curation
  const currentState = getAiCurationState();
  if (
    aiCurationStateMemory.enabled &&
    (aiCurationStateMemory.lastRunAt === null || currentState.isSlotDue) &&
    pendingRows.length > 0
  ) {
    try {
      await runAiStoryCuration(env, {
        slot: currentState.currentSlot,
        triggerSource: aiCurationStateMemory.lastRunAt === null ? 'initial_seed' : 'scheduled_window',
        updatedBy: 'ai-scheduler',
        preloadedRecentRows: recentRows,
        preloadedBannedRows: bannedRows,
        preloadedPendingRows: pendingRows
      });
    } catch (err) {
      console.warn('Automatic AI story curation on snapshot load failed:', err);
    }
  }

  return getAiCurationState();
}

export async function bulkDecideNewsStories(env, storyIds = [], action = 'approve', decidedBy = 'admin') {
  if (!['approve', 'disapprove', 'ban'].includes(action)) {
    throw new Error('Invalid bulk decision action');
  }
  const cleanIds = Array.from(new Set(
    (Array.isArray(storyIds) ? storyIds : [])
      .map(id => Number(id))
      .filter(id => Number.isSafeInteger(id) && id > 0)
  )).slice(0, 100);

  if (cleanIds.length === 0) {
    return { action, requestedCount: 0, succeededIds: [], failedIds: [] };
  }

  const succeededIds = [];
  const failedIds = [];

  await Promise.all(cleanIds.map(async (storyId) => {
    try {
      let ok = false;
      if (action === 'approve') {
        ok = await approveNewsStory(env, storyId, decidedBy);
      } else if (action === 'disapprove') {
        ok = await disapproveNewsStory(env, storyId, decidedBy);
      } else if (action === 'ban') {
        ok = await banNewsStory(env, storyId, decidedBy);
      }
      if (ok) {
        succeededIds.push(storyId);
      } else {
        // Still update local staged state if already decided
        syncAiStagedPickDecision(
          storyId,
          action === 'approve' ? 'approved' : action === 'ban' ? 'banned' : 'disapproved',
          decidedBy
        );
        failedIds.push(storyId);
      }
    } catch (err) {
      console.error(`Bulk ${action} failed for story ${storyId}:`, err);
      failedIds.push(storyId);
    }
  }));

  return {
    action,
    requestedCount: cleanIds.length,
    succeededCount: succeededIds.length,
    succeededIds,
    failedIds,
    aiCuration: getAiCurationState()
  };
}



// ── Story engagement tracking (recommendation feedback loop) ──

function hashUrl(url) {
  let hash = 0;
  const str = String(url || '');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return 'h' + Math.abs(hash).toString(36);
}

export async function recordEngagementEvent(env, { url: storyUrl, title, category, eventType, sessionId, keywords, referrer_domain, utm_source, utm_medium, utm_campaign, country_code, dwell_seconds }) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY) return { ok: false, reason: 'no-supabase' };
  if (!storyUrl || !['view', 'click', 'dwell'].includes(eventType)) return { ok: false, reason: 'invalid' };

  // Normalize keywords to known ids only (defensive: frontend could send anything).
  const cleanKeywords = Array.isArray(keywords)
    ? [...new Set(keywords.filter((k) => typeof k === 'string' && INTEREST_KEYWORD_IDS.has(k)).slice(0, 10))]
    : null;

  try {
    const res = await fetch(supabaseUrl(env, 'story_engagement'), {
      method: 'POST',
      headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        story_url_hash: hashUrl(storyUrl),
        story_url: String(storyUrl).slice(0, 2000),
        story_title: String(title || '').slice(0, 500),
        category: String(category || 'all').slice(0, 50),
        event_type: eventType,
        session_id: String(sessionId || '').slice(0, 64) || null,
        keywords: cleanKeywords,
        referrer_domain: String(referrer_domain || '').slice(0, 120) || null,
        utm_source: String(utm_source || '').slice(0, 120) || null,
        utm_medium: String(utm_medium || '').slice(0, 120) || null,
        utm_campaign: String(utm_campaign || '').slice(0, 120) || null,
        country_code: String(country_code || '').slice(0, 2).toUpperCase() || null,
        dwell_seconds: eventType === 'dwell' ? Math.max(0, Math.min(600, Math.round(Number(dwell_seconds) || 0))) : null,
      }),
    });
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

// ── Search query logging ──
// Anonymous: query text + result count + country. No user_id, no IP, no session.
// Internal traffic (admin panel, dev site, localhost) is never logged.

function normalizeSearchQuery(q) {
  return String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function looksLikePii(q) {
  const s = String(q || '');
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(s)) return true; // email
  const digits = (s.match(/\d/g) || []).length;
  const chars = s.replace(/\s/g, '').length;
  if (chars > 0 && digits / chars > 0.5 && chars >= 7) return true; // phone-ish
  return false;
}

/**
 * True if the request comes from an internal surface (admin panel, dev site,
 * localhost) — its searches/views would pollute audience analytics.
 */
export function isInternalRequest(request) {
  try {
    const referer = request.headers.get('referer') || '';
    const origin = request.headers.get('origin') || '';
    const sources = `${referer} ${origin}`.toLowerCase();
    // Admin panel
    if (sources.includes('/admin')) return true;
    // Dev site and local testing
    if (sources.includes('dev.littlables.com')) return true;
    if (sources.includes('localhost') || sources.includes('127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

export async function recordSearchQuery(env, { query, resultCount, country_code }) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY) return { ok: false, reason: 'no-supabase' };
  const raw = String(query || '').trim().slice(0, 200);
  const normalized = normalizeSearchQuery(raw);
  if (!normalized || normalized.length < 2) return { ok: false, reason: 'empty' };
  if (looksLikePii(raw)) return { ok: false, reason: 'pii' };
  try {
    const res = await fetch(supabaseUrl(env, 'search_queries'), {
      method: 'POST',
      headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        query: raw,
        normalized_query: normalized,
        result_count: Math.max(0, Math.round(Number(resultCount) || 0)),
        country_code: String(country_code || '').slice(0, 2).toUpperCase() || null,
      }),
    });
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

// ── Space creation analytics ──
// Anonymous: pills only, no user_id, no space name.

export async function recordBoardEvent(env, { sessionId, keywordIds, categoryIds, country_code }) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY) return { ok: false, reason: 'no-supabase' };
  const cleanKeywords = Array.isArray(keywordIds)
    ? [...new Set(keywordIds.filter((k) => typeof k === 'string' && INTEREST_KEYWORD_IDS.has(k)).slice(0, 20))]
    : null;
  const cleanCategories = Array.isArray(categoryIds)
    ? [...new Set(categoryIds.filter((c) => typeof c === 'string').slice(0, 20))]
    : null;
  if ((!cleanKeywords || cleanKeywords.length === 0) && (!cleanCategories || cleanCategories.length === 0)) {
    return { ok: false, reason: 'no-pills' };
  }
  try {
    const res = await fetch(supabaseUrl(env, 'board_analytics'), {
      method: 'POST',
      headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        session_id: String(sessionId || '').slice(0, 64) || null,
        keyword_ids: cleanKeywords,
        category_ids: cleanCategories,
        country_code: String(country_code || '').slice(0, 2).toUpperCase() || null,
      }),
    });
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

// Returns { urlHash: { views, clicks, ctr } } for recent engagement
export async function getEngagementSignals(env, limit = 500) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY) return {};
  try {
    const res = await fetch(
      supabaseUrl(env, 'story_engagement_stats', 'select=story_url_hash,views,clicks,ctr&order=views.desc&limit=' + limit),
      { headers: supabaseHeaders(env) }
    );
    if (!res.ok) return {};
    const rows = await res.json();
    const signals = {};
    for (const row of rows) {
      signals[row.story_url_hash] = {
        views: Number(row.views) || 0,
        clicks: Number(row.clicks) || 0,
        ctr: Number(row.ctr) || 0,
      };
    }
    return signals;
  } catch {
    return {};
  }
}

// ── Near-duplicate detection ──

export function titleSimilarity(titleA, titleB) {
  const termsA = new Set(extractMeaningfulTerms(titleA));
  const termsB = new Set(extractMeaningfulTerms(titleB));
  if (termsA.size === 0 || termsB.size === 0) return 0;
  let intersection = 0;
  for (const term of termsA) {
    if (termsB.has(term)) intersection++;
  }
  const union = termsA.size + termsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function findNearDuplicates(candidates, existingStories, threshold = 0.7) {
  const duplicates = [];
  for (const candidate of candidates) {
    for (const existing of existingStories) {
      if (candidate.link && existing.link && candidate.link === existing.link) {
        duplicates.push({ candidate, existing, reason: 'same-url', similarity: 1 });
        break;
      }
      const sim = titleSimilarity(candidate.title || '', existing.title || '');
      if (sim >= threshold) {
        duplicates.push({ candidate, existing, reason: 'similar-title', similarity: Math.round(sim * 100) / 100 });
        break;
      }
    }
  }
  return duplicates;
}

export { hashUrl };

// ── Analytics dashboard data ──
// Reads the stats views for the admin panel. Admin-only (checked in index.js).

const ANALYTICS_VIEWS = {
  search: 'search_query_stats',
  search_gaps: 'search_zero_result_queries',
  keywords: 'keyword_engagement_stats',
  boards: 'board_topic_stats',
  acquisition: 'acquisition_stats',
  dwell: 'story_dwell_stats',
  ads: 'ad_engagement_stats',
  ad_networks: 'ad_network_stats',
};

/**
 * Fetch analytics stats for the admin dashboard.
 * @param {object} env
 * @param {object} opts - { type, country, region, limit }
 */
export async function getAnalyticsStats(env, { type, country, region, limit = 50 } = {}) {
  const view = ANALYTICS_VIEWS[type];
  if (!view) return { ok: false, reason: 'unknown-type' };
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY) return { ok: false, reason: 'no-supabase' };

  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('order', type === 'search_gaps' || type === 'search' ? 'searches.desc' : type === 'keywords' ? 'views.desc' : type === 'boards' ? 'boards_built.desc' : type === 'dwell' ? 'dwell_events.desc' : type === 'ads' || type === 'ad_networks' ? 'impressions.desc' : 'sessions.desc');
  const cleanCountry = String(country || '').toUpperCase().slice(0, 2);
  const cleanRegion = String(region || '').toLowerCase().slice(0, 30);
  if (cleanCountry) params.set('country_code', `eq.${cleanCountry}`);
  if (cleanRegion && cleanRegion !== 'all') params.set('region', `eq.${cleanRegion}`);
  params.set('limit', String(Math.min(200, Math.max(1, Number(limit) || 50))));

  // No country/region filter = all rows; frontend groups as needed.
  try {
    const res = await fetch(supabaseUrl(env, view, params.toString()), {
      headers: supabaseHeaders(env),
    });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const rows = await res.json();
    return { ok: true, type, rows };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

// ── Ad engagement tracking ──
// Anonymous impressions/clicks per ad. Powers revenue analytics.

export async function recordAdEvent(env, { adId, adTitle, network, category, storyUrlHash, eventType, sessionId, country_code }) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY) return { ok: false, reason: 'no-supabase' };
  if (!adId || !['view', 'click'].includes(eventType)) return { ok: false, reason: 'invalid' };
  try {
    const res = await fetch(supabaseUrl(env, 'ad_engagement'), {
      method: 'POST',
      headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        ad_id: String(adId).slice(0, 200),
        ad_title: String(adTitle || '').slice(0, 500),
        network: String(network || '').slice(0, 50) || null,
        category: String(category || '').slice(0, 50) || null,
        story_url_hash: String(storyUrlHash || '').slice(0, 100) || null,
        event_type: eventType,
        session_id: String(sessionId || '').slice(0, 64) || null,
        country_code: String(country_code || '').slice(0, 2).toUpperCase() || null,
      }),
    });
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

// ── Interest & Playroom feeds ──
// Backend APIs for playroom/space content. Replaces frontend parallel /feed
// requests with server-side merging.

// Front-page categories that a space interest can map to.
// A space pill with one of these IDs pulls the front-page category feed.
const FRONT_PAGE_CATEGORIES = new Set(['childcare', 'animals', 'arts', 'tech', 'world', 'uplifting', 'all']);

/**
 * Stories matching ANY of the given interest IDs.
 * Category IDs (childcare, animals, etc.) pull front-page category feeds;
 * keyword IDs use keyword overlap. Approved first, then unapproved,
 * both date-sorted. Deduped by URL.
 */
export async function getStoriesByInterests(env, interestIds) {
  const ids = [...new Set((interestIds || []).map(String).filter(Boolean))].slice(0, 30);
  if (ids.length === 0) return { provider: 'supabase', items: [] };

  const categoryIds = ids.filter(id => FRONT_PAGE_CATEGORIES.has(id));
  const keywordIds = ids.filter(id => !FRONT_PAGE_CATEGORIES.has(id));

  const feedPromises = categoryIds.map(cat => getStoredNewsFeed(env, cat));
  if (keywordIds.length > 0) {
    const makeQuery = approved => {
      const params = new URLSearchParams({
        select: 'provider,category,display_categories,interest_keywords,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,fetched_at',
        approved: `eq.${approved}`,
        removed: 'eq.false',
        'interest_keywords': `ov.{${keywordIds.join(',')}}`,
        order: 'published_at.desc.nullslast,fetched_at.desc',
        limit: '50'
      });
      return params;
    };
    const keywordFeedPromise = (async () => {
      const [approvedResponse, unapprovedResponse] = await Promise.all([
        fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(true)), { headers: supabaseHeaders(env) }),
        fetch(supabaseUrl(env, STORIES_TABLE, makeQuery(false)), { headers: supabaseHeaders(env) })
      ]);
      const [approvedRows, unapprovedRows] = await Promise.all([
        readRows(approvedResponse, 'Approved interest feed lookup'),
        readRows(unapprovedResponse, 'Unapproved interest feed lookup')
      ]);
      const items = [];
      for (const row of [...approvedRows, ...unapprovedRows]) {
        if (!row.article_url) continue;
        items.push({ ...normalizeStory(row), approved: row.approved });
      }
      return { provider: 'supabase', items };
    })();
    feedPromises.push(keywordFeedPromise);
  }

  const results = await Promise.allSettled(feedPromises);
  const seenUrls = new Set();
  const approved = [];
  const unapproved = [];
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value?.items) continue;
    for (const item of r.value.items) {
      const url = item.link || item.article_url;
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      if (item.approved === true) approved.push(item);
      else unapproved.push(item);
    }
  }
  const rankedApproved = await applyReactionRanking(env, approved);
  const rankedUnapproved = await applyReactionRanking(env, unapproved);
  return { provider: 'supabase', items: [...rankedApproved, ...rankedUnapproved] };
}

// Front-page composite spaces map 1:1 to legacy category column values,
// so their preview can compare interest matches against the category fallback.
const FRONT_PAGE_SPACE_CATEGORIES = new Set(['childcare', 'animals', 'arts', 'tech', 'world', 'uplifting']);

/**
 * Phase 2 preview: run the interest-overlap query for one space and return
 * a first-50 sample plus diagnostics. Touches no live feed.
 * Returns { space, description, interestIds, items, matchCount,
 *   flaggedFilteredCount, categoryFallbackCount }.
 * categoryFallbackCount is null for standalone spaces (no legacy category).
 * Subrequest budget: at most 6 Supabase fetches (interest match +
 * unfiltered count + category fallback, each approved + unapproved).
 */
export async function getSpaceFeedPreview(env, spaceKey) {
  const def = SPACE_DEFINITIONS[spaceKey];
  if (!def) {
    return { error: 'Unknown space', validSpaces: Object.keys(SPACE_DEFINITIONS).sort() };
  }
  const interestIds = [...new Set((def.interestIds || []).map(String).filter(Boolean))];
  if (interestIds.length === 0) {
    return { space: spaceKey, description: def.description, interestIds: [], items: [], matchCount: 0, flaggedFilteredCount: 0, categoryFallbackCount: null };
  }
  const excludedIds = [...EXCLUDED_KEYWORD_IDS];
  const exclusionParam = excludedIds.length > 0
    ? `(interest_keywords.not.is.null,interest_keywords.ov.{${excludedIds.join(',')}})`
    : null;
  const baseSelect = 'provider,category,display_categories,interest_keywords,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,fetched_at';
  const makeInterestQuery = (approved, applyExclusion) => {
    const params = new URLSearchParams({
      select: baseSelect,
      approved: `eq.${approved}`,
      removed: 'eq.false',
      'interest_keywords': `ov.{${interestIds.join(',')}}`,
      order: 'published_at.desc.nullslast,fetched_at.desc',
      limit: '50'
    });
    if (applyExclusion && exclusionParam) params.set('not.and', exclusionParam);
    return params;
  };
  const fetchInterest = async (approved, applyExclusion) => {
    const res = await fetch(supabaseUrl(env, STORIES_TABLE, makeInterestQuery(approved, applyExclusion)), { headers: supabaseHeaders(env) });
    return readRows(res, 'Space preview interest lookup');
  };
  const [approvedRows, unapprovedRows, approvedUnfiltered, unapprovedUnfiltered] = await Promise.all([
    fetchInterest(true, true),
    fetchInterest(false, true),
    fetchInterest(true, false),
    fetchInterest(false, false)
  ]);
  const seenUrls = new Set();
  const items = [];
  for (const row of [...approvedRows, ...unapprovedRows]) {
    if (!row.article_url || seenUrls.has(row.article_url)) continue;
    seenUrls.add(row.article_url);
    items.push({ ...normalizeStory(row), approved: row.approved });
  }
  const unfilteredUrls = new Set();
  for (const row of [...approvedUnfiltered, ...unapprovedUnfiltered]) {
    if (row.article_url) unfilteredUrls.add(row.article_url);
  }
  const flaggedFilteredCount = [...unfilteredUrls].filter(url => !seenUrls.has(url)).length;
  let categoryFallbackCount = null;
  if (FRONT_PAGE_SPACE_CATEGORIES.has(spaceKey)) {
    const makeCategoryQuery = approved => {
      const params = new URLSearchParams({
        select: 'article_url',
        approved: `eq.${approved}`,
        removed: 'eq.false',
        or: `(and(category.eq.${spaceKey},display_categories.is.null),display_categories.cs.{${spaceKey}})`,
        limit: '50'
      });
      if (exclusionParam) params.set('not.and', exclusionParam);
      return params;
    };
    const [catApproved, catUnapproved] = await Promise.all([
      fetch(supabaseUrl(env, STORIES_TABLE, makeCategoryQuery(true)), { headers: supabaseHeaders(env) }).then(r => readRows(r, 'Space preview category fallback')),
      fetch(supabaseUrl(env, STORIES_TABLE, makeCategoryQuery(false)), { headers: supabaseHeaders(env) }).then(r => readRows(r, 'Space preview category fallback'))
    ]);
    const catUrls = new Set();
    for (const row of [...catApproved, ...catUnapproved]) {
      if (row.article_url) catUrls.add(row.article_url);
    }
    categoryFallbackCount = [...catUrls].filter(url => !seenUrls.has(url)).length;
  }
  return {
    space: spaceKey,
    description: def.description,
    interestIds,
    items,
    matchCount: items.length,
    flaggedFilteredCount,
    categoryFallbackCount
  };
}

/**
 * Full feed for a playroom. When spaceId is given, filters to that space's
 * interests; otherwise merges across all spaces in the playroom.
 * Returns approved-first, date-sorted, deduped items.
 */
export async function getPlayroomFeed(env, playroomId, spaceId, username, slug) {
  if (!playroomId && username && slug) {
    const profileRes = await fetch(supabaseUrl(env, 'profiles', new URLSearchParams({
      select: 'id', username: `eq.${String(username).toLowerCase()}`, limit: '1'
    })), { headers: supabaseHeaders(env) });
    const profileRows = await readRows(profileRes, 'Profile lookup');
    const profile = profileRows[0];
    if (!profile) return { playroom: null, spaces: [], items: [] };
    const prRes = await fetch(supabaseUrl(env, 'playrooms', new URLSearchParams({
      select: 'id', user_id: `eq.${profile.id}`,
      slug: `eq.${String(slug).toLowerCase()}`, limit: '1'
    })), { headers: supabaseHeaders(env) });
    const prRows = await readRows(prRes, 'Playroom ID lookup');
    playroomId = prRows[0]?.id || null;
  }
  if (!playroomId) return { playroom: null, spaces: [], items: [] };

  const [playroomRes, spacesRes] = await Promise.all([
    fetch(supabaseUrl(env, 'playrooms', new URLSearchParams({
      select: 'id,user_id,name,slug,description,logo_url,theme,background_color',
      id: `eq.${playroomId}`, limit: '1'
    })), { headers: supabaseHeaders(env) }),
    fetch(supabaseUrl(env, 'playroom_spaces', new URLSearchParams({
      select: 'position,boards(*)',
      playroom_id: `eq.${playroomId}`, order: 'position.asc'
    })), { headers: supabaseHeaders(env) })
  ]);
  const [playroomRows, spaceRows] = await Promise.all([
    readRows(playroomRes, 'Playroom lookup'),
    readRows(spacesRes, 'Playroom spaces lookup')
  ]);
  const playroom = playroomRows[0] || null;
  if (!playroom) return { playroom: null, spaces: [], items: [] };

  const spaces = (spaceRows || [])
    .map(r => r.boards).filter(Boolean)
    .map(b => Array.isArray(b) ? b[0] : b).filter(Boolean);

  const targetSpaces = spaceId ? spaces.filter(s => s.id === spaceId) : spaces;
  const seenPills = new Map();
  for (const space of targetSpaces) {
    for (const p of space.pills || []) {
      const key = `${p.type}:${p.id}`;
      if (!seenPills.has(key)) seenPills.set(key, p);
    }
  }
  const pills = [...seenPills.values()];
  // If no pills are selected, fall back to the space/playroom description:
  // embed the description and find the most similar interests.
  let derivedKeywordIds = [];
  if (pills.length === 0) {
    const descText = [
      playroom.description,
      ...spaces.map(s => s.name)
    ].filter(Boolean).join(' ');
    if (descText && env.AI) {
      try {
        const descVector = await embedText(env, descText);
        const fallbackUsage = createAiUsageCounter();
        if (descVector) fallbackUsage.add(AI_USAGE_MODEL_BGE, 'playroom-fallback', 1);
        else fallbackUsage.add(AI_USAGE_MODEL_BGE, 'playroom-fallback', 0, 1);
        await fallbackUsage.flush(env);
        const { vectors } = await getPersistedKeywordEmbeddings(env);
        if (vectors && descVector) {
          const scored = [];
          for (const [kwId, kwVector] of vectors) {
            if (EXCLUDED_KEYWORD_IDS.has(kwId)) continue;
            const sim = cosineSimilarity(descVector, kwVector);
            if (sim >= 0.35) scored.push({ id: kwId, sim });
          }
          scored.sort((a, b) => b.sim - a.sim);
          derivedKeywordIds = scored.slice(0, 5).map(s => s.id);
        }
      } catch (e) {
        // Fall through to empty feed on embedding failure
      }
    }
    if (derivedKeywordIds.length === 0) {
      return { playroom, spaces, items: [] };
    }
  }

  const categoryIds = [];
  const keywordIds = [...derivedKeywordIds];
  for (const p of pills) {
    if (p.type === 'category' && FRONT_PAGE_CATEGORIES.has(p.id)) {
      categoryIds.push(p.id);
    } else if (p.type === 'keyword') {
      keywordIds.push(p.id);
    } else if (p.type === 'custom') {
      const kws = (p.keywords || '').split(',').map(s => s.trim()).filter(Boolean);
      if (kws.length > 0) keywordIds.push(...kws);
      else if (p.label) keywordIds.push(p.label.toLowerCase());
    } else {
      keywordIds.push(p.id);
    }
  }

  const feedPromises = categoryIds.map(cat => getStoredNewsFeed(env, cat));
  if (keywordIds.length > 0) {
    feedPromises.push(getStoriesByInterests(env, keywordIds));
  }
  const results = await Promise.allSettled(feedPromises);

  const seenUrls = new Set();
  const approved = [];
  const unapproved = [];
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value?.items) continue;
    for (const item of r.value.items) {
      const url = item.link || item.article_url;
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      if (item.approved === true) approved.push(item);
      else unapproved.push(item);
    }
  }
  const rankedApproved = await applyReactionRanking(env, approved);
  const rankedUnapproved = await applyReactionRanking(env, unapproved);

  return { playroom, spaces, items: [...rankedApproved, ...rankedUnapproved] };
}

// ---------------------------------------------------------------------------
// Taste Reader (step 2): manual selection run.
//
// The gated site page (not the GitHub admin panel) calls POST
// /api/taste-reader/run with the signed-in user's Supabase access token.
// The worker verifies that token against Supabase Auth, checks
// profiles.is_admin for the token's user, and uses that user's id as
// taste_reader_runs.user_id — no worker secret and no invented uid.
// Scoring reuses scoreCandidateStory with the story's full content
// blanked, so only the title + description the reader actually reads
// affect the score, and with no engagement boost ({}), so popularity
// cannot crowd out new content. Pool defaults, all deliberate:
// unapproved only, removed=false, decided rows excluded
// (decision_action null/undo), published_at strictly inside the past
// 24 hours (null published_at is excluded by the range filter), flagged
// interests excluded with the same De Morgan rewrite as the front-page
// feeds. Per-space queries (6 front-page spaces, 50 each) keep slow
// spaces from crowding out fast ones; dedupe assigns each story to its
// highest-overlap space (ties keep the earliest space in order); the
// pool round-robins across spaces and caps at 100 (10 pages of 10).
// ---------------------------------------------------------------------------

export const TASTE_READER_RUNS_TABLE = 'taste_reader_runs';
export const TASTE_READER_RUN_ITEMS_TABLE = 'taste_reader_run_items';
const TASTE_READER_FRONT_PAGE_SPACES = ['childcare', 'animals', 'arts', 'tech', 'world', 'uplifting'];
const TASTE_READER_PER_SPACE_LIMIT = 50;
const TASTE_READER_POOL_CAP = 100;
const TASTE_READER_PAGE_SIZE = 10;
const TASTE_READER_WINDOW_MS = 24 * 3600 * 1000;

/**
 * Verify a Taste Reader caller: Supabase access token -> Auth user ->
 * profiles.is_admin. Returns { userId } or { error, status }.
 * The Supabase service key doubles as the project API key for the Auth
 * call; the user's own Bearer token is what proves who they are.
 */
export async function verifyTasteReaderAdmin(env, request) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY) {
    return { error: 'Taste Reader is not configured', status: 503 };
  }
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) {
    return { error: 'Supabase sign-in is required', status: 401 };
  }
  let userResponse;
  try {
    userResponse = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${token}` }
    });
  } catch {
    return { error: 'Could not verify sign-in', status: 502 };
  }
  if (!userResponse.ok) {
    return { error: 'Supabase sign-in is required', status: 401 };
  }
  const user = await userResponse.json().catch(() => null);
  const userId = user && typeof user.id === 'string' ? user.id : '';
  if (!userId) {
    return { error: 'Supabase sign-in is required', status: 401 };
  }
  let profileResponse;
  try {
    profileResponse = await fetch(
      supabaseUrl(env, 'profiles', new URLSearchParams({ select: 'is_admin', id: `eq.${userId}` })),
      { headers: supabaseHeaders(env) }
    );
  } catch {
    return { error: 'Could not verify admin status', status: 502 };
  }
  if (!profileResponse.ok) {
    return { error: 'Could not verify admin status', status: 502 };
  }
  const rows = await profileResponse.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0 || rows[0].is_admin !== true) {
    return { error: 'Taste Reader is for admins only', status: 403 };
  }
  return { userId };
}

/**
 * Build one Taste Reader pool: run row + ordered run items, first page
 * returned. Returns { error } on an invalid interest filter, otherwise
 * { runId, userId, windowStart, windowEnd, interestFilter, totalCount,
 *   nextPosition, items } where items are the first page (at most 10).
 * Throws on Supabase failures so the route can answer 502; a failed
 * items insert deletes the just-created run row first, so a half-built
 * run never lingers in the strip.
 */
export async function createTasteReaderRun(env, { userId, interestFilter = null, now = new Date() } = {}) {
  const filter = typeof interestFilter === 'string' && interestFilter.trim() ? interestFilter.trim() : null;
  if (filter && !isValidInterestKeyword(filter)) {
    return { error: 'Unknown interest keyword' };
  }
  const windowEnd = now instanceof Date ? now : new Date(now);
  const windowStart = new Date(windowEnd.getTime() - TASTE_READER_WINDOW_MS);

  // Learned taste signals, same sources as AI curation (recent 60 decided
  // + 40 banned). Failures here only weaken scoring, never the run.
  let signals = null;
  if (env?.SUPABASE_URL && env?.SUPABASE_SECRET_KEY) {
    try {
      const [recentRes, bannedRes] = await Promise.all([
        fetch(supabaseUrl(env, STORIES_TABLE, new URLSearchParams({
          select: 'id,provider,category,title,description,source_name,approved,removed,decision_action,decision_at',
          decision_at: 'not.is.null',
          order: 'decision_at.desc',
          limit: '60'
        })), { headers: supabaseHeaders(env) }),
        fetch(supabaseUrl(env, STORIES_TABLE, new URLSearchParams({
          select: 'id,provider,category,title,description,source_name,approved,removed,decision_action,removed_at',
          removed: 'eq.true',
          order: 'removed_at.desc.nullslast',
          limit: '40'
        })), { headers: supabaseHeaders(env) })
      ]);
      const recentRows = recentRes.ok ? await recentRes.json() : [];
      const bannedRows = bannedRes.ok ? await bannedRes.json() : [];
      signals = computeLearnedTasteSignals(
        Array.isArray(recentRows) ? recentRows : [],
        Array.isArray(bannedRows) ? bannedRows : []
      );
    } catch {
      signals = null;
    }
  }
  if (!signals) {
    signals = computeLearnedTasteSignals([], []);
  }
  const tasteProfile = { ...aiTasteProfileMemory };

  // Per-space candidate queries, concurrent. DB truth (not the
  // in-memory dismissed set) decides what is still undecided.
  const excludedIds = [...EXCLUDED_KEYWORD_IDS];
  const candidateRequests = TASTE_READER_FRONT_PAGE_SPACES.map(space => {
    const def = SPACE_DEFINITIONS[space];
    const interestIds = [...new Set((def?.interestIds || []).map(String).filter(Boolean))];
    const params = new URLSearchParams({
      select: 'id,provider,category,display_categories,interest_keywords,title,article_url,image_url,description,content,ai_summary,published_at,source_name,approved,removed,fetched_at,decision_action',
      approved: 'eq.false',
      removed: 'eq.false',
      // One logic tree: (space match) AND (still undecided). Two separate
      // `or` params would collide, so both groups nest inside `and`.
      and: `(or(interest_keywords.ov.{${interestIds.join(',')}},display_categories.cs.{${space}}),or(decision_action.is.null,decision_action.eq.undo))`,
      order: 'published_at.desc.nullslast,fetched_at.desc',
      limit: String(TASTE_READER_PER_SPACE_LIMIT)
    });
    // PostgREST has no single range operator: two published_at params AND.
    params.append('published_at', `gte.${windowStart.toISOString()}`);
    params.append('published_at', `lte.${windowEnd.toISOString()}`);
    if (excludedIds.length > 0) {
      params.set('not.and', `(interest_keywords.not.is.null,interest_keywords.ov.{${excludedIds.join(',')}})`);
    }
    return fetch(supabaseUrl(env, STORIES_TABLE, params), { headers: supabaseHeaders(env) })
      .then(async res => {
        if (!res.ok) throw new Error('Taste Reader candidate lookup failed');
        return { space, rows: await res.json() };
      });
  });
  const spaceResults = await Promise.all(candidateRequests);

  // Dedupe by content id, assigning the highest-overlap space (ties keep
  // the earliest space in front-page order, since spaces iterate in order
  // and only a strictly higher overlap replaces the assignment).
  const byId = new Map();
  for (const { space, rows } of spaceResults) {
    if (!Array.isArray(rows)) continue;
    const spaceInterestIds = new Set(SPACE_DEFINITIONS[space]?.interestIds || []);
    for (const row of rows) {
      if (!row || row.id == null || !row.article_url) continue;
      const story = { ...normalizeStory(row), id: Number(row.id), approved: false, removed: false };
      const keywords = Array.isArray(story.interestKeywords) ? story.interestKeywords : [];
      const overlap = keywords.filter(k => spaceInterestIds.has(k)).length;
      const existing = byId.get(story.id);
      if (!existing) {
        byId.set(story.id, { story, space, overlap });
      } else if (overlap > existing.overlap) {
        existing.space = space;
        existing.overlap = overlap;
      }
    }
  }

  // Score title + description only, no engagement boost.
  let scored = Array.from(byId.values()).map(({ story, space }) => {
    const { score } = scoreCandidateStory({ ...story, content: '' }, signals, tasteProfile, {});
    return { story, space, score };
  });
  if (filter) {
    scored = scored.filter(({ story }) => (story.interestKeywords || []).includes(filter));
  }

  // Sort within each space, then round-robin across spaces to the cap.
  const bySpace = new Map(TASTE_READER_FRONT_PAGE_SPACES.map(space => [space, []]));
  for (const item of scored) {
    if (!bySpace.has(item.space)) bySpace.set(item.space, []);
    bySpace.get(item.space).push(item);
  }
  for (const list of bySpace.values()) {
    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.story.pubDate || '') !== (a.story.pubDate || '')) return (b.story.pubDate || '').localeCompare(a.story.pubDate || '');
      return a.story.id - b.story.id;
    });
  }
  const pool = [];
  const cursors = new Map(TASTE_READER_FRONT_PAGE_SPACES.map(space => [space, 0]));
  let progressed = true;
  while (pool.length < TASTE_READER_POOL_CAP && progressed) {
    progressed = false;
    for (const space of TASTE_READER_FRONT_PAGE_SPACES) {
      if (pool.length >= TASTE_READER_POOL_CAP) break;
      const list = bySpace.get(space) || [];
      const cursor = cursors.get(space) || 0;
      if (cursor < list.length) {
        pool.push(list[cursor]);
        cursors.set(space, cursor + 1);
        progressed = true;
      }
    }
  }

  // Persist: run row first (returning its id), then one bulk items insert.
  const runResponse = await fetch(supabaseUrl(env, TASTE_READER_RUNS_TABLE, ''), {
    method: 'POST',
    headers: supabaseHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      user_id: userId,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      interest_filter: filter,
      total_count: pool.length,
      next_position: Math.min(TASTE_READER_PAGE_SIZE, pool.length)
    })
  });
  if (!runResponse.ok) throw new Error('Taste Reader run could not be saved');
  const runRows = await runResponse.json().catch(() => null);
  const runId = Array.isArray(runRows) && runRows[0] ? runRows[0].id : null;
  if (!runId) throw new Error('Taste Reader run could not be saved');

  const itemsResponse = await fetch(supabaseUrl(env, TASTE_READER_RUN_ITEMS_TABLE, ''), {
    method: 'POST',
    headers: supabaseHeaders(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify(pool.map((item, position) => ({
      run_id: runId,
      user_id: userId,
      position,
      content_id: item.story.id,
      status: 'queued'
    })))
  });
  if (!itemsResponse.ok) {
    // Best-effort cleanup so a half-built run never lingers.
    try {
      await fetch(supabaseUrl(env, TASTE_READER_RUNS_TABLE, new URLSearchParams({ id: `eq.${runId}` })), {
        method: 'DELETE',
        headers: supabaseHeaders(env, { Prefer: 'return=minimal' })
      });
    } catch {
      // Cleanup failure is secondary to reporting the run failure.
    }
    throw new Error('Taste Reader run items could not be saved');
  }

  const firstPage = pool.slice(0, TASTE_READER_PAGE_SIZE).map((item, position) => ({
    position,
    contentId: item.story.id,
    score: item.score,
    space: item.space,
    title: item.story.title,
    description: item.story.description,
    link: item.story.link,
    image: item.story.image,
    pubDate: item.story.pubDate,
    source: item.story.source,
    category: item.story.category,
    interestKeywords: item.story.interestKeywords
  }));
  return {
    runId,
    userId,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    interestFilter: filter,
    totalCount: pool.length,
    nextPosition: Math.min(TASTE_READER_PAGE_SIZE, pool.length),
    items: firstPage
  };
};

// Taste Reader reader actions: word scores + notes. Append-only tables, so
// every click is a record, not an overwrite — the weighted list (step 5)
// sums these rows per user + word.

export const TASTE_READER_WORD_SCORE_DELTAS = Object.freeze({
  up: 1,
  down: -1,
  next: -1,
  ignore: -3,
  ban: -5
});

// Aggregation key: lowercase, punctuation trimmed from both ends (the same
// rule the frontend uses, so a marked word and its stored key always
// match). Punctuation-only tokens normalize to '' and are unscoreable.
export function normalizeTasteReaderWord(word) {
  if (typeof word !== 'string') return '';
  return word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

const TASTE_READER_NOTE_KINDS = new Set(['user_note', 'ai_reason']);
const TASTE_READER_NOTE_CONTEXTS = new Set(['viewed', 'skipped', 'ignored', 'banned', 'next']);

export async function recordTasteReaderWordScore(env, {
  userId, contentId, runId = null, wordDisplay, source, wordPosition, action
} = {}) {
  if (!userId || !Number.isFinite(Number(contentId))) {
    return { error: 'A content balloon and a signed-in admin are required' };
  }
  const delta = TASTE_READER_WORD_SCORE_DELTAS[action];
  if (delta === undefined) return { error: 'Unknown word action' };
  if (source !== 'title' && source !== 'description') {
    return { error: 'Word source must be title or description' };
  }
  if (!Number.isInteger(wordPosition) || wordPosition < 0) {
    return { error: 'Word position must be a non-negative integer' };
  }
  const wordNormalized = normalizeTasteReaderWord(wordDisplay);
  if (!wordNormalized) return { error: 'That word has no letters or digits to score' };
  const row = {
    user_id: userId,
    content_id: Number(contentId),
    run_id: typeof runId === 'string' && runId ? runId : null,
    word_display: String(wordDisplay),
    word_normalized: wordNormalized,
    source,
    word_position: wordPosition,
    action,
    score_delta: delta
  };
  const res = await fetch(supabaseUrl(env, 'taste_reader_word_scores', new URLSearchParams({ select: 'id' })), {
    method: 'POST',
    headers: { ...supabaseHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify(row)
  });
  if (!res.ok) throw new Error(`Word score insert failed (HTTP ${res.status})`);
  // next / ignore / ban move past a balloon: its run item is skipped.
  // Status is secondary — a failed status update never fails the score.
  if (row.run_id && ['next', 'ignore', 'ban'].includes(action)) {
    try {
      const params = new URLSearchParams({
        run_id: `eq.${row.run_id}`,
        content_id: `eq.${row.content_id}`
      });
      await fetch(supabaseUrl(env, 'taste_reader_run_items', params), {
        method: 'PATCH',
        headers: { ...supabaseHeaders(env), Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'skipped' })
      });
    } catch { /* score already saved; status can be fixed in step 4 */ }
  }
  return { ok: true, scoreDelta: delta, wordNormalized };
}

export async function saveTasteReaderNote(env, {
  userId, contentId, runId = null, kind = 'user_note', body,
  actionContext = null, stoppedWordNormalized = null, stoppedPosition = null, aiModel = null
} = {}) {
  if (!userId || !Number.isFinite(Number(contentId))) {
    return { error: 'A content balloon and a signed-in admin are required' };
  }
  if (!TASTE_READER_NOTE_KINDS.has(kind)) return { error: 'Unknown note kind' };
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) return { error: 'A note needs some text' };
  if (text.length > 2000) return { error: 'Note is too long (max 2000 characters)' };
  const row = {
    user_id: userId,
    content_id: Number(contentId),
    run_id: typeof runId === 'string' && runId ? runId : null,
    kind,
    body: text,
    action_context: TASTE_READER_NOTE_CONTEXTS.has(actionContext) ? actionContext : null,
    stopped_word_normalized: typeof stoppedWordNormalized === 'string' && stoppedWordNormalized ? stoppedWordNormalized : null,
    stopped_position: Number.isInteger(stoppedPosition) && stoppedPosition >= 0 ? stoppedPosition : null,
    ai_model: typeof aiModel === 'string' && aiModel ? aiModel : null
  };
  const res = await fetch(supabaseUrl(env, 'taste_reader_notes', new URLSearchParams({ select: 'id' })), {
    method: 'POST',
    headers: { ...supabaseHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify(row)
  });
  if (!res.ok) throw new Error(`Note insert failed (HTTP ${res.status})`);
  return { ok: true };
}

