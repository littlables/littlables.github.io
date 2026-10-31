import { getAdminLoginPage, getAdminPage } from './admin-page.mjs';
import { getNewsFeed, getNewsProviders } from './news-feeds.mjs';
import { getNewsProviderConfig, NEWS_CATEGORIES, buildInterleavedPairs } from './news-provider-config.mjs';
import {
  clearAdminSessionCookie,
  clearOAuthStateCookie,
  createAdminSessionCookie,
  createOAuthState,
  createOAuthStateCookie,
  getAdminIdentity,
  getOAuthState,
  isSameOrigin,
  getCorsHeaders
} from './github-auth.mjs';
import {
  claimNewsProviderSync,
  finishNewsProviderSync,
  updateProviderSyncStatus,
  getProviderProfile,
  resetNewsProviderSync,
  unstickAllProviderSyncs,
  approveNewsStory,
  createApprovedCustomNewsStory,
  banNewsStory,
  disapproveNewsStory,
  getNewsAdminSnapshot,
  getStoredNewsFeed,
  getStoredKeywordNewsFeed,
  undoNewsStoryDecision,
  updateNewsStory,
  setStoryDisplayCategories,
  setStoryInterestKeywords,
  getStoriesByKeyword,
  getStoriesByInterests,
  getSpaceFeedPreview,
  getPlayroomFeed,
  getPersistedKeywordEmbeddings,
  getKeywordVectorStatus,
  OVERRIDABLE_CATEGORIES,
  effectiveDisplayCategories,
  upsertNewsStories,
  upsertNewsStoriesBatch,
  searchNewsStories,
  getProviderCooldownState,
  setProviderCooldownState,
  clearProviderCooldownState,
  persistProviderCooldown,
  loadProviderCooldownsFromDbIfStale,
  enqueueProviderRetry,
  drainDueRetries,
  completeRetryJob,
  countQueuedRetries,
  getAutoSyncState,
  setAutoSyncState,
  recordNewsProviderFetchLog,
  flushProviderFetchLogs,
  getNewsProviderFetchLogs,
  clearNewsProviderFetchLogs,
  pruneOldProviderLogs,
  getNewsProviderFetchLogsFromDb,
  DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS,
  getAiCurationState,
  createTasteReaderRun,
  verifyTasteReaderAdmin,
  recordTasteReaderWordScore,
  saveTasteReaderNote,
  extractAiText,
  updateAiCurationConfig,
  runAiStoryCuration,
  bulkDecideNewsStories,
  recordEngagementEvent,
  recordBoardEvent,
  recordSearchQuery,
  isInternalRequest,
  getAnalyticsStats,
  recordAdEvent,
  STORIES_TABLE,
  supabaseHeaders,
  supabaseUrl
} from './news-storage.mjs';
import { getAds, getAdById, updateAd, createAd } from './ads-data.mjs';
import { syncAwin, getAwinAds } from './awin-sync.mjs';
import { validateStoryCategories, classifyStoryKeywords, embedText, getKeywordEmbeddings, cosineSimilarity } from './embedding-classifier.mjs';
import { getInterestKeyword, INTEREST_KEYWORDS, normalizeInterestKeywords, deriveStoryRegion } from './interest-keywords.mjs';
import { getNextSyncBatch, PAIRS_PER_RUN } from './staggered-sync.mjs';
import { computeAdaptiveDelayMs } from './feed-utils.mjs';
import { startSyncRun, updateSyncRun, finishSyncRun, isSyncRunHeartbeatDue, summarizeProviderProgress, SYNC_RUN_HEARTBEAT_MIN_MS } from './provider-sync-runs.mjs';
import { stageHalloweenBatch } from './halloween-batch.mjs';
import { matchAdsToStory, rankAdsByEmbeddingSimilarity } from './ad-keyword-matcher.mjs';
import { createAiUsageCounter, AI_USAGE_MODEL_LLAMA, AI_USAGE_MODEL_FLUX, AI_USAGE_MODEL_SDXL, AI_USAGE_MODEL_BGE } from './ai-usage-log.mjs';

const MAX_REQUEST_BYTES = 64_000;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_PAGE_TEXT = 16_000;
const MAX_REDIRECTS = 4;
const MODEL = '@cf/meta/llama-3.2-3b-instruct';
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const FALLBACK_IMAGE_MODEL = '@cf/bytedance/stable-diffusion-xl-lightning';
const MAX_IMAGE_CACHE_ENTRIES = 30;
const ADMIN_MARKET = 'en-US';
const NEWS_CATEGORY_SET = new Set(NEWS_CATEGORIES);
const imageMemoryCache = new Map();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function handleEngagementEvent(request, env) {
  try {
    // Never log internal traffic (admin testing, dev site) — it would skew audience stats.
    if (isInternalRequest(request)) return jsonResponse({ ok: true, reason: 'internal-skipped' }, 200);
    const body = await request.json();
    const result = await recordEngagementEvent(env, {
      url: body.url,
      title: body.title,
      category: body.category,
      eventType: body.eventType,
      sessionId: body.sessionId,
      keywords: body.keywords,
      referrer_domain: body.referrer_domain,
      utm_source: body.utm_source,
      utm_medium: body.utm_medium,
      utm_campaign: body.utm_campaign,
      // Country from Cloudflare IP geolocation (free, no permission needed).
      country_code: request.cf?.country || null,
      dwell_seconds: body.dwell_seconds,
    });
    return jsonResponse(result, 200);
  } catch (err) {
    return jsonResponse({ ok: false, reason: 'bad-request' }, 400);
  }
}

async function handleBoardEvent(request, env) {
  try {
    if (isInternalRequest(request)) return jsonResponse({ ok: true, reason: 'internal-skipped' }, 200);
    const body = await request.json();
    const result = await recordBoardEvent(env, {
      sessionId: body.sessionId,
      keywordIds: body.keywordIds,
      categoryIds: body.categoryIds,
      country_code: request.cf?.country || null,
    });
    return jsonResponse(result, 200);
  } catch (err) {
    return jsonResponse({ ok: false, reason: 'bad-request' }, 400);
  }
}

async function handleAdEvent(request, env) {
  try {
    if (isInternalRequest(request)) return jsonResponse({ ok: true, reason: 'internal-skipped' }, 200);
    const body = await request.json();
    const result = await recordAdEvent(env, {
      adId: body.adId,
      adTitle: body.adTitle,
      network: body.network,
      category: body.category,
      storyUrlHash: body.storyUrlHash,
      eventType: body.eventType,
      sessionId: body.sessionId,
      country_code: request.cf?.country || null,
    });
    return jsonResponse(result, 200);
  } catch (err) {
    return jsonResponse({ ok: false, reason: 'bad-request' }, 400);
  }
}

async function serveNewsFeed(request, env, ctx) {
  const url = new URL(request.url);
  try {
    const limit = await env.SUMMARY_RATE_LIMITER.limit({
      key: request.headers.get('CF-Connecting-IP') || 'unknown'
    });
    if (!limit.success) return jsonResponse({ error: 'News feed request rate limit exceeded' }, 429);

    const rawCategory = (
      url.searchParams.get('interest') ||
      url.searchParams.get('category') ||
      url.searchParams.get('topic') ||
      url.searchParams.get('q') ||
      'all'
    ).trim();
    const normalizedCategory = rawCategory.toLowerCase();

    // Interest keyword feed (for custom spaces). Keywords never appear as
    // categories; this is the dedicated read path for them.
    const keywordParam = (url.searchParams.get('keyword') || '').trim();
    if (keywordParam) {
      const kw = getInterestKeyword(keywordParam);
      if (!kw) return jsonResponse({ error: 'Unknown interest keyword' }, 400);
      const feed = await getStoriesByKeyword(env, kw.id);
      return jsonResponse({ ...feed, keyword: kw.id });
    }

    if (NEWS_CATEGORY_SET.has(normalizedCategory)) {
      const feed = await getStoredNewsFeed(env, normalizedCategory);
      return jsonResponse(feed);
    }

    const feed = await getStoredKeywordNewsFeed(env, rawCategory);
    const ads = getAds({ query: rawCategory });
    // Log the search query (fire-and-forget — never blocks the response).
    // Skipped for internal traffic (admin panel, dev site).
    const storyCount = Array.isArray(feed?.stories) ? feed.stories.length : 0;
    if (ctx?.waitUntil && !isInternalRequest(request)) {
      ctx.waitUntil(recordSearchQuery(env, {
        query: rawCategory,
        resultCount: storyCount,
        country_code: request.cf?.country || null,
      }));
    }
    return jsonResponse({
      ...feed,
      topic: rawCategory,
      ads
    });
  } catch (err) {
    console.error('News feed request failed:', err);
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 502;
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unable to load news feed' }, status);
  }
}

function computeCooldownWindow(err) {
  const now = Date.now();
  let cooldownSeconds = null;
  if (Number.isFinite(err?.retryAfterSeconds) && err.retryAfterSeconds > 0) {
    cooldownSeconds = Math.ceil(err.retryAfterSeconds);
  } else if (err?.rateLimitReset) {
    const resetMs = Date.parse(err.rateLimitReset);
    if (Number.isFinite(resetMs) && resetMs > now) {
      cooldownSeconds = Math.ceil((resetMs - now) / 1000);
    }
  }
  if (!Number.isFinite(cooldownSeconds) || cooldownSeconds <= 0) {
    cooldownSeconds = DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS;
  }
  const boundedSeconds = Math.min(Math.max(cooldownSeconds, 30), 24 * 3600);
  const cooldownUntil = new Date(now + boundedSeconds * 1000).toISOString();
  return {
    cooldownSeconds: boundedSeconds,
    cooldownUntil,
    rateLimitResetAt: err?.rateLimitReset || cooldownUntil
  };
}


async function executeProviderSync(provider, updatedBy, env, {
  triggerSource = 'manual',
  force = false
} = {}) {
  const config = getNewsProviderConfig(provider);
  if (!config) return { httpStatus: 404, body: { error: 'Unknown news provider' } };
  if (config.credential && !env[config.credential]) {
    return {
      httpStatus: 503,
      body: {
        error: `${config.label} is not configured. Set the ${config.credential} Worker secret.`
      }
    };
  }

  // Phase 1: persisted cooldowns were previously never reloaded (the loader
  // had no callers), so a cold-started worker re-hammered cooling providers.
  await loadProviderCooldownsFromDbIfStale(env);

  const activeCooldown = !force ? getProviderCooldownState(provider) : null;
  if (activeCooldown) {
    const remainingSec = Math.max(1, Math.ceil((Date.parse(activeCooldown.cooldownUntil) - Date.now()) / 1000));
    const cooldownMsg = `${config.label} is in rate-limit cooldown for ${remainingSec}s (until ${activeCooldown.cooldownUntil})`;
    await recordNewsProviderFetchLog(env, {
      provider,
      providerLabel: config.label,
      category: 'all',
      triggerSource,
      status: 'skipped_cooldown',
      httpStatus: 429,
      durationMs: 0,
      attemptCount: 0,
      itemsFetched: 0,
      storiesSaved: 0,
      retryAfterSeconds: remainingSec,
      rateLimitRemaining: activeCooldown.rateLimitRemaining,
      rateLimitReset: activeCooldown.rateLimitResetAt,
      requestUrl: config.endpoint || '',
      failoverProvider: activeCooldown.failoverProvider,
      errorMessage: cooldownMsg
    });
    return {
      httpStatus: 200,
      body: {
        provider,
        status: 'rate_limited',
        storiesSaved: 0,
        cooldownUntil: activeCooldown.cooldownUntil,
        failoverProvider: activeCooldown.failoverProvider || null,
        errors: [cooldownMsg]
      }
    };
  }

  const claimed = await claimNewsProviderSync(env, provider, updatedBy);
  if (!claimed) {
    return { httpStatus: 409, body: { error: `${provider} is already being updated` } };
  }

  let storiesSaved = 0;
  let cooldownUntil = null;
  let hitRateLimit = false;
  const errors = [];
  const categories = Object.keys(config.categories);
  // Phase 1 batching: accumulate stories + log entries, flush once per provider.
  const pendingStories = [];
  const pendingLogs = [];
  // Pacing state from the provider's own rate-limit headers, observed live.
  let lastRemaining = null;
  let lastResetAt = null;
  let fetchedCount = 0;

  // Queue a provider's remaining categories for same-provider retry.
  const deferRemaining = async (remainingCategories, notBefore, message) => {
    let queuedCount = 0;
    for (const rc of remainingCategories) {
      const ok = await enqueueProviderRetry(env, provider, rc, {
        notBefore,
        error: message
      });
      if (ok) queuedCount++;
    }
    return queuedCount;
  };

  const runId = await startSyncRun(env, { trigger: triggerSource, provider, pairsTotal: categories.length });
  let runLastHeartbeatMs = 0;
  let runLastHeartbeatProvider = null;
  let runLastPairTelemetry = null;

  try {
    for (const [index, category] of categories.entries()) {
      if (runId && isSyncRunHeartbeatDue({ lastHeartbeatMs: runLastHeartbeatMs, lastProvider: runLastHeartbeatProvider, provider })) {
        await updateSyncRun(env, runId, {
          pairs_done: index,
          current_provider: provider,
          current_category: category,
          last_telemetry: runLastPairTelemetry,
          summary: {
            inProgress: true,
            providers: [summarizeProviderProgress(provider, index, pendingLogs)]
          }
        });
        runLastHeartbeatMs = Date.now();
        runLastHeartbeatProvider = provider;
      }
      // Adaptive pacing (Phase 1): fixed pauses ignore what the provider
      // actually reports. Slow down as quota drains, wait out short resets,
      // and defer the provider's remaining pairs when the reset is distant
      // instead of stalling the whole sequential sweep.
      if (fetchedCount > 0) {
        const pacing = computeAdaptiveDelayMs({
          basePauseMs: config.updatePauseMs,
          remaining: lastRemaining,
          resetAt: lastResetAt
        });
        if (pacing.deferUntil) {
          const remainingCategories = categories.slice(index);
          const queuedCount = await deferRemaining(remainingCategories, pacing.deferUntil, `${provider} pacing deferral until ${pacing.deferUntil}`);
          setProviderCooldownState(provider, {
            cooldownUntil: pacing.deferUntil,
            rateLimitResetAt: pacing.deferUntil,
            retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(pacing.deferUntil) - Date.now()) / 1000)),
            lastError: 'Deferred by adaptive pacing: rate-limit exhausted',
            failoverProvider: null,
            failoverCategories: []
          });
          persistProviderCooldown(env, provider, {
            cooldownUntil: pacing.deferUntil,
            rateLimitResetAt: pacing.deferUntil,
            lastError: 'Deferred by adaptive pacing: rate-limit exhausted'
          }).catch(() => {});
          cooldownUntil = pacing.deferUntil;
          hitRateLimit = true;
          pendingLogs.push({
            provider,
            providerLabel: config.label,
            category,
            triggerSource,
            status: 'skipped_pacing',
            httpStatus: 429,
            durationMs: 0,
            attemptCount: 0,
            itemsFetched: 0,
            storiesSaved: 0,
            retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(pacing.deferUntil) - Date.now()) / 1000)),
            rateLimitRemaining: lastRemaining,
            rateLimitReset: pacing.deferUntil,
            requestUrl: config.endpoint || '',
            failoverProvider: null,
            errorMessage: `Deferred by adaptive pacing: rate-limit exhausted, ${queuedCount} remaining categor${queuedCount === 1 ? 'y' : 'ies'} queued for retry after ${pacing.deferUntil}`
          });
          if (queuedCount > 0) {
            errors.push(`deferred ${queuedCount} remaining categor${queuedCount === 1 ? 'y' : 'ies'} by adaptive pacing until ${pacing.deferUntil}`);
          }
          break;
        }
        if (pacing.delayMs > 0) await new Promise(resolve => setTimeout(resolve, pacing.delayMs));
      }
      let lastTelemetry = null;
      try {
        const feed = await getNewsFeed(provider, category, ADMIN_MARKET, {
          credentials: env,
          cache: false,
          onFetchTelemetry: (t) => { lastTelemetry = t; }
        });
        fetchedCount++;
        lastRemaining = lastTelemetry?.rateLimitRemaining ?? null;
        lastResetAt = lastTelemetry?.rateLimitReset ?? null;
        const stories = feed.items.slice(0, 10);
        // Dedup within the category here so the batch upsert and the log
        // entry agree on saved/duplicates counts.
        const seenUrls = new Set();
        const uniqueStories = [];
        let duplicatesSkipped = 0;
        for (const story of stories) {
          if (!story?.link || seenUrls.has(story.link)) {
            duplicatesSkipped++;
            continue;
          }
          seenUrls.add(story.link);
          uniqueStories.push(story);
        }
        pendingStories.push({ category, stories: uniqueStories });
        pendingLogs.push({
          provider,
          providerLabel: config.label,
          category,
          triggerSource,
          status: 'succeeded',
          httpStatus: lastTelemetry?.httpStatus ?? 200,
          durationMs: lastTelemetry?.durationMs ?? 0,
          attemptCount: lastTelemetry?.attemptCount ?? 1,
          itemsFetched: feed.items.length,
          storiesSaved: uniqueStories.length,
          duplicatesSkipped,
          retryAfterSeconds: lastTelemetry?.retryAfterSeconds ?? null,
          rateLimitRemaining: lastTelemetry?.rateLimitRemaining ?? null,
          rateLimitReset: lastTelemetry?.rateLimitReset ?? null,
          requestUrl: lastTelemetry?.requestUrl || config.endpoint || '',
          errorMessage: null
        });
      } catch (err) {
        const isRateLimit = Boolean(err?.isRateLimit || err?.status === 429);
        const rawErrMsg = err instanceof Error ? err.message : 'Unknown provider error';
        const message = `${category}: ${rawErrMsg}`;
        console.error(`News provider update failed for ${provider}/${category}:`, err);
        errors.push(message);

        if (isRateLimit) {
          hitRateLimit = true;
          const windowInfo = computeCooldownWindow(err);
          cooldownUntil = windowInfo.cooldownUntil;
          const remainingCategories = categories.slice(index);

          // No cross-provider failover: queue the remaining categories for this
          // same provider to retry after the cooldown expires.
          const queuedCount = await deferRemaining(remainingCategories, cooldownUntil, message);

          setProviderCooldownState(provider, {
            cooldownUntil,
            rateLimitResetAt: windowInfo.rateLimitResetAt,
            retryAfterSeconds: windowInfo.cooldownSeconds,
            rateLimitRemaining: err?.rateLimitRemaining ?? lastTelemetry?.rateLimitRemaining ?? '0',
            lastError: message,
            failoverProvider: null,
            failoverCategories: []
          });
          // Persist to DB so cooldown survives worker restarts (fire-and-forget)
          persistProviderCooldown(env, provider, {
            cooldownUntil,
            rateLimitResetAt: windowInfo.rateLimitResetAt,
            lastError: message
          }).catch(() => {});

          pendingLogs.push({
            provider,
            providerLabel: config.label,
            category,
            triggerSource,
            status: 'rate_limited',
            httpStatus: err?.status ?? lastTelemetry?.httpStatus ?? 429,
            durationMs: err?.durationMs ?? lastTelemetry?.durationMs ?? 0,
            attemptCount: err?.attemptCount ?? lastTelemetry?.attemptCount ?? 1,
            itemsFetched: 0,
            storiesSaved: 0,
            retryAfterSeconds: windowInfo.cooldownSeconds,
            rateLimitRemaining: err?.rateLimitRemaining ?? lastTelemetry?.rateLimitRemaining ?? '0',
            rateLimitReset: windowInfo.rateLimitResetAt,
            requestUrl: err?.requestUrl || lastTelemetry?.requestUrl || config.endpoint || '',
            failoverProvider: null,
            errorMessage: `${message} · queued ${queuedCount} remaining categor${queuedCount === 1 ? 'y' : 'ies'} for retry after cooldown`
          });

          if (queuedCount > 0) {
            errors.push(`queued ${queuedCount} remaining categor${queuedCount === 1 ? 'y' : 'ies'} for retry after cooldown (${cooldownUntil})`);
          }
          // Stop querying remaining categories on the rate-limited provider immediately
          break;
        } else {
          pendingLogs.push({
            provider,
            providerLabel: config.label,
            category,
            triggerSource,
            status: 'failed',
            httpStatus: err?.status ?? lastTelemetry?.httpStatus ?? null,
            durationMs: err?.durationMs ?? lastTelemetry?.durationMs ?? 0,
            attemptCount: err?.attemptCount ?? lastTelemetry?.attemptCount ?? 1,
            itemsFetched: 0,
            storiesSaved: 0,
            retryAfterSeconds: err?.retryAfterSeconds ?? null,
            rateLimitRemaining: err?.rateLimitRemaining ?? null,
            rateLimitReset: err?.rateLimitReset ?? null,
            requestUrl: err?.requestUrl || lastTelemetry?.requestUrl || config.endpoint || '',
            errorMessage: message
          });
          // Phase 1: transient non-429 failures (5xx / timeouts) get queued
          // with a short backoff instead of vanishing until next hour.
          // Content failures (invalid response, no usable stories) are not
          // queued: re-fetching them would just fail the same way.
          const isTransient = [500, 502, 503, 504].includes(err?.status) || /timed out/i.test(rawErrMsg);
          if (isTransient) {
            await enqueueProviderRetry(env, provider, category, {
              notBefore: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
              error: message
            });
          }
        }
      }
      runLastPairTelemetry = lastTelemetry ? {
        httpStatus: lastTelemetry.httpStatus ?? null,
        durationMs: lastTelemetry.durationMs ?? null,
        rateLimitRemaining: lastTelemetry.rateLimitRemaining ?? null,
        rateLimitReset: lastTelemetry.rateLimitReset ?? null
      } : null;
    }

    // Flush batched writes (Phase 1): one upsert POST for the provider,
    // falling back to per-category posts on failure, then one log POST.
    // This runs after both the clean path and the 429-break path, so stories
    // fetched before a rate limit are still saved.
    if (pendingStories.length) {
      const savedByCategory = {};
      const failedSaveCategories = new Set();
      try {
        const batchResult = await upsertNewsStoriesBatch(env, provider, pendingStories);
        for (const { category: cat, stories: catStories } of pendingStories) {
          savedByCategory[cat] = catStories.length;
        }
        storiesSaved += batchResult?.savedCount ?? 0;
      } catch (batchErr) {
        console.error(`Batch upsert failed for ${provider}, falling back to per-category posts:`, batchErr);
        for (const { category: cat, stories: catStories } of pendingStories) {
          try {
            const r = await upsertNewsStories(env, provider, cat, catStories);
            savedByCategory[cat] = r?.savedCount ?? 0;
            storiesSaved += r?.savedCount ?? 0;
          } catch (singleErr) {
            failedSaveCategories.add(cat);
            errors.push(`${cat}: ${singleErr instanceof Error ? singleErr.message : String(singleErr)}`);
          }
        }
      }
      // Keep log entries honest about what actually saved.
      for (const logEntry of pendingLogs) {
        if (logEntry.status === 'succeeded') {
          if (failedSaveCategories.has(logEntry.category) || !Object.hasOwn(savedByCategory, logEntry.category)) {
            logEntry.status = 'failed';
            logEntry.storiesSaved = 0;
            logEntry.errorMessage = `${logEntry.category}: story save failed`;
          } else {
            logEntry.storiesSaved = savedByCategory[logEntry.category];
          }
        }
      }
    }
    await flushProviderFetchLogs(env, pendingLogs);

    if (!hitRateLimit && errors.length === 0) {
      clearProviderCooldownState(provider);
    }

    const status = errors.length === 0
      ? 'succeeded'
      : storiesSaved > 0
        ? 'partial'
        : 'failed';
    const errorMessage = errors.length ? errors.join('; ').slice(0, 2000) : null;
    await finishNewsProviderSync(env, provider, { status, storiesSaved, error: errorMessage });
    if (runId) await finishSyncRun(env, runId, { status, pairsDone: categories.length, summary: { storiesSaved, errors, providers: [{ provider, status, storiesSaved }] } });

    return {
      httpStatus: 200,
      body: {
        provider,
        status,
        storiesSaved,
        errors,
        ...(hitRateLimit ? {
          rateLimited: true,
          cooldownUntil
        } : {})
      }
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown provider update error';
    try {
      await finishNewsProviderSync(env, provider, { status: 'failed', storiesSaved, error: message });
    } catch (saveError) {
      console.error(`Could not save failed status for ${provider}:`, saveError);
    }
    if (runId) await finishSyncRun(env, runId, { status: 'failed', pairsDone: categories.length, summary: { storiesSaved, errors: [message], providers: [{ provider, status: 'failed', storiesSaved }] } });
    throw err;
  }
}

async function updateNewsProvider(provider, updatedBy, env, options = {}) {
  const result = await executeProviderSync(provider, updatedBy, env, options);
  return jsonResponse(result.body, result.httpStatus);
}

/**
 * Staggered topic sync: processes the next batch of (provider, category) pairs
 * from the rotation queue. Designed to run every 10 minutes via cron,
 * spreading the 42 fetches evenly across the hour instead of bursting.
 */
/**
 * Drain due provider retry jobs: re-run the same provider/category fetch
 * after its cooldown expired. Bounded to stay under the subrequest budget.
 */
async function drainProviderRetries(env, { limit = 10, triggerSource = 'cron:retry' } = {}) {
  const jobs = await drainDueRetries(env, { limit });
  if (!jobs.length) return { drained: 0, succeeded: 0, requeued: 0, failed: 0 };
  let succeeded = 0, requeued = 0, failed = 0;
  for (const job of jobs) {
    const config = getNewsProviderConfig(job.provider);
    if (!config) {
      await completeRetryJob(env, job.id, { success: false, error: 'Unknown provider' });
      failed++;
      continue;
    }
    // Respect an active cooldown (may have been re-set since the job was queued)
    if (getProviderCooldownState(job.provider)) {
      await completeRetryJob(env, job.id, {
        success: false,
        notBefore: getProviderCooldownState(job.provider).cooldownUntil,
        error: 'Still in cooldown, re-queued'
      });
      requeued++;
      continue;
    }
    try {
      const feed = await getNewsFeed(job.provider, job.category, ADMIN_MARKET, {
        credentials: env,
        cache: false,
        onFetchTelemetry: () => {}
      });
      const stories = feed.items.slice(0, 10);
      const upsertResult = await upsertNewsStories(env, job.provider, job.category, stories);
      await recordNewsProviderFetchLog(env, {
        provider: job.provider,
        providerLabel: config.label,
        category: job.category,
        triggerSource,
        status: 'succeeded',
        httpStatus: 200,
        durationMs: 0,
        attemptCount: job.attempts + 1,
        itemsFetched: feed.items.length,
        storiesSaved: upsertResult?.savedCount ?? 0,
        duplicatesSkipped: upsertResult?.duplicatesSkipped ?? 0,
        errorMessage: null
      });
      // The drain used to leave the provider row untouched, so a drained
      // success showed nowhere except the logs. Update the status fields
      // (never started_at — updateProviderSyncStatus preserves a live
      // sweep's claim) so the cards and profile pages reflect it.
      await updateProviderSyncStatus(env, job.provider, {
        status: 'succeeded',
        storiesSaved: upsertResult?.savedCount ?? 0
      });
      await completeRetryJob(env, job.id, { success: true });
      succeeded++;
    } catch (err) {
      const isRateLimit = Boolean(err?.isRateLimit || err?.status === 429);
      const windowInfo = isRateLimit ? computeCooldownWindow(err) : null;
      const result = await completeRetryJob(env, job.id, {
        success: false,
        notBefore: windowInfo?.cooldownUntil || undefined,
        error: err instanceof Error ? err.message : String(err)
      });
      if (isRateLimit) {
        // Refresh the provider cooldown so the normal sync also backs off
        setProviderCooldownState(job.provider, {
          cooldownUntil: windowInfo.cooldownUntil,
          rateLimitResetAt: windowInfo.rateLimitResetAt,
          retryAfterSeconds: windowInfo.cooldownSeconds,
          lastError: err instanceof Error ? err.message : String(err),
          failoverProvider: null,
          failoverCategories: []
        });
        persistProviderCooldown(env, job.provider, {
          cooldownUntil: windowInfo.cooldownUntil,
          rateLimitResetAt: windowInfo.rateLimitResetAt,
          lastError: err instanceof Error ? err.message : String(err)
        }).catch(() => {});
      }
      if (result === 'requeued') requeued++;
      else failed++;
    }
  }
  return { drained: jobs.length, succeeded, requeued, failed };
}

async function runStaggeredSync(env, triggerSource = 'cron', updatedBy = 'staggered-scheduler') {
  const providers = getNewsProviders(env).filter(p => p.configured);
  if (providers.length === 0) {
    return { skipped: true, reason: 'No providers configured', pairsSynced: 0 };
  }

  const batch = getNextSyncBatch(providers, PAIRS_PER_RUN);
  const results = [];
  let totalStoriesSaved = 0;

  for (const { provider, category } of batch) {
    const config = getNewsProviderConfig(provider);
    if (!config) continue;
    // Small pause between fetches to avoid hammering APIs
    if (results.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    try {
      const feed = await getNewsFeed(provider, category, ADMIN_MARKET, {
        credentials: env,
        cache: false,
      });
      const stories = feed.items.slice(0, 10);
      const upsertResult = await upsertNewsStories(env, provider, category, stories);
      const savedCount = upsertResult?.savedCount ?? 0;
      totalStoriesSaved += savedCount;
      await recordNewsProviderFetchLog(env, {
        provider,
        providerLabel: config.label,
        category,
        triggerSource: triggerSource + ':staggered',
        status: 'succeeded',
        httpStatus: 200,
        durationMs: 0,
        attemptCount: 1,
        itemsFetched: feed.items.length,
        storiesSaved: savedCount,
        duplicatesSkipped: upsertResult?.duplicatesSkipped ?? 0,
        errorMessage: null,
      });
      results.push({ provider, category, status: 'succeeded', storiesSaved: savedCount });
    } catch (err) {
      console.error(`Staggered sync failed for ${provider}/${category}:`, err);
      results.push({
        provider,
        category,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    pairsSynced: results.length,
    totalStoriesSaved,
    results,
    triggerSource,
  };
}

async function runHourlyAutoSync(env, triggerSource = 'cron', updatedBy = 'hourly-scheduler', { force = false } = {}) {
  const currentAuto = getAutoSyncState();
  if (!force && !currentAuto.enabled) {
    return {
      skipped: true,
      reason: 'Auto-sync is currently paused by administrator',
      autoSync: currentAuto
    };
  }

  // Live run tracking: one row for the whole sweep, heartbeated as pairs
  // complete, so a stuck sweep shows exactly where it died.
  const runId = await startSyncRun(env, { trigger: triggerSource, provider: null });

  await loadProviderCooldownsFromDbIfStale(env);

  const providers = getNewsProviders(env).filter(p => p.configured);
  const results = [];
  let totalStoriesSaved = 0;
  let rateLimitedCount = 0;

  // Concurrent chains: one async chain per provider, each iterating its
  // own categories sequentially with its own pacing. A stalled provider
  // stalls only its own chain; the others finish, flush, and report.
  // (Previously a single category-major interleaved loop, where one hang
  // blocked every provider behind it.) Bulk sync always respects
  // cooldowns (the old code hardcoded force: false here even for admin
  // sync-all); only the single-provider manual path accepts force.
  const pairs = buildInterleavedPairs(providers.map(p => p.id));
  if (runId) await updateSyncRun(env, runId, { pairs_total: pairs.length });
  const runProgress = { pairsDone: 0, lastHeartbeatMs: 0, lastPairTelemetry: null };
  const providerState = new Map();
  const getState = (providerId) => {
    if (!providerState.has(providerId)) {
      providerState.set(providerId, {
        claimed: false,
        done: false,
        attempted: new Set(),
        fetchedCount: 0,
        lastRemaining: null,
        lastResetAt: null,
        pendingStories: [],
        pendingLogs: [],
        storiesSaved: 0,
        errors: [],
        rateLimited: false,
        finished: false
      });
    }
    return providerState.get(providerId);
  };
  // Categories not yet attempted for this provider, including the current
  // one (attempted is only marked after a pair finishes, so a 429 or a
  // pacing deferral re-queues the pair that triggered it, matching the old
  // categories.slice(index) behavior).
  const remainingCategoriesFor = (providerId, st) => {
    const config = getNewsProviderConfig(providerId);
    return Object.keys(config?.categories || {}).filter(c => !st.attempted.has(c));
  };
  const deferProviderPairs = async (providerId, st, notBefore, message) => {
    let queuedCount = 0;
    for (const rc of remainingCategoriesFor(providerId, st)) {
      const ok = await enqueueProviderRetry(env, providerId, rc, { notBefore, error: message });
      if (ok) queuedCount++;
    }
    return queuedCount;
  };

  // Throttled run heartbeat: the first call fires immediately, then at
  // most one PATCH per 30 seconds no matter how many chains are running.
  const maybeHeartbeat = async (providerId, category) => {
    if (!runId) return;
    const nowMs = Date.now();
    if (runProgress.lastHeartbeatMs !== 0 && nowMs - runProgress.lastHeartbeatMs < SYNC_RUN_HEARTBEAT_MIN_MS) return;
    await updateSyncRun(env, runId, {
      pairs_done: runProgress.pairsDone,
      current_provider: providerId,
      current_category: category,
      last_telemetry: runProgress.lastPairTelemetry,
      summary: {
        inProgress: true,
        providers: providers.map(p => {
          const pst = getState(p.id);
          return summarizeProviderProgress(p.id, pst.attempted.size, pst.pendingLogs);
        })
      }
    });
    runProgress.lastHeartbeatMs = Date.now();
  };

  // Safety net (see the final pass below): if anything escapes a chain,
  // claimed providers must still reach the flush + final pass instead
  // of dying mid-sweep with their lock rows stuck on 'running'.
  let sweepError = null;
  const runProviderChain = async (providerId) => {
    const config = getNewsProviderConfig(providerId);
    const st = getState(providerId);
  for (const category of Object.keys(config?.categories || {})) {
    if (st.done) break;

    // Skip providers in an active cooldown (state was refreshed from the
    // DB at the start of this run). Only one log entry per provider: the
    // first pair marks it done, the rest skip silently.
    const activeCooldown = getProviderCooldownState(providerId);
    if (activeCooldown) {
      st.done = true;
      st.rateLimited = true;
      const remainingSec = Math.max(1, Math.ceil((Date.parse(activeCooldown.cooldownUntil) - Date.now()) / 1000));
      const cooldownMsg = `${config.label} is in rate-limit cooldown for ${remainingSec}s (until ${activeCooldown.cooldownUntil})`;
      st.errors.push(cooldownMsg);
      st.pendingLogs.push({
        provider: providerId,
        providerLabel: config.label,
        category,
        triggerSource,
        status: 'skipped_cooldown',
        httpStatus: 429,
        durationMs: 0,
        attemptCount: 0,
        itemsFetched: 0,
        storiesSaved: 0,
        retryAfterSeconds: remainingSec,
        rateLimitRemaining: activeCooldown.rateLimitRemaining,
        rateLimitReset: activeCooldown.rateLimitResetAt,
        requestUrl: config.endpoint || '',
        failoverProvider: activeCooldown.failoverProvider,
        errorMessage: cooldownMsg
      });
      continue;
    }

    // Lazy per-provider claim: a provider that never fetches is never
    // locked, and a collision skips just that provider (old 409 shape).
    if (!st.claimed) {
      let claimed = false;
      try {
        claimed = await claimNewsProviderSync(env, providerId, updatedBy);
      } catch (claimErr) {
        console.error(`Auto-sync claim failed for provider ${providerId}:`, claimErr);
        st.done = true;
        st.errors.push(`${providerId}: ${claimErr instanceof Error ? claimErr.message : String(claimErr)}`);
        continue;
      }
      if (!claimed) {
        st.done = true;
        st.errors.push(`${providerId} is already being updated`);
        continue;
      }
      st.claimed = true;
    }

    // Adaptive pacing from the provider's own observed headers.
    if (st.fetchedCount > 0) {
      const pacing = computeAdaptiveDelayMs({
        basePauseMs: config.updatePauseMs,
        remaining: st.lastRemaining,
        resetAt: st.lastResetAt
      });
      if (pacing.deferUntil) {
        const message = `${providerId} pacing deferral until ${pacing.deferUntil}`;
        const queuedCount = await deferProviderPairs(providerId, st, pacing.deferUntil, message);
        setProviderCooldownState(providerId, {
          cooldownUntil: pacing.deferUntil,
          rateLimitResetAt: pacing.deferUntil,
          retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(pacing.deferUntil) - Date.now()) / 1000)),
          lastError: 'Deferred by adaptive pacing: rate-limit exhausted',
          failoverProvider: null,
          failoverCategories: []
        });
        persistProviderCooldown(env, providerId, {
          cooldownUntil: pacing.deferUntil,
          rateLimitResetAt: pacing.deferUntil,
          lastError: 'Deferred by adaptive pacing: rate-limit exhausted'
        }).catch(() => {});
        st.done = true;
        st.rateLimited = true;
        st.errors.push(`deferred ${queuedCount} remaining categor${queuedCount === 1 ? 'y' : 'ies'} by adaptive pacing until ${pacing.deferUntil}`);
        st.pendingLogs.push({
          provider: providerId,
          providerLabel: config.label,
          category,
          triggerSource,
          status: 'skipped_pacing',
          httpStatus: 429,
          durationMs: 0,
          attemptCount: 0,
          itemsFetched: 0,
          storiesSaved: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(pacing.deferUntil) - Date.now()) / 1000)),
          rateLimitRemaining: st.lastRemaining,
          rateLimitReset: pacing.deferUntil,
          requestUrl: config.endpoint || '',
          failoverProvider: null,
          errorMessage: st.errors[st.errors.length - 1]
        });
        continue;
      }
      if (pacing.delayMs > 0) await new Promise(resolve => setTimeout(resolve, pacing.delayMs));
    }

    // Report the current pair only once the chain is actually about to
    // fetch it: heartbeating earlier let cooldown-skipped or
    // claim-collided providers show as "Fetching:" without fetching.
    await maybeHeartbeat(providerId, category);
    let lastTelemetry = null;
    try {
      const feed = await getNewsFeed(providerId, category, ADMIN_MARKET, {
        credentials: env,
        cache: false,
        onFetchTelemetry: (t) => { lastTelemetry = t; }
      });
      st.fetchedCount++;
      st.lastRemaining = lastTelemetry?.rateLimitRemaining ?? null;
      st.lastResetAt = lastTelemetry?.rateLimitReset ?? null;
      const stories = feed.items.slice(0, 10);
      const seenUrls = new Set();
      const uniqueStories = [];
      let duplicatesSkipped = 0;
      for (const story of stories) {
        if (!story?.link || seenUrls.has(story.link)) {
          duplicatesSkipped++;
          continue;
        }
        seenUrls.add(story.link);
        uniqueStories.push(story);
      }
      st.pendingStories.push({ category, stories: uniqueStories });
      st.pendingLogs.push({
        provider: providerId,
        providerLabel: config.label,
        category,
        triggerSource,
        status: 'succeeded',
        httpStatus: lastTelemetry?.httpStatus ?? 200,
        durationMs: lastTelemetry?.durationMs ?? 0,
        attemptCount: lastTelemetry?.attemptCount ?? 1,
        itemsFetched: feed.items.length,
        storiesSaved: uniqueStories.length,
        duplicatesSkipped,
        retryAfterSeconds: lastTelemetry?.retryAfterSeconds ?? null,
        rateLimitRemaining: lastTelemetry?.rateLimitRemaining ?? null,
        rateLimitReset: lastTelemetry?.rateLimitReset ?? null,
        requestUrl: lastTelemetry?.requestUrl || config.endpoint || '',
        errorMessage: null
      });
    } catch (err) {
      const isRateLimit = Boolean(err?.isRateLimit || err?.status === 429);
      const rawErrMsg = err instanceof Error ? err.message : 'Unknown provider error';
      const message = `${category}: ${rawErrMsg}`;
      console.error(`News provider update failed for ${providerId}/${category}:`, err);
      st.errors.push(message);
      if (isRateLimit) {
        const windowInfo = computeCooldownWindow(err);
        const queuedCount = await deferProviderPairs(providerId, st, windowInfo.cooldownUntil, message);
        setProviderCooldownState(providerId, {
          cooldownUntil: windowInfo.cooldownUntil,
          rateLimitResetAt: windowInfo.rateLimitResetAt,
          retryAfterSeconds: windowInfo.cooldownSeconds,
          rateLimitRemaining: err?.rateLimitRemaining ?? lastTelemetry?.rateLimitRemaining ?? '0',
          lastError: message,
          failoverProvider: null,
          failoverCategories: []
        });
        persistProviderCooldown(env, providerId, {
          cooldownUntil: windowInfo.cooldownUntil,
          rateLimitResetAt: windowInfo.rateLimitResetAt,
          lastError: message
        }).catch(() => {});
        st.rateLimited = true;
        st.done = true;
        st.pendingLogs.push({
          provider: providerId,
          providerLabel: config.label,
          category,
          triggerSource,
          status: 'rate_limited',
          httpStatus: err?.status ?? lastTelemetry?.httpStatus ?? 429,
          durationMs: err?.durationMs ?? lastTelemetry?.durationMs ?? 0,
          attemptCount: err?.attemptCount ?? lastTelemetry?.attemptCount ?? 1,
          itemsFetched: 0,
          storiesSaved: 0,
          retryAfterSeconds: windowInfo.cooldownSeconds,
          rateLimitRemaining: err?.rateLimitRemaining ?? lastTelemetry?.rateLimitRemaining ?? '0',
          rateLimitReset: windowInfo.rateLimitResetAt,
          requestUrl: err?.requestUrl || lastTelemetry?.requestUrl || config.endpoint || '',
          failoverProvider: null,
          errorMessage: `${message} · queued ${queuedCount} remaining categor${queuedCount === 1 ? 'y' : 'ies'} for retry after cooldown`
        });
        if (queuedCount > 0) {
          st.errors.push(`queued ${queuedCount} remaining categor${queuedCount === 1 ? 'y' : 'ies'} for retry after cooldown (${windowInfo.cooldownUntil})`);
        }
      } else {
        st.pendingLogs.push({
          provider: providerId,
          providerLabel: config.label,
          category,
          triggerSource,
          status: 'failed',
          httpStatus: err?.status ?? lastTelemetry?.httpStatus ?? null,
          durationMs: err?.durationMs ?? lastTelemetry?.durationMs ?? 0,
          attemptCount: err?.attemptCount ?? lastTelemetry?.attemptCount ?? 1,
          itemsFetched: 0,
          storiesSaved: 0,
          retryAfterSeconds: err?.retryAfterSeconds ?? null,
          rateLimitRemaining: err?.rateLimitRemaining ?? null,
          rateLimitReset: err?.rateLimitReset ?? null,
          requestUrl: err?.requestUrl || lastTelemetry?.requestUrl || config.endpoint || '',
          errorMessage: message
        });
        const isTransient = [500, 502, 503, 504].includes(err?.status) || /timed out/i.test(rawErrMsg);
        if (isTransient) {
          await enqueueProviderRetry(env, providerId, category, {
            notBefore: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
            error: message
          });
        }
      }
    }
    st.attempted.add(category);
    runProgress.pairsDone++;
    runProgress.lastPairTelemetry = lastTelemetry ? {
      httpStatus: lastTelemetry.httpStatus ?? null,
      durationMs: lastTelemetry.durationMs ?? null,
      rateLimitRemaining: lastTelemetry.rateLimitRemaining ?? null,
      rateLimitReset: lastTelemetry.rateLimitReset ?? null
    } : null;
  }
  };
  const chainResults = await Promise.allSettled(providers.map(p => runProviderChain(p.id)));
  for (const [index, result] of chainResults.entries()) {
    if (result.status === 'rejected') {
      if (!sweepError) sweepError = result.reason;
      const failedProvider = providers[index];
      const fst = getState(failedProvider.id);
      fst.errors.push(`${failedProvider.id}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      console.error(`Auto-sync provider chain failed for ${failedProvider.id}:`, result.reason);
    }
  }

  // Flush per provider: one batch upsert (per-category fallback), one bulk
  // log insert, then the provider's final sync status.
  for (const provider of providers) {
    const st = getState(provider.id);
    if (!st.claimed) {
      // Never fetched (cooldown-skipped, lock collision, or claim failure):
      // surface it in results, but there is no sync row to finish.
      if (st.errors.some(e => e.includes('is already being updated'))) {
        results.push({
          provider: provider.id,
          httpStatus: 409,
          error: st.errors.find(e => e.includes('is already being updated'))
        });
      } else if (st.rateLimited) {
        results.push({
          provider: provider.id,
          httpStatus: 200,
          status: 'rate_limited',
          storiesSaved: 0,
          errors: st.errors
        });
        rateLimitedCount++;
      } else {
        results.push({
          provider: provider.id,
          httpStatus: 200,
          status: 'failed',
          storiesSaved: 0,
          errors: st.errors
        });
      }
      await flushProviderFetchLogs(env, st.pendingLogs);
      continue;
    }
    try {
      const savedByCategory = {};
      const failedSaveCategories = new Set();
      if (st.pendingStories.length) {
        try {
          const batchResult = await upsertNewsStoriesBatch(env, provider.id, st.pendingStories);
          for (const { category: cat, stories: catStories } of st.pendingStories) {
            savedByCategory[cat] = catStories.length;
          }
          st.storiesSaved = batchResult?.savedCount ?? 0;
        } catch (batchErr) {
          console.error(`Batch upsert failed for ${provider.id}, falling back to per-category posts:`, batchErr);
          for (const { category: cat, stories: catStories } of st.pendingStories) {
            try {
              const r = await upsertNewsStories(env, provider.id, cat, catStories);
              savedByCategory[cat] = r?.savedCount ?? 0;
              st.storiesSaved += r?.savedCount ?? 0;
            } catch (singleErr) {
              failedSaveCategories.add(cat);
              st.errors.push(`${cat}: ${singleErr instanceof Error ? singleErr.message : String(singleErr)}`);
            }
          }
        }
      }
      for (const logEntry of st.pendingLogs) {
        if (logEntry.status === 'succeeded') {
          if (failedSaveCategories.has(logEntry.category) || !Object.hasOwn(savedByCategory, logEntry.category)) {
            logEntry.status = 'failed';
            logEntry.storiesSaved = 0;
            logEntry.errorMessage = `${logEntry.category}: story save failed`;
          } else {
            logEntry.storiesSaved = savedByCategory[logEntry.category];
          }
        }
      }
      await flushProviderFetchLogs(env, st.pendingLogs);
      const status = st.errors.length === 0
        ? 'succeeded'
        : st.storiesSaved > 0
          ? 'partial'
          : 'failed';
      const errorMessage = st.errors.length ? st.errors.join('; ').slice(0, 2000) : null;
      await finishNewsProviderSync(env, provider.id, { status, storiesSaved: st.storiesSaved, error: errorMessage });
      st.finished = true;
      if (st.errors.length === 0) clearProviderCooldownState(provider.id);
      totalStoriesSaved += st.storiesSaved;
      if (st.rateLimited) rateLimitedCount++;
      results.push({
        provider: provider.id,
        httpStatus: 200,
        status,
        storiesSaved: st.storiesSaved,
        errors: st.errors,
        ...(st.rateLimited ? { rateLimited: true } : {})
      });
    } catch (err) {
      console.error(`Auto-sync flush failed for provider ${provider.id}:`, err);
      const flushMessage = err instanceof Error ? err.message : String(err);
      try {
        await finishNewsProviderSync(env, provider.id, { status: 'failed', storiesSaved: st.storiesSaved, error: flushMessage });
        st.finished = true;
      } catch (finishErr) {
        console.error(`Auto-sync could not save failed status for provider ${provider.id}:`, finishErr);
      }
      results.push({
        provider: provider.id,
        status: 'failed',
        error: flushMessage
      });
    }
  }

  // Final safety net: any provider this run claimed but never finished
  // (pair-loop escape, flush failure, or a finish that itself threw) must
  // not stay 'running' — that wedges the panel until the 20-minute
  // re-claim window. Unclaimed providers are never touched: their row may
  // belong to another concurrent run.
  for (const provider of providers) {
    const st = getState(provider.id);
    if (!st.claimed || st.finished) continue;
    const safetyMessage = sweepError
      ? `Auto-sync did not complete: ${sweepError instanceof Error ? sweepError.message : String(sweepError)}`
      : 'Auto-sync did not finish this provider';
    try {
      await finishNewsProviderSync(env, provider.id, { status: 'failed', storiesSaved: st.storiesSaved, error: safetyMessage });
      st.finished = true;
    } catch (finishErr) {
      console.error(`Auto-sync safety net could not save failed status for provider ${provider.id}:`, finishErr);
    }
    if (!results.some(r => r.provider === provider.id)) {
      results.push({ provider: provider.id, httpStatus: 200, status: 'failed', storiesSaved: st.storiesSaved, errors: [safetyMessage] });
    }
  }

  const allSucceeded = results.length > 0 && results.every(r => r.status === 'succeeded');
  const anySaved = totalStoriesSaved > 0;
  const overallStatus = allSucceeded ? 'succeeded' : anySaved ? 'partial' : 'failed';
  const summaryText = `Synced ${results.length} providers (${totalStoriesSaved} stories saved${rateLimitedCount ? `, ${rateLimitedCount} rate-limited` : ''})`;

  const updatedAutoSync = setAutoSyncState({
    lastRunAt: new Date().toISOString(),
    lastTrigger: triggerSource,
    lastStatus: overallStatus,
    lastSummary: summaryText,
    updatedBy
  });

  // Automatically trigger 3x/day AI story curation (Morning, Afternoon, Evening) if current slot is due
  let aiCurationResult = null;
  try {
    const curationState = getAiCurationState();
    if (curationState.enabled && curationState.isSlotDue) {
      aiCurationResult = await runAiStoryCuration(env, {
        slot: curationState.currentSlot,
        triggerSource: `auto_${triggerSource}`,
        updatedBy: `ai-scheduler:${updatedBy}`
      });
    }
  } catch (err) {
    console.error('Scheduled AI story curation check failed:', err);
  }

  if (runId) {
    await finishSyncRun(env, runId, {
      status: overallStatus,
      pairsDone: pairs.length,
      summary: {
        totalStoriesSaved,
        rateLimitedCount,
        providers: results.map(r => ({ provider: r.provider, status: r.status, storiesSaved: r.storiesSaved ?? 0 }))
      }
    });
  }

  console.info(JSON.stringify({
    event: 'HOURLY_AUTO_SYNC_COMPLETE',
    triggerSource,
    overallStatus,
    totalStoriesSaved,
    rateLimitedCount,
    providersCount: results.length,
    aiCurationTriggered: Boolean(aiCurationResult && !aiCurationResult.skipped)
  }));

  return {
    skipped: false,
    triggerSource,
    status: overallStatus,
    totalStoriesSaved,
    rateLimitedCount,
    results,
    autoSync: updatedAutoSync,
    aiCuration: aiCurationResult?.aiCuration || getAiCurationState()
  };
}

function authConfigurationIsValid(env) {
  return env.GITHUB_CLIENT_ID &&
    env.GITHUB_CLIENT_SECRET &&
    env.GITHUB_ALLOWED_USER &&
    env.GITHUB_OAUTH_CALLBACK_URL &&
    env.GITHUB_SESSION_SECRET;
}

function adminAuthError(message, status = 400) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function beginGitHubLogin(request, env) {
  if (!authConfigurationIsValid(env)) {
    console.error('GitHub admin authentication is not fully configured');
    return adminAuthError('GitHub admin authentication is not configured', 503);
  }
  const limit = await env.SUMMARY_RATE_LIMITER.limit({
    key: `github-auth:${request.headers.get('CF-Connecting-IP') || 'unknown'}`
  });
  if (!limit.success) return adminAuthError('Too many sign-in attempts; try again later', 429);

  const state = createOAuthState();
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', env.GITHUB_OAUTH_CALLBACK_URL);
  authorizeUrl.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl.toString(),
      'Set-Cookie': createOAuthStateCookie(state),
      'Cache-Control': 'no-store'
    }
  });
}

async function completeGitHubLogin(request, env) {
  const url = new URL(request.url);
  const sentState = url.searchParams.get('state');
  const storedState = getOAuthState(request);
  if (!sentState || !storedState || sentState !== storedState) {
    return adminAuthError('GitHub sign-in could not be verified. Please try again.', 400);
  }
  if (url.searchParams.has('error') || !url.searchParams.get('code')) {
    return adminAuthError('GitHub sign-in was cancelled or did not complete.', 400);
  }
  if (!authConfigurationIsValid(env)) {
    console.error('GitHub admin authentication is not fully configured');
    return adminAuthError('GitHub admin authentication is not configured', 503);
  }
  const limit = await env.SUMMARY_RATE_LIMITER.limit({
    key: `github-auth:${request.headers.get('CF-Connecting-IP') || 'unknown'}`
  });
  if (!limit.success) return adminAuthError('Too many sign-in attempts; try again later', 429);

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Littlables-News-Admin'
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: url.searchParams.get('code'),
        redirect_uri: env.GITHUB_OAUTH_CALLBACK_URL
      })
    });
    if (!tokenResponse.ok) {
      throw new Error(`GitHub token exchange failed (HTTP ${tokenResponse.status})`);
    }
    const tokenData = await tokenResponse.json();
    if (typeof tokenData.access_token !== 'string' || !tokenData.access_token) {
      throw new Error('GitHub did not return an access token');
    }
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'Littlables-News-Admin',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!userResponse.ok) throw new Error(`GitHub account lookup failed (HTTP ${userResponse.status})`);
    const user = await userResponse.json();
    if (
      typeof user.login !== 'string' ||
      user.login.toLowerCase() !== env.GITHUB_ALLOWED_USER.toLowerCase()
    ) {
      return adminAuthError('This GitHub account is not allowed to administer this site.', 403);
    }

    const headers = new Headers({
      Location: new URL('/admin', url.origin).toString(),
      'Cache-Control': 'no-store'
    });
    headers.append('Set-Cookie', await createAdminSessionCookie(user.login, env.GITHUB_SESSION_SECRET));
    headers.append('Set-Cookie', clearOAuthStateCookie());
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error('GitHub admin sign-in failed:', error);
    return adminAuthError('GitHub sign-in failed. Please try again.', 502);
  }
}

async function serveAdmin(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/admin/auth/login' && request.method === 'GET') {
    return beginGitHubLogin(request, env);
  }
  if (url.pathname === '/admin/auth/callback' && request.method === 'GET') {
    return completeGitHubLogin(request, env);
  }
  if (url.pathname === '/admin/logout' && request.method === 'POST') {
    if (!isSameOrigin(request)) return jsonResponse({ error: 'Logout must be requested from the admin origin' }, 403);
    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL('/admin', url.origin).toString(),
        'Set-Cookie': clearAdminSessionCookie(),
        'Cache-Control': 'no-store'
      }
    });
  }
  let identity;
  try {
    identity = await getAdminIdentity(request, env);
  } catch (error) {
    console.error('GitHub admin session validation failed:', error);
    return adminAuthError('GitHub admin authentication is not configured', 503);
  }

  if (request.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
    if (!identity) {
      return new Response(getAdminLoginPage(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        }
      });
    }
    return new Response(getAdminPage(), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; connect-src 'self'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      }
    });
  }
  if (!identity) return jsonResponse({ error: 'GitHub authentication is required' }, 401);
  if (url.pathname === '/admin/api/identity' && request.method === 'GET') {
    return jsonResponse({ login: identity.login });
  }
  if (url.pathname === '/admin/api/status' && request.method === 'GET') {
    const pendingProvider = url.searchParams.get('provider');
    if (pendingProvider && !getNewsProviders(env).some(provider => provider.id === pendingProvider)) {
      return jsonResponse({ error: 'Unknown news provider' }, 400);
    }
    try {
      return jsonResponse(await getNewsAdminSnapshot(env, getNewsProviders(env), pendingProvider));
    } catch (err) {
      console.error('News admin status request failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not load news admin status' }, 502);
    }
  }

  if (url.pathname === '/admin/api/preview' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Page previews must be requested from the admin origin' }, 403);
    }
    try {
      const contentLength = Number(request.headers.get('Content-Length') || 0);
      if (contentLength > 4_000) return jsonResponse({ error: 'Preview request is too large' }, 413);
      const bodyText = await request.text();
      if (bodyText.length > 4_000) return jsonResponse({ error: 'Preview request is too large' }, 413);
      let body;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return jsonResponse({ error: 'Preview request must be valid JSON' }, 400);
      }
      if (typeof body.url !== 'string' || body.url.length > 2_000 || !isPublicWebUrl(body.url)) {
        return jsonResponse({ error: 'Enter a public HTTP or HTTPS article URL' }, 400);
      }
      const limit = await env.SUMMARY_RATE_LIMITER.limit({ key: `admin-preview:${identity.login}` });
      if (!limit.success) return jsonResponse({ error: 'Preview rate limit exceeded' }, 429);
      const page = await fetchPublicPage(body.url);
      const metadata = extractPageMetadata(page.content, page.url);
      return jsonResponse(metadata);
    } catch (err) {
      console.error('Custom article preview failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not parse this article page' }, 502);
    }
  }

  if (url.pathname === '/admin/api/summary' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Summary generation must be requested from the admin origin' }, 403);
    }
    const usage = createAiUsageCounter();
    try {
      const payload = await readAdminStoryPayload(request);
      if (payload instanceof Response) return payload;
      if (!env.AI) return jsonResponse({ error: 'Workers AI is not configured for this Worker' }, 503);
      if (!env.SUMMARY_RATE_LIMITER) {
        return jsonResponse({ error: 'Summary rate limiter is not configured for this Worker' }, 503);
      }
      const limit = await env.SUMMARY_RATE_LIMITER.limit({ key: `admin-summary:${identity.login}` });
      if (!limit.success) return jsonResponse({ error: 'Summary generation rate limit exceeded' }, 429);
      const summary = await generateAdminSummary(payload, env, usage);
      await usage.flush(env);
      return jsonResponse({ summary });
    } catch (err) {
      console.error('Admin AI summary generation failed:', err);
      await usage.flush(env);
      return jsonResponse({
        error: err instanceof Error ? err.message : 'Could not generate an AI summary'
      }, 502);
    }
  }

  if (url.pathname === '/admin/api/image' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Image generation must be requested from the admin origin' }, 403);
    }
    const usage = createAiUsageCounter();
    try {
      const payload = await readAdminStoryPayload(request);
      if (payload instanceof Response) return payload;
      if (!env.AI) return jsonResponse({ error: 'Workers AI is not configured for this Worker' }, 503);
      if (!env.SUMMARY_RATE_LIMITER) {
        return jsonResponse({ error: 'Summary rate limiter is not configured for this Worker' }, 503);
      }
      const limit = await env.SUMMARY_RATE_LIMITER.limit({ key: `admin-image:${identity.login}` });
      if (!limit.success) return jsonResponse({ error: 'Image generation rate limit exceeded' }, 429);
      const image = await generateAdminStoryImage(payload, request.url, env, usage);
      await usage.flush(env);
      return jsonResponse(image);
    } catch (err) {
      console.error('Admin AI image generation failed:', err);
      await usage.flush(env);
      return jsonResponse({
        error: err instanceof Error ? err.message : 'Could not generate an AI image'
      }, 502);
    }
  }

  if (url.pathname === '/admin/api/stories' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Story publishing must be requested from the admin origin' }, 403);
    }
    try {
      const payload = await readAdminStoryPayload(request);
      if (payload instanceof Response) return payload;
      const id = await createApprovedCustomNewsStory(env, payload, identity.login);
      return jsonResponse({ id, approved: true });
    } catch (err) {
      console.error('Custom story publishing failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not publish custom story' }, 502);
    }
  }

  // One-time Halloween batch: stages the curated kid-safe stories as
  // UNAPPROVED rows (Pending Approval) via the normal provider-ingest path.
  // Same admin-session + same-origin gates as the other story endpoints.
  if (url.pathname === '/admin/api/stories/stage-halloween-batch' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Story staging must be requested from the admin origin' }, 403);
    }
    try {
      const result = await stageHalloweenBatch(env);
      return jsonResponse({ staged: result.staged, duplicatesSkipped: result.duplicatesSkipped, interestsSet: result.interestsSet, interestsFailed: result.interestsFailed, byCategory: result.byCategory });
    } catch (err) {
      console.error('Halloween batch staging failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not stage Halloween batch' }, 502);
    }
  }

  const storyEditMatch = url.pathname.match(/^\/admin\/api\/stories\/(\d+)$/);
  if (storyEditMatch && request.method === 'PATCH') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Story updates must be requested from the admin origin' }, 403);
    }
    try {
      const payload = await readAdminStoryPayload(request);
      if (payload instanceof Response) return payload;
      const updated = await updateNewsStory(env, storyEditMatch[1], payload);
      if (!updated) return jsonResponse({ error: 'Story was not found' }, 404);
      return jsonResponse({ id: Number(storyEditMatch[1]), updated: true });
    } catch (err) {
      console.error('News story detail update failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not update story details' }, 502);
    }
  }

  const approvalMatch = url.pathname.match(/^\/admin\/api\/stories\/(\d+)\/approve$/);
  if (approvalMatch && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Story approval must be requested from the admin origin' }, 403);
    }
    try {
      const approved = await approveNewsStory(env, approvalMatch[1], identity.login);
      if (!approved) return jsonResponse({ error: 'Story was not found or is already approved' }, 404);
      return jsonResponse({ id: Number(approvalMatch[1]), approved: true });
    } catch (err) {
      console.error('News story approval failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not approve story' }, 502);
    }
  }

  const decisionMatch = url.pathname.match(/^\/admin\/api\/stories\/(\d+)\/(disapprove|ban|undo)$/);
  if (decisionMatch && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Story decision must be requested from the admin origin' }, 403);
    }
    try {
      const [, storyId, action] = decisionMatch;
      const changed = action === 'disapprove'
        ? await disapproveNewsStory(env, storyId, identity.login)
        : action === 'ban'
          ? await banNewsStory(env, storyId, identity.login)
          : await undoNewsStoryDecision(env, storyId, identity.login);
      if (!changed) return jsonResponse({ error: 'Story was not found or its decision has changed' }, 404);
      return jsonResponse({ id: Number(storyId), action });
    } catch (err) {
      console.error(`News story ${decisionMatch[2]} failed:`, err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not update story decision' }, 502);
    }
  }

  const displayCatsMatch = url.pathname.match(/^\/admin\/api\/stories\/(\d+)\/display-categories$/);
  if (displayCatsMatch && request.method === 'PATCH') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Story category updates must be requested from the admin origin' }, 403);
    }
    try {
      let body = {};
      try { body = await request.json(); } catch { /* empty body clears the override */ }
      const result = await setStoryDisplayCategories(env, displayCatsMatch[1], body.display_categories);
      if (!result.ok) return jsonResponse({ error: result.error || 'Could not update story categories' }, result.error === 'Story was not found' ? 404 : 400);
      return jsonResponse({
        id: Number(displayCatsMatch[1]),
        display_categories: result.displayCategories,
        overrridable_categories: OVERRIDABLE_CATEGORIES,
      });
    } catch (err) {
      console.error('News story display-categories update failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not update story categories' }, 502);
    }
  }

  const interestKwMatch = url.pathname.match(/^\/admin\/api\/stories\/(\d+)\/interest-keywords$/);
  if (interestKwMatch && request.method === 'PATCH') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Story keyword updates must be requested from the admin origin' }, 403);
    }
    try {
      let body = {};
      try { body = await request.json(); } catch { /* empty body clears the keywords */ }
      const result = await setStoryInterestKeywords(env, interestKwMatch[1], body.interest_keywords);
      if (!result.ok) return jsonResponse({ error: result.error || 'Could not update story keywords' }, result.error === 'Story was not found' ? 404 : 400);
      return jsonResponse({
        id: Number(interestKwMatch[1]),
        interest_keywords: result.interestKeywords,
        interest_keyword_options: INTEREST_KEYWORDS,
      });
    } catch (err) {
      console.error('News story interest-keywords update failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not update story keywords' }, 502);
    }
  }

  // LLM keyword tagging: have the model read the story and pick the keywords
  // that actually fit (judged by meaning, not word association), then store
  // them. Used from the validation list's "AI tags" button to correct
  // embedding misfires. Budget: 1 story fetch + 1 LLM call + 1 PATCH.
  const llmKwMatch = url.pathname.match(/^\/admin\/api\/stories\/(\d+)\/llm-keywords$/);
  if (llmKwMatch && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Story keyword tagging must be requested from the admin origin' }, 403);
    }
    if (!env.AI) {
      return jsonResponse({ error: 'Workers AI is not configured for this Worker' }, 503);
    }
    const usage = createAiUsageCounter();
    try {
      const storyId = llmKwMatch[1];
      const storyQuery = new URLSearchParams({ id: `eq.${storyId}`, select: 'id,title,description' });
      const storyRes = await fetch(supabaseUrl(env, STORIES_TABLE, storyQuery), {
        headers: supabaseHeaders(env),
      });
      if (!storyRes.ok) throw new Error(`Story lookup failed (HTTP ${storyRes.status})`);
      const storyRows = await storyRes.json();
      if (!Array.isArray(storyRows) || storyRows.length === 0) {
        return jsonResponse({ error: 'Story was not found' }, 404);
      }
      const story = storyRows[0];
      const keywordList = INTEREST_KEYWORDS.map((k) => `${k.id}: ${k.label}`).join('\n');
      const prompt =
        'You are tagging a family-friendly news story with topic keywords.\n\n' +
        `Title: ${story.title || ''}\n` +
        `Description: ${(story.description || '').slice(0, 1200)}\n\n` +
        'Pick up to 3 keywords from this list that best describe what the story is ACTUALLY about. ' +
        'Judge by meaning, not by words in the text — a passing mention of a person, brand, or object does not count. ' +
        'For example, a story mentioning Elon Musk and Starlink is about satellites and geopolitics, not electric cars; ' +
        'a story about a broken office globe is about history, not outer space.\n\n' +
        `${keywordList}\n\n` +
        'Respond with ONLY a JSON array of keyword ids, e.g. ["space", "science"]. If none fit well, respond with [].';
      let aiRes;
      try {
        aiRes = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
          messages: [
            { role: 'system', content: 'You tag news stories with topic keywords. You always respond with only a JSON array of keyword ids, no other text.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 200,
          temperature: 0.1,
        });
        usage.add(AI_USAGE_MODEL_LLAMA, 'ai-tags', 1);
        await usage.flush(env);
      } catch (err) {
        usage.add(AI_USAGE_MODEL_LLAMA, 'ai-tags', 0, 1);
        await usage.flush(env);
        throw err;
      }
      // Extract usable text from the model response. Workers AI returns an
      // OpenAI-compatible object for this model: the text lives in
      // choices[0].message.content, while `response` is itself an object.
      // Older shapes (plain string, { response: string }) still handled.
      const extractAiText = (res, depth = 0) => {
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
      };
      const rawText = extractAiText(aiRes);
      const jsonMatch = rawText.match(/\[[\s\S]*?\]/);
      let picked = [];
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) picked = parsed;
        } catch { /* fall through to empty */ }
      }
      // If the model returned no usable text at all, fail instead of
      // silently clearing the story's existing tags — and include the
      // response shape so the next failure is diagnosable.
      if (!jsonMatch && rawText === '') {
        const shape = aiRes === null || aiRes === undefined ? String(aiRes)
          : Array.isArray(aiRes) ? 'array'
          : typeof aiRes === 'object'
            ? `object keys=[${Object.keys(aiRes).join(',')}] responseType=${typeof aiRes.response}`
            : typeof aiRes;
        return jsonResponse({ error: `LLM returned an unusable response (shape: ${shape}) — tags unchanged` }, 502);
      }
      const clean = normalizeInterestKeywords(picked);
      const result = await setStoryInterestKeywords(env, storyId, clean);
      if (!result.ok) return jsonResponse({ error: result.error || 'Could not store LLM keywords' }, 502);
      return jsonResponse({
        id: Number(storyId),
        interest_keywords: result.interestKeywords,
        llm_picks: (result.interestKeywords || []).map((id) => {
          const kw = getInterestKeyword(id);
          return kw ? { id: kw.id, label: kw.label, icon: kw.icon } : { id };
        }),
      });
    } catch (err) {
      console.error('LLM keyword tagging failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'LLM keyword tagging failed' }, 502);
    }
  }

  const updateMatch = url.pathname.match(/^\/admin\/api\/providers\/([a-z0-9-]+)\/update$/);
  if (updateMatch && request.method === 'POST') {
    try {
      if (!isSameOrigin(request)) {
        return jsonResponse({ error: 'Provider updates must be requested from the admin origin' }, 403);
      }
      const limit = await env.SUMMARY_RATE_LIMITER.limit({ key: `admin:${identity.login}` });
      if (!limit.success) return jsonResponse({ error: 'Admin update rate limit exceeded' }, 429);
      const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';
      return await updateNewsProvider(updateMatch[1], identity.login, env, {
        force,
        triggerSource: 'admin_manual'
      });
    } catch (err) {
      console.error('News admin provider update failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not update news provider' }, 502);
    }
  }

  const resetMatch = url.pathname.match(/^\/admin\/api\/providers\/([a-z0-9-]+)\/reset$/);
  if (resetMatch && request.method === 'POST') {
    try {
      if (!isSameOrigin(request)) {
        return jsonResponse({ error: 'Provider reset must be requested from the admin origin' }, 403);
      }
      const limit = await env.SUMMARY_RATE_LIMITER.limit({ key: `admin:${identity.login}` });
      if (!limit.success) return jsonResponse({ error: 'Admin update rate limit exceeded' }, 429);
      const result = await resetNewsProviderSync(env, resetMatch[1], identity.login);
      return jsonResponse(result);
    } catch (err) {
      console.error('News admin provider reset failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not reset provider sync state' }, 502);
    }
  }

  const profileMatch = url.pathname.match(/^\/admin\/api\/providers\/([a-z0-9-]+)\/profile$/);
  if (profileMatch && request.method === 'GET') {
    try {
      if (!isSameOrigin(request)) {
        return jsonResponse({ error: 'Provider profile must be requested from the admin origin' }, 403);
      }
      const limit = await env.SUMMARY_RATE_LIMITER.limit({ key: `admin:${identity.login}` });
      if (!limit.success) return jsonResponse({ error: 'Admin update rate limit exceeded' }, 429);
      const profile = await getProviderProfile(env, profileMatch[1]);
      if (!profile) return jsonResponse({ error: 'Unknown news provider' }, 404);
      return jsonResponse(profile);
    } catch (err) {
      console.error('News admin provider profile failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not load provider profile' }, 502);
    }
  }

  if (url.pathname === '/admin/api/providers/unstick-all' && request.method === 'POST') {
    try {
      if (!isSameOrigin(request)) {
        return jsonResponse({ error: 'Provider unstick must be requested from the admin origin' }, 403);
      }
      const limit = await env.SUMMARY_RATE_LIMITER.limit({ key: `admin:${identity.login}` });
      if (!limit.success) return jsonResponse({ error: 'Admin update rate limit exceeded' }, 429);
      const result = await unstickAllProviderSyncs(env, identity.login);
      return jsonResponse(result);
    } catch (err) {
      console.error('News admin unstick-all failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not unstick provider sync state' }, 502);
    }
  }

  if (url.pathname === '/admin/api/providers/sync-all' && request.method === 'POST') {
    try {
      if (!isSameOrigin(request)) {
        return jsonResponse({ error: 'Provider sync must be requested from the admin origin' }, 403);
      }
      const limit = await env.SUMMARY_RATE_LIMITER.limit({ key: `admin:${identity.login}` });
      if (!limit.success) return jsonResponse({ error: 'Admin update rate limit exceeded' }, 429);
      const summary = await runHourlyAutoSync(env, 'admin_sync_all', identity.login, { force: true });
      return jsonResponse({
        ...summary,
        autoSync: getAutoSyncState()
      });
    } catch (err) {
      console.error('Admin sync-all failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not sync all providers' }, 502);
    }
  }

  if (url.pathname === '/admin/api/auto-sync' && request.method === 'GET') {
    return jsonResponse({ autoSync: getAutoSyncState() });
  }

  if (url.pathname === '/admin/api/auto-sync' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Auto-sync changes must be requested from the admin origin' }, 403);
    }
    try {
      const payload = await request.json().catch(() => ({}));
      if (typeof payload.enabled === 'boolean') {
        const autoSync = setAutoSyncState({
          enabled: payload.enabled,
          updatedBy: identity.login
        });
        return jsonResponse({ autoSync });
      }
      if (payload.action === 'check_stale' || payload.action === 'run_if_stale') {
        const current = getAutoSyncState();
        const aiState = getAiCurationState();
        let triggered = false;
        let summary = null;
        if (current.enabled && current.isStale) {
          summary = await runHourlyAutoSync(env, 'stale_check', `stale-check:${identity.login}`);
          triggered = true;
        } else if (aiState.enabled && aiState.isSlotDue) {
          summary = await runAiStoryCuration(env, {
            slot: aiState.currentSlot,
            triggerSource: 'scheduled_window',
            updatedBy: `window-check:${identity.login}`
          });
          triggered = !summary.skipped;
        }
        return jsonResponse({
          triggered,
          summary,
          autoSync: getAutoSyncState(),
          aiCuration: getAiCurationState()
        });
      }
      return jsonResponse({ autoSync: getAutoSyncState() });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not update auto-sync settings' }, 500);
    }
  }

  if (url.pathname === '/admin/api/ai-curation' && request.method === 'GET') {
    return jsonResponse({ aiCuration: getAiCurationState() });
  }

  if (url.pathname === '/admin/api/ai-curation' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'AI curation settings must be requested from the admin origin' }, 403);
    }
    try {
      const payload = await request.json().catch(() => ({}));
      const updated = updateAiCurationConfig(payload, identity.login);
      if (payload.reCurate) {
        const runResult = await runAiStoryCuration(env, {
          slot: payload.slot || updated.currentSlot,
          triggerSource: 'taste_profile_update',
          updatedBy: identity.login,
          force: true
        });
        return jsonResponse({
          updated: true,
          curated: true,
          runResult,
          aiCuration: getAiCurationState()
        });
      }
      return jsonResponse({ updated: true, aiCuration: updated });
    } catch (err) {
      return jsonResponse({
        error: err instanceof Error ? err.message : 'Could not update AI curation settings'
      }, 500);
    }
  }

  if (url.pathname === '/admin/api/ai-curation/run' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'AI curation runs must be requested from the admin origin' }, 403);
    }
    try {
      const limit = await env.SUMMARY_RATE_LIMITER.limit({ key: `admin-curation:${identity.login}` });
      if (!limit.success) return jsonResponse({ error: 'AI curation rate limit exceeded; try again shortly' }, 429);
      const payload = await request.json().catch(() => ({}));
      const result = await runAiStoryCuration(env, {
        slot: payload.slot || null,
        triggerSource: payload.triggerSource || 'manual',
        updatedBy: identity.login,
        force: true
      });
      return jsonResponse(result);
    } catch (err) {
      console.error('Admin AI story curation run failed:', err);
      return jsonResponse({
        error: err instanceof Error ? err.message : 'Could not run AI story curation'
      }, 502);
    }
  }

  if (url.pathname === '/admin/api/ai-curation/bulk' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Bulk story decisions must be requested from the admin origin' }, 403);
    }
    try {
      const payload = await request.json().catch(() => ({}));
      const storyIds = Array.isArray(payload.storyIds) ? payload.storyIds : [];
      const action = typeof payload.action === 'string' ? payload.action : 'approve';
      const result = await bulkDecideNewsStories(env, storyIds, action, identity.login);
      return jsonResponse(result);
    } catch (err) {
      console.error('Bulk AI story decision failed:', err);
      return jsonResponse({
        error: err instanceof Error ? err.message : 'Could not complete bulk story decision'
      }, 502);
    }
  }

  if (url.pathname === '/admin/api/logs' && request.method === 'GET') {
    const provider = url.searchParams.get('provider') || 'all';
    const status = url.searchParams.get('status') || 'all';
    const category = url.searchParams.get('category') || 'all';
    const limit = Number(url.searchParams.get('limit') || 100);
    return jsonResponse(await getNewsProviderFetchLogsFromDb(env, { provider, status, category, limit }));
  }

  if (url.pathname === '/admin/api/analytics' && request.method === 'GET') {
    const type = url.searchParams.get('type') || 'search';
    const country = url.searchParams.get('country') || '';
    const region = url.searchParams.get('region') || '';
    const limit = Number(url.searchParams.get('limit') || 50);
    return jsonResponse(await getAnalyticsStats(env, { type, country, region, limit }));
  }

  if (url.pathname === '/admin/api/ai-usage' && request.method === 'GET') {
    // No isSameOrigin check here, matching /admin/api/analytics: the admin
    // session gate is the authorization, and browsers send no Origin header
    // on same-origin GET fetches, so the check would 403 every dashboard
    // load and hide the counts.
    try {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30));
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const query = new URLSearchParams({
        select: 'usage_date,model,usage_key,calls,errors',
        usage_date: `gte.${cutoff}`,
        order: 'usage_date.desc',
        limit: '5000'
      });
      const res = await fetch(supabaseUrl(env, 'ai_usage_daily', query), { headers: supabaseHeaders(env) });
      if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
      const rows = await res.json();
      return jsonResponse({ rows: Array.isArray(rows) ? rows : [] });
    } catch (err) {
      console.error('AI usage fetch failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not load AI usage' }, 502);
    }
  }

  if (url.pathname === '/admin/api/logs/clear' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Log clearing must be requested from the admin origin' }, 403);
    }
    clearNewsProviderFetchLogs();
    try {
      await fetch(
        supabaseUrl(env, 'news_provider_logs', new URLSearchParams({ created_at: `lt.${new Date().toISOString()}` })),
        { method: 'DELETE', headers: supabaseHeaders(env, { Prefer: 'return=minimal' }) }
      );
    } catch (err) {
      console.warn('DB log clear failed:', err.message);
    }
    return jsonResponse({ cleared: true, ...(await getNewsProviderFetchLogsFromDb(env, {})) });
  }

  // Lookup a story by article URL (for homepage admin editing).
  if (url.pathname === '/admin/api/stories/by-url' && request.method === 'GET') {
    const articleUrl = url.searchParams.get('url') || '';
    if (!articleUrl.trim()) return jsonResponse({ error: 'URL is required' }, 400);
    try {
      const query = new URLSearchParams({
        article_url: `eq.${articleUrl}`,
        select: 'id,title,approved,removed,display_categories,interest_keywords,category',
        limit: '1',
      });
      const res = await fetch(supabaseUrl(env, STORIES_TABLE, query), { headers: supabaseHeaders(env) });
      if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
      const rows = await res.json();
      if (!rows.length) return jsonResponse({ error: 'Story not found' }, 404);
      const s = rows[0];
      return jsonResponse({
        id: s.id,
        title: s.title,
        approved: s.approved,
        removed: s.removed,
        display_categories: s.display_categories,
        interest_keywords: s.interest_keywords,
        category: s.category,
      });
    } catch (err) {
      console.error('Story by-url lookup failed:', err);
      return jsonResponse({ error: 'Could not find story' }, 502);
    }
  }

  if (url.pathname === '/admin/api/stories/search' && request.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (!q.trim()) return jsonResponse({ items: [] });
    try {
      const items = await searchNewsStories(env, q);
      return jsonResponse({ items });
    } catch (err) {
      console.error('Story search failed:', err);
      return jsonResponse({ items: [] });
    }
  }

  // Scan stories for missing or broken images, newest first, one chunk per call.
  // GET /admin/api/stories/check-images?before=<lastId>&batch=<n>
  // - `before`: only stories with id < before are examined (cursor, newest first).
  // - `batch`: max image URLs HEAD-checked per call (default 15, keeps the
  //   invocation well under the 50-subrequest limit: 1 DB fetch + batch HEADs).
  // The client loops with the returned nextBefore until done. No-image stories
  // cost no fetches, so they are all reported from every page examined.
  if (url.pathname === '/admin/api/stories/check-images' && request.method === 'GET') {
    const before = Number(url.searchParams.get('before') || 0) || 0;
    const batch = Math.min(30, Math.max(1, Number(url.searchParams.get('batch') || 15) || 15));
    try {
      const page = new URLSearchParams({
        select: 'id,title,article_url,image_url,category,approved,removed',
        order: 'id.desc',
        limit: '40',
      });
      if (before > 0) page.set('id', `lt.${before}`);
      const res = await fetch(supabaseUrl(env, STORIES_TABLE, page), { headers: supabaseHeaders(env) });
      if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
      const rows = await res.json();

      const noImage = [];
      const toCheck = [];
      let lastProcessedId = null;
      let stoppedEarly = false;
      for (const row of rows) {
        const imageUrl = (row.image_url || '').trim();
        if (!imageUrl) {
          noImage.push({
            id: row.id, title: row.title, link: row.article_url,
            category: row.category, approved: row.approved, removed: row.removed,
          });
          lastProcessedId = row.id;
          continue;
        }
        if (toCheck.length >= batch) { stoppedEarly = true; break; }
        toCheck.push(row);
        lastProcessedId = row.id;
      }

      // HEAD-check in parallel chunks of 5 with a 5s timeout each.
      const broken = [];
      for (let i = 0; i < toCheck.length; i += 5) {
        const chunk = toCheck.slice(i, i + 5);
        const results = await Promise.all(chunk.map(async (row) => {
          const raw = (row.image_url || '').trim();
          let target = raw;
          if (target.startsWith('//')) target = 'https:' + target;
          if (target.startsWith('data:')) return { row, ok: true, status: 'data' };
          if (!/^https?:\/\//i.test(target)) return { row, ok: false, status: 'invalid' };
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            try {
              const head = await fetch(target, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
              return { row, ok: head.ok, status: head.status };
            } finally {
              clearTimeout(timer);
            }
          } catch (err) {
            return { row, ok: false, status: err?.name === 'AbortError' ? 'timeout' : 'error' };
          }
        }));
        results.forEach(({ row, ok, status }) => {
          if (ok) return;
          broken.push({
            id: row.id, title: row.title, link: row.article_url,
            category: row.category, approved: row.approved, removed: row.removed,
            imageUrl: row.image_url, status,
          });
        });
      }

      const done = !stoppedEarly && rows.length < 40;
      return jsonResponse({
        checked: (lastProcessedId === null ? 0 : noImage.length + toCheck.length),
        noImage,
        broken,
        nextBefore: stoppedEarly || rows.length === 40 ? lastProcessedId : null,
        done,
      });
    } catch (err) {
      console.error('Image check failed:', err);
      return jsonResponse({ error: 'Image check failed' }, 502);
    }
  }

  // Auto-tag a single story with interest keywords (on-demand).
  // POST /admin/api/stories/auto-tag { id }
  // Classifies via embeddings, saves to DB, returns keywords.
  if (url.pathname === '/admin/api/stories/auto-tag' && request.method === 'POST') {
    if (!env.AI) {
      return jsonResponse({ error: 'Workers AI is not configured for this Worker' }, 503);
    }
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Must be requested from the admin origin' }, 403);
    }
    const usage = createAiUsageCounter();
    try {
      const body = await request.json().catch(() => ({}));
      const storyId = body.id;
      if (!storyId) return jsonResponse({ error: 'Story ID required' }, 400);

      // Fetch the story
      const storyRes = await fetch(
        supabaseUrl(env, STORIES_TABLE, new URLSearchParams({ id: `eq.${storyId}`, select: 'id,title,description' })),
        { headers: supabaseHeaders(env) }
      );
      if (!storyRes.ok) throw new Error('Story fetch failed');
      const rows = await storyRes.json();
      const story = Array.isArray(rows) ? rows[0] : null;
      if (!story) return jsonResponse({ error: 'Story not found' }, 404);

      // Classify
      const text = ((story.title || '') + ' ' + (story.description || '')).trim();
      if (!text) return jsonResponse({ id: storyId, keywords: [] });

      const keywordVectors = await getKeywordEmbeddings(env);
      if (!keywordVectors || keywordVectors.size === 0) {
        return jsonResponse({ error: 'Keyword vectors not warmed up' }, 503);
      }
      const vector = await embedText(env, text);
      if (!vector) {
        usage.add(AI_USAGE_MODEL_BGE, 'tagging', 0, 1);
        await usage.flush(env);
        return jsonResponse({ error: 'Failed to embed story text', id: storyId }, 500);
      }
      usage.add(AI_USAGE_MODEL_BGE, 'tagging', 1);
      const matches = classifyStoryKeywords(vector, keywordVectors);
      const keywords = matches.map(m => m.id);

      // Save to DB (even if empty — marks as processed)
      const saveRes = await fetch(
        supabaseUrl(env, STORIES_TABLE, new URLSearchParams({ id: `eq.${storyId}` })),
        {
          method: 'PATCH',
          headers: { ...supabaseHeaders(env), 'Content-Type': 'application/json' },
          body: JSON.stringify({ interest_keywords: keywords })
        }
      );
      if (!saveRes.ok) throw new Error('Save failed: ' + saveRes.status);

      await usage.flush(env);
      return jsonResponse({
        id: storyId,
        keywords,
        matches: matches.map(m => ({ id: m.id, label: m.label, confidence: m.confidence })),
        diagnostic: {
          textLength: text.length,
          vectorDims: vector.length,
          keywordVectorsCount: keywordVectors.size,
          threshold: 0.45
        }
      });
    } catch (err) {
      await usage.flush(env);
      return jsonResponse({ error: err.message || 'Auto-tag failed' }, 500);
    }
  }

  // Validate story categories via embedding classifier (prototype).
  // Classifies unapproved stories and flags mismatches for review.
  if (url.pathname === '/admin/api/stories/validate-categories' && request.method === 'POST') {
    if (!env.AI) {
      return jsonResponse({ error: 'Workers AI is not configured for this Worker' }, 503);
    }
    const usage = createAiUsageCounter();
    try {
      // Parse optional limit (default: process all unvalidated)
      let body = {};
      try {
        body = await request.json();
      } catch {
        // empty body is fine
      }
      const maxStories = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
      const BATCH = 50;
      // Optional old-category filter: only validate stories whose legacy
      // `category` column matches (from the Classify section dropdown).
      const filterCategory = typeof body.category === 'string' && NEWS_CATEGORIES.includes(body.category)
        ? body.category
        : null;

      let totalValidated = 0;
      let totalStored = 0;
      let firstError = null;
      const allMismatches = [];
      const allResults = [];
      let offset = 0;

      // Lightweight warmup status check: 1 Supabase lookup, 0 AI calls.
      // Lets the UI show "Warming up (N/113)…" immediately instead of
      // waiting for the first slow backfill round to return.
      if (body.warmup_check === true) {
        const kwCheck = await getKeywordVectorStatus(env);
        return jsonResponse({
          warmingUp: !kwCheck.complete,
          warmupDone: kwCheck.done,
          warmupTotal: kwCheck.total,
        });
      }

      // Interest keyword vectors are loaded from Supabase (embedded once and
      // persisted) and reused for every story — no per-story AI cost.
      // While the backfill is warming up, this runs as a standalone step and
      // returns early so its AI calls never share an invocation budget with
      // story validation (which would exceed the subrequest limit).
      const kwStatus = await getPersistedKeywordEmbeddings(env);
      if (!kwStatus.complete) {
        const debugBits = [];
        if (kwStatus.lookupError) debugBits.push(`lookup: ${kwStatus.lookupError}`);
        if (kwStatus.upsertError) debugBits.push(`upsert: ${kwStatus.upsertError}`);
        if (kwStatus.upserted) debugBits.push(`saved ${kwStatus.upserted} this run`);
        return jsonResponse({
          validated: 0,
          stored: 0,
          storeError: null,
          mismatches: [],
          results: [],
          warmingUp: true,
          warmupDone: kwStatus.done,
          warmupTotal: kwStatus.total,
          status: `Warming up keyword vectors (${kwStatus.done}/${kwStatus.total}) — run validation again to continue.${debugBits.length ? ' [' + debugBits.join('; ') + ']' : ''}`,
        });
      }
      const keywordVectors = kwStatus.vectors;

      while (totalValidated < maxStories) {
        // Fetch next batch of unapproved stories missing category validation
        // (and never overwriting a hand-set display override) or missing
        // interest keyword tags.
        const query = new URLSearchParams({
          select: 'id,title,description,category,image_url,provider,article_url,published_at,fetched_at,display_categories,embedding_category,embedding_confidence,interest_keywords,provider_country',
          approved: 'eq.false',
          removed: 'eq.false',
          or: '(and(embedding_category.is.null,display_categories.is.null),interest_keywords.is.null)',
          order: 'fetched_at.desc',
          limit: String(Math.min(BATCH, maxStories - totalValidated)),
          offset: String(offset),
        });
        if (filterCategory) query.set('category', `eq.${filterCategory}`);
        const res = await fetch(supabaseUrl(env, STORIES_TABLE, query), {
          headers: supabaseHeaders(env),
        });
        if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
        const stories = await res.json();
        if (!stories.length) break;

        const results = await validateStoryCategories(env, stories, { keywordVectors, usage });

        // Store the embedding predictions. For category mismatches, auto-apply
        // the AI's pick as the display override — Katie reviews them in the
        // validation list. Interest keyword tags are always stored when found.
        for (const r of results) {
          const patch = {};
          if (r.categoryValidated && r.embeddingCategory) {
            patch.embedding_category = r.embeddingCategory;
            patch.embedding_confidence = r.confidence;
            if (r.mismatch) patch.display_categories = [r.embeddingCategory];
          }
          if (r.keywordsClassified) {
            const kwIds = r.keywordMatches.map((m) => m.id);
            patch.interest_keywords = kwIds;
            // Country/region derivation disabled until story_region migration is confirmed.
            // const { country_code, region } = deriveStoryRegion(kwIds);
            // patch.country_code = country_code;
            // patch.region = region;
          }
          if (Object.keys(patch).length === 0) continue;
          const updateRes = await fetch(
            supabaseUrl(env, STORIES_TABLE, new URLSearchParams({ id: `eq.${r.id}` })),
            {
              method: 'PATCH',
              headers: { ...supabaseHeaders(env), 'Content-Type': 'application/json' },
              body: JSON.stringify(patch),
            }
          );
          if (updateRes.ok) {
            totalStored++;
            if (r.mismatch && r.categoryValidated) r.displayCategories = [r.embeddingCategory];
            if (r.keywordsClassified) r.interestKeywords = r.keywordMatches.map((m) => m.id);
          } else {
            const errText = await updateRes.text().catch(() => 'unknown');
            console.error(`Failed to store embedding for story ${r.id}: ${updateRes.status} ${errText}`);
            if (!firstError) firstError = `Story ${r.id}: ${updateRes.status} ${errText}`;
          }
        }

        totalValidated += results.length;
        allMismatches.push(...results.filter((r) => r.mismatch));
        allResults.push(...results.map((r) => ({
          id: r.id,
          title: r.title,
          queryCategory: r.queryCategory,
          embeddingCategory: r.embeddingCategory,
          confidence: r.confidence,
          mismatch: r.mismatch,
          imageUrl: r.imageUrl || null,
          provider: r.provider || null,
          articleUrl: r.articleUrl || null,
          description: r.description || null,
          publishedAt: r.publishedAt || null,
          fetchedAt: r.fetchedAt || null,
          displayCategories: r.displayCategories || null,
          interestKeywords: r.interestKeywords || null,
          keywordMatches: (r.keywordMatches || []).map((m) => ({
            id: m.id,
            label: m.label,
            confidence: m.confidence,
          })),
          // Derive country/region from keywords for display (works even if DB columns don't exist yet)
          ...(() => {
            try {
              const { country_code, region } = deriveStoryRegion(r.interestKeywords || []);
              return { countryCode: country_code, region };
            } catch { return { countryCode: null, region: 'global' }; }
          })(),
        })));
        offset += stories.length;

        // If we got fewer than requested, we've reached the end
        if (stories.length < BATCH) break;
      }

      await usage.flush(env);

      return jsonResponse({
        validated: totalValidated,
        stored: totalStored,
        storeError: firstError,
        mismatches: allMismatches.map((m) => ({
          id: m.id,
          title: m.title,
          queryCategory: m.queryCategory,
          embeddingCategory: m.embeddingCategory,
          confidence: m.confidence,
          imageUrl: m.imageUrl || null,
          provider: m.provider || null,
          articleUrl: m.articleUrl || null,
          description: m.description || null,
          publishedAt: m.publishedAt || null,
          fetchedAt: m.fetchedAt || null,
          displayCategories: m.displayCategories || null,
          interestKeywords: m.interestKeywords || null,
          keywordMatches: (m.keywordMatches || []).map((k) => ({
            id: k.id,
            label: k.label,
            confidence: k.confidence,
          })),
        })),
        results: allResults,
      });
    } catch (err) {
      console.error('Category validation failed:', err);
      await usage.flush(env);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Validation failed' }, 502);
    }
  }

  if (url.pathname === '/admin/api/ads' && request.method === 'GET') {
    const category = url.searchParams.get('category') || 'all';
    const network = url.searchParams.get('network') || 'all';
    const query = url.searchParams.get('q') || '';
    const embedded = getAds({ category, network, query });
    // Include Awin ads from Supabase so the admin panel manages all inventory.
    let awinAds = [];
    if (env?.SUPABASE_URL && env?.SUPABASE_SECRET_KEY) {
      try {
        awinAds = await getAwinAds(env, { category, query });
        if (network && network !== 'all') {
          awinAds = awinAds.filter(a => a.network.toLowerCase() === network.toLowerCase());
        }
      } catch (err) {
        console.error('Admin Awin ads fetch failed:', err.message);
      }
    }
    const allAds = [...embedded, ...awinAds];
    // Attach keyword tags from ad_keyword_tags (best effort)
    try {
      const tagsRes = await fetch(
        supabaseUrl(env, 'ad_keyword_tags', new URLSearchParams({ select: 'ad_id,keywords' })),
        { headers: supabaseHeaders(env) }
      );
      if (tagsRes.ok) {
        const tagRows = await tagsRes.json().catch(() => []);
        const tagMap = {};
        for (const r of (Array.isArray(tagRows) ? tagRows : [])) {
          if (r.ad_id) tagMap[r.ad_id] = r.keywords || [];
        }
        for (const ad of allAds) {
          if (ad.id && tagMap[ad.id]) ad.keywords = tagMap[ad.id];
        }
      }
    } catch {
      // Tags are optional — ads work without them
    }
    return jsonResponse({ ads: allAds });
  }

  if (url.pathname === '/admin/api/ads' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Ad creation must be requested from the admin origin' }, 403);
    }
    try {
      const payload = await request.json().catch(() => ({}));
      const ad = createAd(payload);
      return jsonResponse({ id: ad.id, created: true, ad });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not create ad' }, 500);
    }
  }

  const adEditMatch = url.pathname.match(/^\/admin\/api\/ads\/([^/]+)$/);
  if (adEditMatch && (request.method === 'PATCH' || request.method === 'PUT')) {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Ad updates must be requested from the admin origin' }, 403);
    }
    try {
      const payload = await request.json().catch(() => ({}));
      const adId = decodeURIComponent(adEditMatch[1]);
      const updated = updateAd(adId, payload);
      if (!updated) return jsonResponse({ error: 'Ad was not found' }, 404);
      return jsonResponse({ id: adId, updated: true, ad: updated });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not update ad' }, 500);
    }
  }

  // Auto-tag ads with interest keywords using the embedding classifier.
  // POST /admin/api/ads/auto-tag { ads: [{id, title, description}], offset }
  // Processes 15 ads per invocation (15 AI calls, well under the 50 subrequest limit).
  // Client loops with offset until done=true.
  if (url.pathname === '/admin/api/ads/auto-tag' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Ad auto-tag must be requested from the admin origin' }, 403);
    }
    if (!env.AI) {
      return jsonResponse({ error: 'Workers AI not available' }, 503);
    }
    const usage = createAiUsageCounter();
    try {
      const payload = await request.json().catch(() => ({}));
      const ads = Array.isArray(payload.ads) ? payload.ads : [];
      const offset = Math.max(0, parseInt(payload.offset, 10) || 0);
      const CHUNK = 15;
      const batch = ads.slice(offset, offset + CHUNK);

      const keywordVectors = await getKeywordEmbeddings(env);
      if (!keywordVectors || keywordVectors.size === 0) {
        return jsonResponse({
          error: 'Keyword vectors not warmed up',
          warmupNeeded: true,
          done: false,
          progress: { done: offset, total: ads.length }
        }, 503);
      }

      const results = [];
      for (const ad of batch) {
        const text = `${ad.title || ''} ${ad.description || ''}`.trim();
        if (!text) {
          results.push({ id: ad.id, keywords: [] });
          continue;
        }
        try {
          const vector = await embedText(env, text);
          if (vector) usage.add(AI_USAGE_MODEL_BGE, 'ad-auto-tag', 1);
          else usage.add(AI_USAGE_MODEL_BGE, 'ad-auto-tag', 0, 1);
          const matches = classifyStoryKeywords(vector, keywordVectors);
          results.push({
            id: ad.id,
            keywords: matches.map(m => ({ id: m.id, label: m.label, confidence: m.confidence }))
          });
        } catch (err) {
          results.push({ id: ad.id, keywords: [], error: err.message });
        }
      }

      const newOffset = offset + batch.length;

      // Auto-save this chunk's tags so a crash doesn't lose progress.
      // Upsert by ad_id; empty keyword lists are saved too (marks as processed).
      try {
        const rows = results.map(r => ({
          ad_id: r.id,
          keywords: (r.keywords || []).map(k => k.id),
          updated_at: new Date().toISOString()
        }));
        if (rows.length > 0) {
          const upsertRes = await fetch(
            supabaseUrl(env, 'ad_keyword_tags', new URLSearchParams({ on_conflict: 'ad_id' })),
            {
              method: 'POST',
              headers: { ...supabaseHeaders(env), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
              body: JSON.stringify(rows)
            }
          );
          if (!upsertRes.ok) {
            console.error('ad_keyword_tags upsert failed:', upsertRes.status);
          }
        }
      } catch (saveErr) {
        console.error('ad_keyword_tags save error:', saveErr.message);
      }

      await usage.flush(env);
      return jsonResponse({
        results,
        done: newOffset >= ads.length,
        progress: { done: newOffset, total: ads.length }
      });
    } catch (err) {
      await usage.flush(env);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Auto-tag failed' }, 500);
    }
  }

  if (url.pathname === '/admin/api/awin/sync' && request.method === 'POST') {
    if (!isSameOrigin(request)) {
      return jsonResponse({ error: 'Awin sync must be requested from the admin origin' }, 403);
    }
    try {
      const limit = await env.SUMMARY_RATE_LIMITER.limit({ key: `admin:${identity.login}` });
      if (!limit.success) return jsonResponse({ error: 'Admin update rate limit exceeded' }, 429);
      const payload = await request.json().catch(() => ({}));
      const result = await syncAwin(env, {
        includeProducts: payload.includeProducts !== false,
        productLocale: payload.productLocale || 'en_US',
        maxPrograms: Math.min(Number(payload.maxPrograms) || 50, 100),
      });
      return jsonResponse(result);
    } catch (err) {
      console.error('Awin sync failed:', err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not sync Awin' }, 502);
    }
  }

  if (url.pathname === '/admin/api/awin/status' && request.method === 'GET') {
    try {
      const base = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/awin_sync_runs`;
      const params = new URLSearchParams({
        select: 'id,started_at,finished_at,status,steps,error',
        order: 'started_at.desc',
        limit: '5',
      });
      const res = await fetch(`${base}?${params}`, {
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        },
      });
      const runs = res.ok ? await res.json() : [];
      const countsRes = await fetch(
        `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/awin_programs?select=advertiser_id&enabled=eq.true`,
        {
          headers: {
            apikey: env.SUPABASE_SECRET_KEY,
            Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          },
        }
      );
      const programRows = countsRes.ok ? await countsRes.json().catch(() => []) : [];
      const programCount = Array.isArray(programRows) ? programRows.length : 0;
      return jsonResponse({ runs, programCount, configured: Boolean(env.AWIN_API_TOKEN) });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Could not load Awin status' }, 500);
    }
  }

  if (url.pathname === '/admin/api/awin/ads/bulk' && request.method === 'PATCH') {
    try {
      const body = await request.json();
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const category = String(body.category || '').trim();
      const enabled = body.enabled;
      if (!ids.length || (!category && typeof enabled !== 'boolean')) {
        return jsonResponse({ error: 'ids and category or enabled are required' }, 400);
      }
      const headers = {
        'apikey': env.SUPABASE_SECRET_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      };
      const base = env.SUPABASE_URL.replace(/\/$/, '');
      const patch = {};
      if (category) patch.category = category;
      if (typeof enabled === 'boolean') patch.enabled = enabled;
      let updated = 0;
      // Split into programs (awin-program-<advId>) and products (awin-product-<advId>:<prodId>)
      const programIds = [];
      const productIds = [];
      for (const id of ids) {
        const m = String(id).match(/^awin-(program|product)-(.+)$/);
        if (!m) continue;
        if (m[1] === 'program') programIds.push(m[2]);
        else productIds.push(m[2]);
      }
      if (programIds.length) {
        const res = await fetch(
          `${base}/rest/v1/awin_programs?advertiser_id=in.(${programIds.join(',')})`,
          { method: 'PATCH', headers, body: JSON.stringify(patch) }
        );
        if (!res.ok) throw new Error(`Program update failed (HTTP ${res.status})`);
        updated += programIds.length;
      }
      if (productIds.length) {
        // Products use text IDs like "53739:abc123" — batch in chunks of 50.
        for (let i = 0; i < productIds.length; i += 50) {
          const chunk = productIds.slice(i, i + 50);
          const orFilter = chunk.map(id => `id.eq.${encodeURIComponent(id)}`).join(',');
          const res = await fetch(
            `${base}/rest/v1/awin_products?or=(${orFilter})`,
            { method: 'PATCH', headers, body: JSON.stringify(patch) }
          );
          if (!res.ok) throw new Error(`Product update failed (HTTP ${res.status})`);
          updated += chunk.length;
        }
      }
      return jsonResponse({ ok: true, updated });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Bulk update failed' }, 500);
    }
  }

  if (url.pathname.startsWith('/admin/api/')) {
    return jsonResponse({ error: 'Admin API route not found' }, 404);
  }
  return jsonResponse({ error: 'Admin route not found' }, 404);
}

async function readAdminStoryPayload(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: 'Story details are too large' }, 413);
  }
  const bodyText = await request.text();
  if (bodyText.length > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: 'Story details are too large' }, 413);
  }
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return jsonResponse({ error: 'Story details must be valid JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse({ error: 'Story details must be an object' }, 400);
  }
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 500) : '';
  const link = typeof body.link === 'string' ? body.link.trim() : '';
  const image = typeof body.image === 'string' ? body.image.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 4_000) : '';
  const content = typeof body.content === 'string' ? body.content.trim().slice(0, 4_000) : '';
  const aiSummary = typeof body.aiSummary === 'string' ? body.aiSummary.trim().slice(0, 4_000) : '';
  const source = typeof body.source === 'string' ? body.source.trim().slice(0, 500) : '';
  const category = typeof body.category === 'string' ? body.category : '';
  const pubDate = typeof body.pubDate === 'string' ? body.pubDate.trim() : '';

  if (!title || title.length > 500) {
    return jsonResponse({ error: 'A title of 1-500 characters is required' }, 400);
  }
  if (!isPublicWebUrl(link) || link.length > 2_000) {
    return jsonResponse({ error: 'Enter a public HTTP or HTTPS article URL' }, 400);
  }
  if (image && (!isPublicWebUrl(image) || image.length > 2_000)) {
    return jsonResponse({ error: 'Image must be a public HTTP or HTTPS URL' }, 400);
  }
  if (!NEWS_CATEGORY_SET.has(category)) {
    return jsonResponse({ error: 'Select a valid story category' }, 400);
  }
  if (description.length > 4_000 || content.length > 4_000 || aiSummary.length > 4_000 || source.length > 500) {
    return jsonResponse({ error: 'A story field exceeds its maximum length' }, 400);
  }
  if (pubDate && !Number.isFinite(Date.parse(pubDate))) {
    return jsonResponse({ error: 'Enter a valid publication date' }, 400);
  }

  return {
    title,
    link: new URL(link).href,
    image: image ? new URL(image).href : '',
    description,
    content,
    aiSummary,
    pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
    source: source || new URL(link).hostname.replace(/^www\./i, ''),
    category
  };
}

function isPublicWebUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.includes(':')) return false;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:')
  ) return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (
      ipv4.slice(1).some(part => Number(part) > 255) ||
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) return false;
  }

  return true;
}

async function fetchPublicPage(value) {
  let currentUrl = value;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (!isPublicWebUrl(currentUrl)) throw new Error('The page URL is not allowed');
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
        'User-Agent': 'LittlablesSummaryBot/1.0'
      }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (!location || redirects === MAX_REDIRECTS) throw new Error('Too many redirects while loading an article');
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    if (!response.ok) throw new Error(`Article page request failed (HTTP ${response.status})`);

    const contentType = response.headers.get('Content-Type') || '';
    if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
      throw new Error('Article URL did not return readable text');
    }
    const contentLength = Number(response.headers.get('Content-Length') || 0);
    if (contentLength > MAX_PAGE_BYTES) throw new Error('Article page is too large');

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Article page had no readable response body');
    const chunks = [];
    let byteCount = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      byteCount += chunk.byteLength;
      if (byteCount > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new Error('Article page is too large');
      }
      chunks.push(chunk);
    }

    const bytes = new Uint8Array(byteCount);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { url: currentUrl, content: new TextDecoder().decode(bytes) };
  }
  throw new Error('Could not load article page');
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => decodeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => decodeCodePoint(parseInt(code, 16)));
}

function decodeCodePoint(codePoint) {
  return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\ufffd';
}

function getHtmlAttributes(tag) {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function extractPageMetadata(html, pageUrl) {
  const metadata = new Map();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = getHtmlAttributes(match[0]);
    const name = (attributes.get('property') || attributes.get('name') || '').toLowerCase();
    const content = attributes.get('content');
    if (name && content && !metadata.has(name)) metadata.set(name, decodeHtml(content).trim());
  }
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = metadata.get('og:title') ||
    metadata.get('twitter:title') ||
    (titleTag ? extractPageText(titleTag[1]) : '');
  const description = metadata.get('og:description') ||
    metadata.get('twitter:description') ||
    metadata.get('description') ||
    '';
  const imageValue = metadata.get('og:image') || metadata.get('twitter:image') || '';
  let image = '';
  try {
    const candidate = new URL(imageValue, pageUrl).href;
    if (isPublicWebUrl(candidate)) image = candidate;
  } catch {}
  const publishedAt = metadata.get('article:published_time') ||
    metadata.get('og:published_time') ||
    metadata.get('date') ||
    '';
  return {
    title: title.slice(0, 500),
    description: description.slice(0, 2_000),
    image,
    link: pageUrl,
    source: new URL(pageUrl).hostname.replace(/^www\./i, ''),
    pubDate: Number.isFinite(Date.parse(publishedAt)) ? new Date(publishedAt).toISOString() : ''
  };
}

function extractPageText(html) {
  const text = decodeHtml(html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(p|div|article|section|li|h[1-6]|br|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, MAX_PAGE_TEXT);
}

function isReadableArticleText(text) {
  return text.length >= 120 &&
    !/\b(?:enable javascript|verify you are human|access denied|request blocked|checking your browser|robot or human)\b/i.test(text);
}

async function generateAdminSummary(story, env, usage = null) {
  const suppliedText = [story.description, story.content]
    .map(value => extractPageText(decodeHtml(value)))
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_PAGE_TEXT);
  let articleText = '';
  try {
    const page = await fetchPublicPage(story.link);
    const scrapedText = extractPageText(page.content);
    if (isReadableArticleText(scrapedText)) articleText = scrapedText;
  } catch (err) {
    console.warn(`Could not scrape article while preparing admin summary ${story.link}:`, err);
  }
  const summarySourceText = [
    suppliedText ? `Current edited story details:\n${suppliedText}` : '',
    articleText ? `Scraped article content:\n${articleText}` : ''
  ].filter(Boolean).join('\n\n').slice(0, MAX_PAGE_TEXT);
  if (summarySourceText.replace(/\s+/g, ' ').trim().length < 40) {
    throw new Error('Add more story description or source content before generating a summary');
  }

  let generated;
  try {
    generated = await env.AI.run(MODEL, {
      messages: [
        {
          role: 'system',
          content: 'Write one accurate, neutral paragraph summarizing the supplied news article. Use only facts in the provided material. Do not add a headline, preamble, bullets, or unsupported claims.'
        },
        {
          role: 'user',
          content: `Article title: ${story.title}\nPublisher: ${story.source}\n\nCurrent article URL: ${story.link}\n\n${summarySourceText}`
        }
      ],
      max_tokens: 220,
      temperature: 0.2
    });
    if (usage) usage.add(AI_USAGE_MODEL_LLAMA, 'summaries', 1);
  } catch (err) {
    if (usage) usage.add(AI_USAGE_MODEL_LLAMA, 'summaries', 0, 1);
    console.error('Workers AI summary generation failed:', err);
    const details = err instanceof Error ? `: ${err.message.slice(0, 250)}` : '';
    throw new Error(`Workers AI could not generate the summary${details}`);
  }
  const summary = typeof generated?.response === 'string'
    ? generated.response.trim().replace(/\s*\n+\s*/g, ' ')
    : '';
  if (!summary) throw new Error('Workers AI returned an empty summary. Try again or revise the story details.');
  return summary.slice(0, 4_000);
}

function base64ToBytes(base64) {
  const clean = base64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function detectImageContentType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

function createImageResponse({ bytes, contentType }) {
  return new Response(bytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function rememberGeneratedImage(cacheKey, generated) {
  if (imageMemoryCache.has(cacheKey)) {
    imageMemoryCache.delete(cacheKey);
  } else if (imageMemoryCache.size >= MAX_IMAGE_CACHE_ENTRIES) {
    const oldestKey = imageMemoryCache.keys().next().value;
    if (oldestKey) imageMemoryCache.delete(oldestKey);
  }
  imageMemoryCache.set(cacheKey, generated);
}

async function putImageInEdgeCache(cacheKey, generated) {
  try {
    if (typeof caches !== 'undefined' && caches?.default) {
      await caches.default.put(cacheKey, createImageResponse(generated));
    }
  } catch (err) {
    console.warn('Could not store generated image in edge cache:', err);
  }
}

async function matchImageFromEdgeCache(cacheKey) {
  try {
    if (typeof caches !== 'undefined' && caches?.default) {
      const matched = await caches.default.match(cacheKey);
      if (matched) return matched;
    }
  } catch (err) {
    console.warn('Could not read generated image from edge cache:', err);
  }
  return null;
}

async function buildLittlablesImagePrompt(story, env, usage = null) {
  const suppliedText = [story.aiSummary, story.description, story.content]
    .map(value => extractPageText(decodeHtml(value || '')))
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2_000);

  let articleExcerpt = '';
  if (suppliedText.length < 120 && story.link) {
    try {
      const page = await fetchPublicPage(story.link);
      const scrapedText = extractPageText(page.content);
      if (isReadableArticleText(scrapedText)) {
        articleExcerpt = scrapedText.slice(0, 1_500);
      }
    } catch (err) {
      console.warn(`Could not scrape article while preparing admin AI image ${story.link}:`, err);
    }
  }

  const storyDetails = [
    `Title: ${story.title}`,
    story.category && story.category !== 'all' ? `Category: ${story.category}` : '',
    suppliedText ? `Story details: ${suppliedText}` : '',
    articleExcerpt ? `Article excerpt: ${articleExcerpt}` : ''
  ].filter(Boolean).join('\n');

  let sceneDescription = '';
  try {
    const generated = await env.AI.run(MODEL, {
      messages: [
        {
          role: 'system',
          content: 'Create a fun image prompt based around the provided story details that fits the theme of Littlables (a joyful, cozy, family-friendly, whimsical storybook news and discovery platform). Describe one charming, colorful visual scene inspired by the story details. Do not include any text, words, letters, logos, or watermarks in the image description. Output only the scene description in 1-2 sentences.'
        },
        {
          role: 'user',
          content: `Create a fun image based around these story details that fit the theme of Littlables:\n\n${storyDetails}`
        }
      ],
      max_tokens: 120,
      temperature: 0.6
    });
    if (usage) usage.add(AI_USAGE_MODEL_LLAMA, 'scene', 1);
    if (typeof generated?.response === 'string') {
      sceneDescription = generated.response.trim().replace(/\s*\n+\s*/g, ' ').slice(0, 320);
    }
  } catch (err) {
    if (usage) usage.add(AI_USAGE_MODEL_LLAMA, 'scene', 0, 1);
    console.warn('Could not refine image prompt with LLM, using story details directly:', err);
  }

  const fallbackDetails = [story.title, suppliedText.slice(0, 180)].filter(Boolean).join(' — ');
  const coreScene = sceneDescription || fallbackDetails;

  return `Create a fun image based around the story details that fit the theme of Littlables: ${coreScene}. Whimsical, warm, colorful family-friendly storybook illustration, cozy and uplifting Littlables aesthetic, charming characters and scenery, soft lighting, no text, no words, no watermarks.`.slice(0, 650);
}

async function runWorkersAiImageModel(prompt, seed, env, usage = null) {
  let rawResult;
  try {
    rawResult = await env.AI.run(IMAGE_MODEL, {
      prompt,
      num_steps: 8,
      ...(Number.isFinite(seed) ? { seed } : {})
    });
    if (usage) usage.add(AI_USAGE_MODEL_FLUX, 'image', 1);
  } catch (primaryErr) {
    if (usage) usage.add(AI_USAGE_MODEL_FLUX, 'image', 0, 1);
    console.warn(`Primary image model (${IMAGE_MODEL}) failed, trying fallback:`, primaryErr);
    try {
      rawResult = await env.AI.run(FALLBACK_IMAGE_MODEL, {
        prompt,
        ...(Number.isFinite(seed) ? { seed } : {})
      });
      if (usage) usage.add(AI_USAGE_MODEL_SDXL, 'image', 1);
    } catch {
      if (usage) usage.add(AI_USAGE_MODEL_SDXL, 'image', 0, 1);
      console.error('Workers AI image generation failed:', primaryErr);
      const details = primaryErr instanceof Error ? `: ${primaryErr.message.slice(0, 250)}` : '';
      throw new Error(`Workers AI could not generate the image${details}`);
    }
  }

  let bytes;
  if (rawResult && typeof rawResult === 'object' && typeof rawResult.image === 'string' && rawResult.image.trim()) {
    bytes = base64ToBytes(rawResult.image);
  } else if (rawResult instanceof Uint8Array) {
    bytes = rawResult;
  } else if (rawResult instanceof ArrayBuffer) {
    bytes = new Uint8Array(rawResult);
  } else if (rawResult && (typeof rawResult.getReader === 'function' || (typeof ReadableStream !== 'undefined' && rawResult instanceof ReadableStream))) {
    const ab = await new Response(rawResult).arrayBuffer();
    bytes = new Uint8Array(ab);
  } else {
    throw new Error('Workers AI returned an empty or unsupported image payload.');
  }

  if (!bytes || bytes.byteLength === 0) {
    throw new Error('Workers AI returned an empty image.');
  }

  return {
    bytes,
    contentType: detectImageContentType(bytes)
  };
}

async function generateAdminStoryImage(story, requestUrl, env, usage = null) {
  const prompt = await buildLittlablesImagePrompt(story, env, usage);
  const seed = Math.floor(Math.random() * 1_000_000);
  const generated = await runWorkersAiImageModel(prompt, seed, env, usage);

  const imageUrlObj = new URL('/ai-image', requestUrl);
  imageUrlObj.searchParams.set('prompt', prompt);
  imageUrlObj.searchParams.set('seed', String(seed));
  const imageUrl = imageUrlObj.href;

  rememberGeneratedImage(imageUrl, generated);
  await putImageInEdgeCache(imageUrl, generated);

  return {
    image: imageUrl,
    prompt
  };
}

async function serveAiStoryImage(request, env) {
  const url = new URL(request.url);
  const prompt = (url.searchParams.get('prompt') || '').trim();
  if (!prompt || prompt.length > 1_000) {
    return jsonResponse({ error: 'A valid image prompt is required' }, 400);
  }
  const seedParam = Number(url.searchParams.get('seed'));
  const seed = Number.isInteger(seedParam) && seedParam >= 0 ? seedParam : 0;

  const cacheKey = url.href;
  const memCached = imageMemoryCache.get(cacheKey);
  if (memCached) {
    return createImageResponse(memCached);
  }

  const edgeCached = await matchImageFromEdgeCache(cacheKey);
  if (edgeCached) {
    return edgeCached;
  }

  if (!env.AI) {
    return jsonResponse({ error: 'Workers AI is not configured for this Worker' }, 503);
  }
  if (env.SUMMARY_RATE_LIMITER) {
    const limit = await env.SUMMARY_RATE_LIMITER.limit({
      key: `ai-image:${request.headers.get('CF-Connecting-IP') || 'unknown'}`
    });
    if (!limit.success) {
      return jsonResponse({ error: 'AI image request rate limit exceeded' }, 429);
    }
  }

  const usage = createAiUsageCounter();
  try {
    const generated = await runWorkersAiImageModel(prompt, seed, env, usage);
    rememberGeneratedImage(cacheKey, generated);
    await putImageInEdgeCache(cacheKey, generated);
    await usage.flush(env);
    return createImageResponse(generated);
  } catch (err) {
    console.error('Public AI story image generation failed:', err);
    await usage.flush(env);
    return jsonResponse({
      error: err instanceof Error ? err.message : 'Unable to generate story image'
    }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      const cors = getCorsHeaders(request);
      return new Response(null, { status: 204, headers: Object.keys(cors).length > 0 ? cors : corsHeaders });
    }
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      const resp = await serveAdmin(request, env);
      // Add CORS headers for frontend admin editing (GitHub session via credentials:include)
      const cors = getCorsHeaders(request);
      if (Object.keys(cors).length > 0) {
        const headers = new Headers(resp.headers);
        for (const [k, v] of Object.entries(cors)) headers.set(k, v);
        return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
      }
      return resp;
    }
    if (request.method === 'GET' && pathname === '/ai-image') {
      return serveAiStoryImage(request, env);
    }
    if (request.method === 'GET' && (pathname === '/space' || pathname === '/feed')) {
      if (
        (url.searchParams.get('auto_sync') === '1' || env?.AUTO_SYNC_ON_FEED === 'true') &&
        ctx &&
        typeof ctx.waitUntil === 'function'
      ) {
        const autoState = getAutoSyncState();
        if (autoState.enabled && autoState.isStale) {
          ctx.waitUntil(runHourlyAutoSync(env, 'stale_check', 'feed-stale-check'));
        }
      }
      return serveNewsFeed(request, env, ctx);
    }
    if (request.method === 'GET' && pathname === '/api/interest') {
      try {
        const ids = (url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 30);
        if (ids.length === 0) {
          return jsonResponse({ items: [], count: 0, error: 'missing ids' }, 400);
        }
        const feed = await getStoriesByInterests(env, ids);
        return jsonResponse({ items: feed.items, count: feed.items.length });
      } catch (err) {
        return jsonResponse({ items: [], count: 0, error: err.message }, 500);
      }
    }
    // Taste Reader step 2: manual selection run for the gated site page.
    // Site auth (Supabase token + profiles.is_admin), not the GitHub admin
    // session: the site is cross-origin and the page is not /admin.
    if (request.method === 'POST' && pathname === '/api/taste-reader/run') {
      try {
        if (env.SUMMARY_RATE_LIMITER) {
          const limit = await env.SUMMARY_RATE_LIMITER.limit({
            key: `taste-reader:${request.headers.get('CF-Connecting-IP') || 'unknown'}`
          });
          if (!limit.success) return jsonResponse({ error: 'Taste Reader rate limit exceeded; try again shortly' }, 429);
        }
        const auth = await verifyTasteReaderAdmin(env, request);
        if (auth.error) return jsonResponse({ error: auth.error }, auth.status);
        const payload = await request.json().catch(() => ({}));
        const interestFilter = typeof payload.interestFilter === 'string' && payload.interestFilter.trim()
          ? payload.interestFilter.trim()
          : null;
        const result = await createTasteReaderRun(env, { userId: auth.userId, interestFilter });
        if (result.error) return jsonResponse({ error: result.error }, 400);
        return jsonResponse({
          ok: true,
          runId: result.runId,
          totalCount: result.totalCount,
          nextPosition: result.nextPosition,
          items: result.items
        });
      } catch (err) {
        console.error('Taste Reader run failed:', err);
        return jsonResponse({
          error: err instanceof Error ? err.message : 'Could not run Taste Reader'
        }, 502);
      }
    }

    // Taste Reader reader actions: word scores + notes + AI reason.
    // Same site auth as /api/taste-reader/run (Supabase token +
    // profiles.is_admin), same rate limiter, no GitHub session.
    if (request.method === 'POST' && pathname === '/api/taste-reader/score') {
      try {
        if (env.SUMMARY_RATE_LIMITER) {
          const limit = await env.SUMMARY_RATE_LIMITER.limit({
            key: `taste-reader:${request.headers.get('CF-Connecting-IP') || 'unknown'}`
          });
          if (!limit.success) return jsonResponse({ error: 'Taste Reader rate limit exceeded; try again shortly' }, 429);
        }
        const auth = await verifyTasteReaderAdmin(env, request);
        if (auth.error) return jsonResponse({ error: auth.error }, auth.status);
        const payload = await request.json().catch(() => ({}));
        const result = await recordTasteReaderWordScore(env, {
          userId: auth.userId,
          contentId: payload.contentId,
          runId: payload.runId,
          wordDisplay: payload.wordDisplay,
          source: payload.source,
          wordPosition: payload.wordPosition,
          action: payload.action
        });
        if (result.error) return jsonResponse({ error: result.error }, 400);
        return jsonResponse(result);
      } catch (err) {
        console.error('Taste Reader score failed:', err);
        return jsonResponse({ error: err instanceof Error ? err.message : 'Could not save the word score' }, 502);
      }
    }

    if (request.method === 'POST' && pathname === '/api/taste-reader/note') {
      try {
        if (env.SUMMARY_RATE_LIMITER) {
          const limit = await env.SUMMARY_RATE_LIMITER.limit({
            key: `taste-reader:${request.headers.get('CF-Connecting-IP') || 'unknown'}`
          });
          if (!limit.success) return jsonResponse({ error: 'Taste Reader rate limit exceeded; try again shortly' }, 429);
        }
        const auth = await verifyTasteReaderAdmin(env, request);
        if (auth.error) return jsonResponse({ error: auth.error }, auth.status);
        const payload = await request.json().catch(() => ({}));
        const result = await saveTasteReaderNote(env, {
          userId: auth.userId,
          contentId: payload.contentId,
          runId: payload.runId,
          kind: payload.kind,
          body: payload.body,
          actionContext: payload.actionContext,
          stoppedWordNormalized: payload.stoppedWordNormalized,
          stoppedPosition: payload.stoppedPosition,
          aiModel: payload.aiModel
        });
        if (result.error) return jsonResponse({ error: result.error }, 400);
        return jsonResponse(result);
      } catch (err) {
        console.error('Taste Reader note failed:', err);
        return jsonResponse({ error: err instanceof Error ? err.message : 'Could not save the note' }, 502);
      }
    }

    if (request.method === 'POST' && pathname === '/api/taste-reader/reason') {
      try {
        if (env.SUMMARY_RATE_LIMITER) {
          const limit = await env.SUMMARY_RATE_LIMITER.limit({
            key: `taste-reader:${request.headers.get('CF-Connecting-IP') || 'unknown'}`
          });
          if (!limit.success) return jsonResponse({ error: 'Taste Reader rate limit exceeded; try again shortly' }, 429);
        }
        const auth = await verifyTasteReaderAdmin(env, request);
        if (auth.error) return jsonResponse({ error: auth.error }, auth.status);
        if (!env.AI) return jsonResponse({ error: 'Workers AI is not configured for this Worker' }, 503);
        const payload = await request.json().catch(() => ({}));
        const title = typeof payload.title === 'string' ? payload.title : '';
        const description = typeof payload.description === 'string' ? payload.description : '';
        if (!title && !description) return jsonResponse({ error: 'A title or description is required' }, 400);
        const usage = createAiUsageCounter();
        const model = '@cf/meta/llama-3.2-3b-instruct';
        let aiRes;
        try {
          aiRes = await env.AI.run(model, {
            messages: [
              { role: 'system', content: 'You write short reasons a careful editor of a family-friendly news site might NOT like a story. Be specific to this story, one sentence, plain language, no preamble, no quotes.' },
              { role: 'user', content: `Title: ${title}\nDescription: ${description.slice(0, 1200)}` }
            ],
            max_tokens: 120,
            temperature: 0.3
          });
          usage.add(AI_USAGE_MODEL_LLAMA, 'taste-reader-reason', 1);
          await usage.flush(env);
        } catch (err) {
          usage.add(AI_USAGE_MODEL_LLAMA, 'taste-reader-reason', 0, 1);
          await usage.flush(env);
          throw err;
        }
        const reason = extractAiText(aiRes).trim();
        if (!reason) return jsonResponse({ error: 'The AI came back empty; try again' }, 502);
        return jsonResponse({ ok: true, reason, model });
      } catch (err) {
        console.error('Taste Reader reason failed:', err);
        return jsonResponse({ error: err instanceof Error ? err.message : 'Could not generate a reason' }, 502);
      }
    }

    // Phase 2 preview: admin-only space feed sample + diagnostics.
    // GitHub admin session required (same auth as /admin/api/*).
    if (request.method === 'GET' && pathname === '/api/admin/preview') {
      try {
        const identity = await getAdminIdentity(request, env);
        if (!identity) return jsonResponse({ error: 'GitHub authentication is required' }, 401);
        const space = (url.searchParams.get('space') || '').trim();
        if (!space) return jsonResponse({ error: 'Missing ?space= parameter' }, 400);
        const preview = await getSpaceFeedPreview(env, space);
        if (preview.error) return jsonResponse(preview, 400);
        return jsonResponse(preview);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Preview failed' }, 500);
      }
    }
    if (request.method === 'GET' && pathname === '/api/playroom') {
      try {
        const playroomId = (url.searchParams.get('id') || '').trim() || null;
        const username = (url.searchParams.get('username') || '').trim() || null;
        const slug = (url.searchParams.get('slug') || '').trim() || null;
        const spaceId = (url.searchParams.get('space') || '').trim() || null;
        if (!playroomId && !(username && slug)) {
          return jsonResponse({ playroom: null, spaces: [], items: [], error: 'missing id or username+slug' }, 400);
        }
        const feed = await getPlayroomFeed(env, playroomId, spaceId, username, slug);
        return jsonResponse({ playroom: feed.playroom, spaces: feed.spaces, items: feed.items, count: feed.items.length });
      } catch (err) {
        return jsonResponse({ playroom: null, spaces: [], items: [], error: err.message }, 500);
      }
    }
    if ((request.method === 'POST' || request.method === 'GET') && pathname === '/api/space/emoji') {
      try {
        if (env.SUMMARY_RATE_LIMITER) {
          const limit = await env.SUMMARY_RATE_LIMITER.limit({
            key: `space-emoji:${request.headers.get('CF-Connecting-IP') || 'unknown'}`
          });
          if (!limit.success) {
            return jsonResponse({ emoji: '✨', matches: [], error: 'Rate limit exceeded' }, 429);
          }
        }
        let name = '';
        let description = '';
        let slug = '';
        let pills = [];
        if (request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          name = String(body.name || '').trim();
          description = String(body.description || '').trim();
          slug = String(body.slug || '').trim();
          pills = Array.isArray(body.pills) ? body.pills : [];
        } else {
          name = (url.searchParams.get('name') || '').trim();
          description = (url.searchParams.get('description') || '').trim();
          slug = (url.searchParams.get('slug') || '').trim();
        }

        const selectedKeywordIds = new Set();
        const customTexts = [];
        for (const p of pills) {
          if (!p || !p.id || p.id === 'all') continue;
          if (p.type === 'keyword') {
            selectedKeywordIds.add(String(p.id).trim());
          } else if (p.type === 'custom') {
            if (p.label) customTexts.push(String(p.label).trim());
            if (p.keywords) customTexts.push(String(p.keywords).trim());
          } else if (p.type === 'category') {
            customTexts.push(String(p.id).trim());
          }
        }

        const textParts = [name, description, customTexts.join(', '), slug.replace(/[-_]/g, ' ')].filter(Boolean);
        const queryText = textParts.join('. ').slice(0, 1000);

        const persisted = await getPersistedKeywordEmbeddings(env);
        const keywordVectors = persisted?.vectors || (await getKeywordEmbeddings(env));
        const textVector = queryText && env?.AI ? await embedText(env, queryText) : null;

        if (!keywordVectors || keywordVectors.size === 0) {
          return jsonResponse({ emoji: '✨', matches: [] }, 200);
        }

        // Compute combined target vector from text embedding + selected keyword embeddings
        let targetVector = null;
        if (textVector && Array.isArray(textVector)) {
          targetVector = [...textVector];
        }
        const selectedVectors = [];
        for (const kwId of selectedKeywordIds) {
          const vec = keywordVectors.get(kwId);
          if (Array.isArray(vec) && vec.length > 0) selectedVectors.push(vec);
        }
        if (selectedVectors.length > 0) {
          const dim = selectedVectors[0].length;
          const tagCentroid = new Array(dim).fill(0);
          for (const vec of selectedVectors) {
            for (let i = 0; i < dim; i++) tagCentroid[i] += vec[i] / selectedVectors.length;
          }
          if (targetVector && targetVector.length === dim) {
            for (let i = 0; i < dim; i++) {
              targetVector[i] = targetVector[i] * 0.65 + tagCentroid[i] * 0.35;
            }
          } else {
            targetVector = tagCentroid;
          }
        }

        if (!targetVector) {
          return jsonResponse({ emoji: '✨', matches: [] }, 200);
        }

        const byEmoji = new Map();
        for (const kw of INTEREST_KEYWORDS) {
          const kwVec = keywordVectors.get(kw.id);
          if (!kwVec) continue;
          let sim = cosineSimilarity(targetVector, kwVec);
          if (selectedKeywordIds.has(kw.id)) {
            sim += 0.08;
          }
          if (kw.id.endsWith('-general')) {
            sim *= 0.94;
          }
          const confidence = Math.round(sim * 10000) / 10000;
          const prev = byEmoji.get(kw.icon);
          if (!prev || confidence > prev.confidence) {
            byEmoji.set(kw.icon, {
              emoji: kw.icon,
              id: kw.id,
              label: kw.label,
              group: kw.group,
              confidence
            });
          }
        }

        const matches = [...byEmoji.values()]
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 12);

        return jsonResponse({
          emoji: matches[0]?.emoji || '✨',
          matches
        });
      } catch (err) {
        return jsonResponse({ emoji: '✨', matches: [], error: err.message }, 200);
      }
    }
    if (request.method === 'POST' && pathname === '/api/engagement') {
      return handleEngagementEvent(request, env);
    }
    if (request.method === 'POST' && (pathname === '/api/analytics/space' || pathname === '/api/analytics/board')) {
      return handleBoardEvent(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/ad-engagement') {
      return handleAdEvent(request, env);
    }
    // Public: all ad keyword tags at once. Frontend merges by ad_id client-side.
    // Small payload (~200 rows), cacheable.
    if (request.method === 'GET' && pathname === '/ads/tags') {
      try {
        const params = new URLSearchParams({ select: 'ad_id,keywords,updated_at' });
        // Optional: ?keywords=dinosaurs,toys — only return ads matching any of these.
        // Uses PostgREST array overlap. Omit for all tags.
        const kwFilter = (url.searchParams.get('keywords') || '').trim();
        if (kwFilter) {
          const ids = kwFilter.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
          if (ids.length > 0) {
            params.set('keywords', `ov.{${ids.join(',')}}`);
          }
        }
        const res = await fetch(
          supabaseUrl(env, 'ad_keyword_tags', params),
          { headers: supabaseHeaders(env) }
        );
        if (!res.ok) throw new Error('tags fetch failed: ' + res.status);
        const rows = await res.json();
        const tags = {};
        for (const r of (Array.isArray(rows) ? rows : [])) {
          if (r.ad_id) tags[r.ad_id] = r.keywords || [];
        }
        return jsonResponse({ tags, count: Object.keys(tags).length });
      } catch (err) {
        return jsonResponse({ tags: {}, count: 0, error: err.message });
      }
    }
    // POST /ads/tags-for-stories — classify untagged stories on-demand, then
    // return ad tags matching any of the stories' keywords.
    // Body: { stories: [{title, description, keywords?}] }
    // For stories without keywords, runs the embedding classifier (1 AI call each).
    // Then queries ad tags with array overlap. Keeps total subrequests low by
    // batching: N embeddings + 1 Supabase query.
    // POST /ads/match — match ads to stories server-side.
    // Body: { stories: [{title, description, keywords?}] }
    // Classifies untagged stories via embeddings, queries ad_keyword_tags,
    // ranks via matchAdsToStory, returns ranked ad IDs per story index.
    // Frontend looks up ad content by ID from its JSON cache.
    // Response: { matches: { [storyIndex]: [adId, ...] } }
    if (request.method === 'POST' && pathname === '/ads/match') {
      const usage = createAiUsageCounter();
      try {
        if (!env.AI) throw new Error('Workers AI not available');
        if (env.SUMMARY_RATE_LIMITER) {
          const limit = await env.SUMMARY_RATE_LIMITER.limit({
            key: `ads-match:${request.headers.get('CF-Connecting-IP') || 'unknown'}`
          });
          if (!limit.success) {
            return jsonResponse({ matches: {}, error: 'Rate limit exceeded' }, 429);
          }
        }
        const body = await request.json().catch(() => ({}));
        const stories = Array.isArray(body.stories) ? body.stories.slice(0, 20) : [];
        if (!stories.length) return jsonResponse({ matches: {} });

        const keywordVectors = await getKeywordEmbeddings(env);
        const storyKeywords = [];
        const storyVectors = [];
        for (const s of stories) {
          const existing = s.keywords || s.interest_keywords || s.interestKeywords || [];
          if (Array.isArray(existing) && existing.length > 0) {
            const kws = existing.filter(k => typeof k === 'string');
            storyKeywords.push(kws);
            storyVectors.push(null);
          } else {
            const text = ((s.title || '') + ' ' + (s.description || '')).trim();
            const kws = [];
            let storyVector = null;
            if (text) {
              try {
                storyVector = await embedText(env, text);
                if (storyVector) usage.add(AI_USAGE_MODEL_BGE, 'ad-match', 1);
                else usage.add(AI_USAGE_MODEL_BGE, 'ad-match', 0, 1);
                const matches = classifyStoryKeywords(storyVector, keywordVectors);
                for (const m of matches) {
                  kws.push(m.id);
                }
              } catch {
                // Skip stories that fail to classify
              }
            }
            storyKeywords.push(kws);
            storyVectors.push(storyVector);
          }
        }

        const params = new URLSearchParams({ select: 'ad_id,keywords' });
        // Fetch the complete tag catalog so a slot with no exact overlap can
        // still fall back to the semantically closest tagged ad.
        const res = await fetch(
          supabaseUrl(env, 'ad_keyword_tags', params),
          { headers: supabaseHeaders(env) }
        );
        const rows = res.ok ? await res.json() : [];

        const ads = (Array.isArray(rows) ? rows : [])
          .filter(r => r.ad_id)
          .map(r => ({ id: r.ad_id, keywords: r.keywords || [] }));

        const { EXCLUDED_KEYWORD_IDS } = await import('./interest-keywords.mjs');
        const matches = {};
        stories.forEach((s, idx) => {
          const kws = storyKeywords[idx];
          const ranked = matchAdsToStory(
            { interest_keywords: kws },
            ads,
            { excludedKeywordIds: EXCLUDED_KEYWORD_IDS }
          );
          let rankedIds = ranked.map(a => a.id);

          if (rankedIds.length === 0) {
            // When no tags overlap, rank ads by the closest available interest
            // embedding. For already-tagged stories, use the mean of their
            // interest vectors as the story representation.
            let targetVector = storyVectors[idx];
            if (!targetVector && Array.isArray(kws) && kws.length > 0) {
              const vectors = kws
                .filter(id => !EXCLUDED_KEYWORD_IDS.has(id))
                .map(id => keywordVectors.get(id))
                .filter(Boolean);
              if (vectors.length > 0) {
                targetVector = vectors[0].map((_, dimension) =>
                  vectors.reduce((sum, vector) => sum + vector[dimension], 0) / vectors.length
                );
              }
            }

            if (targetVector) {
              rankedIds = rankAdsByEmbeddingSimilarity(targetVector, ads, keywordVectors, {
                excludedKeywordIds: EXCLUDED_KEYWORD_IDS,
              }).map(ad => ad.id);
            }
          }

          if (rankedIds.length === 0) {
            // Last-resort closest available catalog: prefer the story's
            // category, then use the full catalog if that category is empty.
            const category = NEWS_CATEGORY_SET.has(String(s.category || '').toLowerCase())
              ? String(s.category).toLowerCase()
              : 'all';
            const categoryAds = getAds({ category });
            const fallbackAds = categoryAds.length > 0 ? categoryAds : getAds({ category: 'all' });
            rankedIds = fallbackAds.map(ad => ad.id);
          }

          if (rankedIds.length > 0) {
            // Use the frontend's original story index when provided
            const key = s._index != null ? s._index : idx;
            matches[key] = rankedIds;
          }
        });

        await usage.flush(env);
        return jsonResponse({ matches });
      } catch (err) {
        await usage.flush(env);
        return jsonResponse({ matches: {}, error: err.message });
      }
    }
    if (request.method === 'GET' && pathname === '/ads') {
      const category = (url.searchParams.get('category') || 'all').trim();
      const query = (url.searchParams.get('q') || url.searchParams.get('topic') || '').trim();
      const network = (url.searchParams.get('network') || 'all').trim();
      const isStandardCategory = NEWS_CATEGORY_SET.has(category.toLowerCase());
      const effectiveCategory = isStandardCategory ? category.toLowerCase() : 'all';
      const effectiveQuery = query || (!isStandardCategory ? category : '');
      const embedded = getAds({ category: effectiveCategory, query: effectiveQuery });
      // Merge Awin ads from Supabase (best effort — never break the endpoint).
      // network=awin returns only Awin ads; otherwise they're appended.
      const wantOnlyAwin = network.toLowerCase() === 'awin';
      let awinAds = [];
      if (env?.SUPABASE_URL && env?.SUPABASE_SECRET_KEY && (wantOnlyAwin
        || (network.toLowerCase() !== 'gumroad' && network.toLowerCase() !== 'amazon'
          && network.toLowerCase() !== 'tiktok'))) {
        try {
          // Admin panel sees hidden ads too (includeDisabled: true).
          awinAds = await getAwinAds(env, { category: effectiveCategory, query: effectiveQuery, includeDisabled: true });
        } catch (err) {
          console.error('Awin ads fetch failed:', err.message);
        }
      }
      const allAds = wantOnlyAwin ? awinAds : [...embedded, ...awinAds];
      // Log ad searches too (fire-and-forget). Skipped for internal traffic.
      if (effectiveQuery && ctx?.waitUntil && !isInternalRequest(request)) {
        ctx.waitUntil(recordSearchQuery(env, {
          query: effectiveQuery,
          resultCount: allAds.length,
          country_code: request.cf?.country || null,
        }));
      }
      return jsonResponse({ ads: allAds });
    }
    return jsonResponse({ error: 'Route not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    if (env?.AUTO_SYNC_ENABLED === 'false') {
      console.info('Provider auto-sync skipped via AUTO_SYNC_ENABLED=false');
      return;
    }
    const cronPattern = event?.cron || '0 * * * *';
    // Drain due retry jobs first (same provider retried after cooldown),
    // then run the normal sync. Sequential to stay under the subrequest budget.
    const task = (async () => {
      // Prune logs older than 30 days (1 cheap indexed delete per run)
      await pruneOldProviderLogs(env);
      // Phase 1: persisted cooldowns were previously never reloaded (the
      // loader had no callers), so a cold-started worker re-hammered cooling
      // providers. Load them before the drain and the sweep read them.
      await loadProviderCooldownsFromDbIfStale(env);
      // Drain deeper when the queue is deep, instead of a fixed 6 per run.
      const pendingRetries = await countQueuedRetries(env);
      const drainLimit = pendingRetries > 6 ? 12 : 6;
      const drainResult = await drainProviderRetries(env, { limit: drainLimit, triggerSource: 'cron:retry' });
      const isStaggered = cronPattern.includes('*/10') || cronPattern.includes('*/5');
      const syncResult = isStaggered
        ? await runStaggeredSync(env, 'cron', `cron:${cronPattern}`)
        : await runHourlyAutoSync(env, 'cron', `cron:${cronPattern}`);
      return { drainResult, syncResult };
    })();
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(task);
    } else {
      await task;
    }
  }
};

