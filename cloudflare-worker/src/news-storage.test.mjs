import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyReactionRanking,
  approveNewsStory,
  banNewsStory,
  claimNewsProviderSync,
  computeStoryId,
  createApprovedCustomNewsStory,
  effectiveDisplayCategories,
  finishNewsProviderSync,
  updateProviderSyncStatus,
  getNewsAdminSnapshot,
  getStoredNewsFeed,
  disapproveNewsStory,
  resetNewsProviderSync,
  setStoryDisplayCategories,
  setStoryInterestKeywords,
  getStoriesByKeyword,
  getSpaceFeedPreview,
  extractAiText,
  runAiStoryCuration,
  getPersistedKeywordEmbeddings,
  getKeywordVectorStatus,
  clearKeywordVectorCache,
  sortItemsByDayReactions,
  undoNewsStoryDecision,
  updateNewsStory,
  upsertNewsStories,
  upsertNewsStoriesBatch,
  flushProviderFetchLogs,
  loadProviderCooldownsFromDbIfStale,
  getProviderCooldownState,
  clearProviderCooldownState
} from './news-storage.mjs';

const env = {
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_SECRET_KEY: 'service-secret'
};

test('stored feed query returns normalized publisher story shape', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  globalThis.fetch = async (input, options) => {
    const requestUrl = new URL(String(input));
    requestUrls.push(requestUrl);
    assert.equal(options.headers.apikey, env.SUPABASE_SECRET_KEY);
    if (requestUrl.searchParams.get('approved') === 'eq.false') {
      return Response.json([{
        provider: 'gnews',
        category: 'childcare',
        title: 'Pending family story',
        article_url: 'https://publisher.example/pending',
        approved: false,
        fetched_at: '2026-10-17T13:00:00Z'
      }]);
    }
    return Response.json([{
      provider: 'gnews',
      category: 'childcare',
      title: 'Family story',
      article_url: 'https://publisher.example/family',
      approved: true,
      image_url: 'https://images.example/family.jpg',
      description: 'Description',
      content: 'Article excerpt',
      ai_summary: 'A saved brief.',
      published_at: '2026-10-17T12:00:00Z',
      source_name: 'Example'
    }]);
  };
  try {
    const feed = await getStoredNewsFeed(env, 'childcare');
    const storyUrls = requestUrls.filter(requestUrl => requestUrl.pathname === '/rest/v1/news_stories');
    const reactionUrls = requestUrls.filter(requestUrl => requestUrl.pathname === '/rest/v1/article_reactions');
    assert.equal(storyUrls.length, 2);
    assert.equal(reactionUrls.length, 1);
    assert.equal(reactionUrls[0].searchParams.get('select'), 'story_id,reaction_type,count');
    assert.ok(storyUrls.every(requestUrl => requestUrl.pathname === '/rest/v1/news_stories'));
    // Phase 3: interest-overlap OR as top-level param, ANDed with the exclusion filter (De Morgan form).
    assert.ok(storyUrls.every(requestUrl => {
      const or = requestUrl.searchParams.get('or');
      return or?.startsWith('(interest_keywords.ov.{') && or?.endsWith(',display_categories.cs.{childcare})');
    }));
    assert.ok(storyUrls.every(requestUrl => requestUrl.searchParams.get('or')?.includes('childcare-family-general')));
    assert.ok(storyUrls.every(requestUrl => requestUrl.searchParams.get('not.and') === '(interest_keywords.not.is.null,interest_keywords.ov.{stocks,cryptocurrency,business-news,clickbait,death,politics,elections,government})'));
    assert.ok(storyUrls.every(requestUrl => requestUrl.searchParams.get('and') === null));
    assert.ok(storyUrls.every(requestUrl => requestUrl.searchParams.get('removed') === 'eq.false'));
    assert.equal(feed.provider, 'supabase');
    assert.deepEqual(feed.items[0], {
      provider: 'gnews',
      category: 'childcare',
      displayCategories: null,
      interestKeywords: null,
      title: 'Family story',
      link: 'https://publisher.example/family',
      image: 'https://images.example/family.jpg',
      description: 'Description',
      content: 'Article excerpt',
      aiSummary: 'A saved brief.',
      pubDate: '2026-10-17T12:00:00Z',
      fetchedAt: '',
      source: 'Example',
      approved: true
    });
    assert.equal(feed.items[1].pubDate, '');
    assert.equal(feed.items[1].fetchedAt, '2026-10-17T13:00:00Z');
    assert.equal(feed.items[0].approved, true);
    assert.equal(feed.items[1].approved, false);
    assert.deepEqual(new Set(storyUrls.map(requestUrl => requestUrl.searchParams.get('approved'))), new Set(['eq.true', 'eq.false']));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getStoredNewsFeed falls back to legacy category query when interest matches are zero', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  globalThis.fetch = async (input) => {
    const requestUrl = new URL(String(input));
    requestUrls.push(requestUrl);
    // Interest queries return nothing; legacy category queries return a story.
    if (requestUrl.searchParams.get('or')?.includes('interest_keywords.ov.')) {
      return Response.json([]);
    }
    return Response.json([{
      provider: 'gnews',
      category: 'childcare',
      title: 'Legacy family story',
      article_url: 'https://publisher.example/legacy',
      approved: requestUrl.searchParams.get('approved') === 'eq.true',
      fetched_at: '2026-10-17T13:00:00Z'
    }]);
  };
  try {
    const feed = await getStoredNewsFeed(env, 'childcare');
    // 2 interest + 2 legacy category fetches + 1 reaction totals fetch
    assert.equal(requestUrls.length, 5);
    const storyQueries = requestUrls.filter(u => u.pathname === '/rest/v1/news_stories');
    assert.equal(storyQueries.length, 4);
    const legacyQueries = requestUrls.filter(u => u.searchParams.get('or') === '(and(category.eq.childcare,display_categories.is.null),display_categories.cs.{childcare})');
    assert.equal(legacyQueries.length, 2);
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].title, 'Legacy family story');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getStoredNewsFeed excludes flagged keywords from the all category', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  globalThis.fetch = async (input) => {
    requestUrls.push(new URL(String(input)));
    return Response.json([]);
  };
  try {
    await getStoredNewsFeed(env, 'all');
    // Balanced 'all': 6 category buckets x (approved + unapproved) + 2 uncategorized.
    assert.equal(requestUrls.length, 14);
    assert.ok(requestUrls.every(requestUrl =>
      requestUrl.searchParams.get('not.and') === '(interest_keywords.not.is.null,interest_keywords.ov.{stocks,cryptocurrency,business-news,clickbait,death,politics,elections,government})'
    ));
    assert.ok(requestUrls.every(requestUrl => requestUrl.searchParams.get('and') === null));
    for (const category of ['childcare', 'animals', 'arts', 'tech', 'world', 'uplifting']) {
      const bucket = requestUrls.filter(requestUrl =>
        (requestUrl.searchParams.get('or') || '').includes(`category.eq.${category}`));
      assert.equal(bucket.length, 2);
    }
    const uncategorized = requestUrls.filter(requestUrl =>
      requestUrl.searchParams.get('display_categories') === 'is.null' &&
      (requestUrl.searchParams.get('or') || '').includes('category.is.null'));
    assert.equal(uncategorized.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getStoredNewsFeed balances the all category with per-category quotas', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  globalThis.fetch = async (input) => {
    const requestUrl = new URL(String(input));
    requestUrls.push(requestUrl);
    if (requestUrl.pathname === '/rest/v1/article_reactions') return Response.json([]);
    const approved = requestUrl.searchParams.get('approved') === 'eq.true';
    const orFilter = requestUrl.searchParams.get('or') || '';
    // Uncategorized bucket: or-filter names category.is.null (and the 'all' stamp).
    const bucketMatch = orFilter.includes('category.is.null') ? null : orFilter.match(/category\.eq\.(\w+)/);
    const bucket = bucketMatch ? bucketMatch[1] : 'uncategorized';
    return Response.json([0, 1, 2].map(i => ({
      provider: 'gnews',
      category: bucket === 'uncategorized' ? (i === 0 ? null : 'all') : bucket,
      title: `${bucket} ${approved ? 'approved' : 'pending'} ${i}`,
      article_url: `https://publisher.example/${bucket}/${approved ? 'approved' : 'pending'}/${i}`,
      approved,
      published_at: '2026-10-17T10:00:00Z'
    })));
  };
  try {
    const feed = await getStoredNewsFeed(env, 'all');
    const feedUrls = requestUrls.filter(requestUrl => requestUrl.pathname !== '/rest/v1/article_reactions');
    assert.equal(feedUrls.length, 14);
    // Quota params: 8 per side per category, 4 per side uncategorized.
    for (const requestUrl of feedUrls) {
      const isUncategorized = (requestUrl.searchParams.get('or') || '').includes('category.is.null');
      assert.equal(requestUrl.searchParams.get('limit'), isUncategorized ? '4' : '8');
    }
    // Every bucket contributes: six categories plus uncategorized rows,
    // which arrive as NULL or the literal 'all' stamp.
    const categories = new Set(feed.items.map(item => item.category));
    for (const category of ['animals', 'arts', 'childcare', 'tech', 'uplifting', 'world', 'all', null]) {
      assert.ok(categories.has(category), `missing bucket ${category}`);
    }
    assert.equal(feed.items.length, 42);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('computeStoryId matches the frontend getStoryId algorithm', () => {
  // Values computed from the frontend function in supabaseService.ts.
  assert.equal(computeStoryId('https://publisher.example/family', 'Family story'), 's_4z2l0j');
  assert.equal(computeStoryId('https://publisher.example/dino', 'Dino story'), 's_qosezd');
  assert.equal(computeStoryId('https://publisher.example/toy', 'Toy story'), 's_yagyed');
});

test('sortItemsByDayReactions ranks most-reacted first within each day', () => {
  const items = [
    { title: 'Newer, few reactions', link: 'https://x.example/a', pubDate: '2026-10-17T14:00:00Z' },
    { title: 'Older, many reactions', link: 'https://x.example/b', pubDate: '2026-10-17T09:00:00Z' },
    { title: 'Yesterday, most reactions', link: 'https://x.example/c', pubDate: '2026-10-16T09:00:00Z' },
    { title: 'No reactions', link: 'https://x.example/d', pubDate: '2026-10-17T10:00:00Z' },
    { title: 'No reactions 2', link: 'https://x.example/e', pubDate: '2026-10-17T11:00:00Z' }
  ];
  const totals = new Map([
    [computeStoryId('https://x.example/a', 'Newer, few reactions'), 2],
    [computeStoryId('https://x.example/b', 'Older, many reactions'), 15],
    [computeStoryId('https://x.example/c', 'Yesterday, most reactions'), 100]
  ]);
  const ranked = sortItemsByDayReactions(items, totals);
  // Same day: reactions dominate recency; zero-reaction ties break by recency;
  // the older day sorts after the whole newer day, however many reactions it has.
  assert.deepEqual(ranked.map(item => item.title), [
    'Older, many reactions',
    'Newer, few reactions',
    'No reactions 2',
    'No reactions',
    'Yesterday, most reactions'
  ]);
  // Input untouched.
  assert.equal(items[0].title, 'Newer, few reactions');
});

test('getStoredNewsFeed ranks same-day stories by total reactions', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const requestUrl = new URL(String(input));
    if (requestUrl.pathname === '/rest/v1/article_reactions') {
      return Response.json([
        { story_id: 's_qosezd', reaction_type: 'love', count: 10 },
        { story_id: 's_qosezd', reaction_type: 'mind', count: 5 },
        { story_id: 's_yagyed', reaction_type: 'love', count: 2 },
        { story_id: 's_99efjv', reaction_type: 'love', count: 100 }
      ]);
    }
    if (requestUrl.searchParams.get('approved') === 'eq.false') return Response.json([]);
    return Response.json([
      { provider: 'gnews', category: 'childcare', title: 'Toy story', article_url: 'https://publisher.example/toy', approved: true, published_at: '2026-10-17T14:00:00Z' },
      { provider: 'gnews', category: 'childcare', title: 'Dino story', article_url: 'https://publisher.example/dino', approved: true, published_at: '2026-10-17T12:00:00Z' },
      { provider: 'gnews', category: 'childcare', title: 'Family story', article_url: 'https://publisher.example/family', approved: true, published_at: '2026-10-17T10:00:00Z' },
      { provider: 'gnews', category: 'childcare', title: 'Old story', article_url: 'https://publisher.example/old', approved: true, published_at: '2026-10-16T09:00:00Z' }
    ]);
  };
  try {
    const feed = await getStoredNewsFeed(env, 'all');
    assert.deepEqual(feed.items.map(item => item.title), [
      'Dino story',
      'Toy story',
      'Family story',
      'Old story'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getStoredNewsFeed keeps date order when the reactions lookup fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const requestUrl = new URL(String(input));
    if (requestUrl.pathname === '/rest/v1/article_reactions') {
      return new Response('{"code":"PGRST205","message":"Could not find the table"}', {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (requestUrl.searchParams.get('approved') === 'eq.false') return Response.json([]);
    return Response.json([
      { provider: 'gnews', category: 'childcare', title: 'Toy story', article_url: 'https://publisher.example/toy', approved: true, published_at: '2026-10-17T14:00:00Z' },
      { provider: 'gnews', category: 'childcare', title: 'Dino story', article_url: 'https://publisher.example/dino', approved: true, published_at: '2026-10-17T12:00:00Z' },
      { provider: 'gnews', category: 'childcare', title: 'Family story', article_url: 'https://publisher.example/family', approved: true, published_at: '2026-10-17T10:00:00Z' }
    ]);
  };
  try {
    const feed = await getStoredNewsFeed(env, 'all');
    // No totals available: same-day stories stay in recency order.
    assert.deepEqual(feed.items.map(item => item.title), ['Toy story', 'Dino story', 'Family story']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getSpaceFeedPreview returns interest sample plus diagnostics for a front-page space', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  globalThis.fetch = async (input) => {
    requestUrls.push(new URL(String(input)));
    return Response.json([]);
  };
  try {
    const preview = await getSpaceFeedPreview(env, 'tech');
    assert.equal(preview.error, undefined);
    assert.equal(preview.space, 'tech');
    assert.ok(preview.interestIds.length > 0);
    assert.ok(preview.interestIds.includes('tech-games-general'));
    assert.deepEqual(preview.items, []);
    assert.equal(preview.matchCount, 0);
    assert.equal(preview.flaggedFilteredCount, 0);
    assert.equal(preview.categoryFallbackCount, 0);
    // 2 interest + 2 unfiltered + 2 category fallback fetches
    assert.equal(requestUrls.length, 6);
    const interestQueries = requestUrls.filter(u => u.searchParams.get('interest_keywords')?.startsWith('ov.'));
    assert.equal(interestQueries.length, 4);
    assert.ok(interestQueries.every(u => u.searchParams.get('interest_keywords').includes('tech-games-general')));
    const categoryQueries = requestUrls.filter(u => u.searchParams.get('or')?.includes('category.eq.tech'));
    assert.equal(categoryQueries.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getSpaceFeedPreview returns error with valid spaces for unknown space', async () => {
  const preview = await getSpaceFeedPreview(env, 'not-a-space');
  assert.equal(preview.error, 'Unknown space');
  assert.ok(preview.validSpaces.includes('tech'));
  assert.ok(preview.validSpaces.includes('food'));
});

test('getSpaceFeedPreview skips category fallback for standalone spaces', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  globalThis.fetch = async (input) => {
    requestUrls.push(new URL(String(input)));
    return Response.json([]);
  };
  try {
    const preview = await getSpaceFeedPreview(env, 'food');
    assert.equal(preview.error, undefined);
    assert.equal(preview.categoryFallbackCount, null);
    // 2 interest + 2 unfiltered only, no category fallback
    assert.equal(requestUrls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getStoriesByKeyword does not exclude flagged keywords (boards stay available)', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  globalThis.fetch = async (input) => {
    requestUrls.push(new URL(String(input)));
    return Response.json([]);
  };
  try {
    await getStoriesByKeyword(env, 'stocks');
    assert.ok(requestUrls.length >= 1);
    assert.ok(requestUrls.every(requestUrl => {
      const params = requestUrl.searchParams;
      return !params.get('or')?.includes('not.interest_keywords')
        && !params.get('and')?.includes('not.interest_keywords');
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider update claim calls the service-only atomic lock RPC', async () => {  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestBody;
  globalThis.fetch = async (input, options) => {
    requestUrl = new URL(String(input));
    requestBody = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, `Bearer ${env.SUPABASE_SECRET_KEY}`);
    return Response.json(true);
  };
  try {
    assert.equal(await claimNewsProviderSync(env, 'gnews', 'admin@example.com'), true);
    assert.equal(requestUrl.pathname, '/rest/v1/rpc/claim_news_provider_sync');
    assert.deepEqual(requestBody, { p_provider: 'gnews', p_updated_by: 'admin@example.com' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('upsert uses the unique provider/category/publisher URL key', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestOptions;
  globalThis.fetch = async (input, options) => {
    requestUrl = new URL(String(input));
    requestOptions = options;
    return new Response(null, { status: 204 });
  };
  try {
    await upsertNewsStories(env, 'gnews', 'childcare', [{
      title: 'Family story',
      link: 'https://publisher.example/family',
      image: 'https://images.example/family.jpg',
      description: 'Description',
      content: 'Article excerpt',
      pubDate: '2026-10-17T12:00:00Z',
      source: 'Example'
    }]);
    assert.equal(requestUrl.pathname, '/rest/v1/news_stories');
    assert.equal(requestUrl.searchParams.get('on_conflict'), 'provider,category,article_url');
    assert.match(requestOptions.headers.Prefer, /resolution=merge-duplicates/);
    const [row] = JSON.parse(requestOptions.body);
    assert.equal(row.article_url, 'https://publisher.example/family');
    assert.equal(row.category, 'childcare');
    assert.equal(Object.hasOwn(row, 'approved'), false);
    assert.equal(Object.hasOwn(row, 'removed'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin snapshot includes exact total, latest ten, and provider status', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    requests.push({ url, options });
    if (url.pathname.endsWith('/news_stories') && options.headers.Range) {
      const total = url.searchParams.has('provider') ? 17
        : url.searchParams.get('interest_keywords') === 'is.null' ? 23
        : 42;
      return new Response('[{"id":1}]', {
        status: 206,
        headers: { 'Content-Range': `0-0/${total}` }
      });
    }
    if (
      url.pathname.endsWith('/news_stories') &&
      url.searchParams.get('decision_at') === 'not.is.null'
    ) {
      return Response.json([{
        id: 8,
        provider: 'gnews',
        category: 'childcare',
        title: 'Recent decision',
        article_url: 'https://publisher.example/recent',
        approved: true,
        removed: false,
        fetched_at: '2026-10-17T12:05:00Z',
        decision_action: 'approve',
        decision_by: 'littlables',
        decision_at: '2026-10-17T12:06:00Z',
        previous_approved: false,
        previous_removed: false
      }]);
    }
    if (
      url.pathname.endsWith('/news_stories') &&
      url.searchParams.get('approved') === 'eq.false' &&
      url.searchParams.get('removed') === 'eq.false'
    ) {
      return Response.json([{
        id: 7,
        provider: 'gnews',
        category: 'childcare',
        title: 'Pending story',
        article_url: 'https://publisher.example/pending',
        approved: false,
        removed: false,
        fetched_at: '2026-10-17T12:00:00Z'
      }]);
    }
    if (url.pathname.endsWith('/news_stories')) return Response.json([]);
    return Response.json([{
      provider: 'gnews',
      status: 'succeeded',
      last_success_at: '2026-10-17T12:00:00Z',
      stories_saved: 7
    }]);
  };
  try {
    const snapshot = await getNewsAdminSnapshot(
      env,
      [{ id: 'gnews', name: 'GNews', categories: ['all'] }],
      'gnews'
    );
    assert.equal(snapshot.totalStories, 42);
    assert.equal(snapshot.unclassifiedCount, 23);
    assert.equal(snapshot.recentStories[0].id, 8);
    assert.equal(snapshot.recentStories[0].decisionAction, 'approve');
    assert.equal(snapshot.recentStories[0].previousApproved, false);
    assert.equal(snapshot.pendingStories[0].id, 7);
    assert.equal(snapshot.pendingStories[0].approved, false);
    assert.equal(snapshot.pendingStories[0].updatedAt, '2026-10-17T12:00:00Z');
    assert.equal(snapshot.providers[0].status, 'succeeded');
    assert.equal(snapshot.providers[0].stories_saved, 7);
    assert.equal(snapshot.providers[0].total_stories_saved, 17);
    assert.equal(requests.length, 17);
    assert.ok(requests.every(({ options }) => options.headers.apikey === env.SUPABASE_SECRET_KEY));
    assert.equal(requests.find(({ url }) => url.searchParams.get('decision_at') === 'not.is.null').url.searchParams.get('limit'), null);
    assert.ok(requests.some(({ url }) =>
      url.searchParams.get('approved') === 'eq.false' &&
      url.searchParams.get('removed') === 'eq.false'
    ));
    assert.equal(
      requests.find(({ url }) => url.searchParams.get('approved') === 'eq.false')
        .url.searchParams.get('provider'),
      'eq.gnews'
    );
    assert.ok(requests.some(({ url }) =>
      url.searchParams.get('removed') === 'eq.true' &&
      url.searchParams.get('limit') === '100'
    ));
    assert.equal(
      requests.find(({ url }) => url.searchParams.has('or')).url.searchParams.get('or'),
      '(decision_action.is.null,decision_action.eq.undo)'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('approval only transitions an unapproved story and records the admin identity', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestOptions;
  globalThis.fetch = async (input, options) => {
    requestUrl = new URL(String(input));
    requestOptions = options;
    return Response.json([{ id: 7 }]);
  };
  try {
    assert.equal(await approveNewsStory(env, '7', 'admin@example.com'), true);
    assert.equal(requestUrl.pathname, '/rest/v1/news_stories');
    assert.equal(requestUrl.searchParams.get('id'), 'eq.7');
    assert.equal(requestUrl.searchParams.get('approved'), 'eq.false');
    assert.equal(requestUrl.searchParams.get('removed'), 'eq.false');
    assert.equal(requestOptions.method, 'PATCH');
    const payload = JSON.parse(requestOptions.body);
    assert.equal(payload.approved, true);
    assert.equal(payload.approved_by, 'admin@example.com');
    assert.ok(Number.isFinite(Date.parse(payload.approved_at)));
    assert.equal(payload.decision_action, 'approve');
    assert.equal(payload.previous_approved, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('custom story publish saves editable card fields as an approved custom row', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestOptions;
  globalThis.fetch = async (input, options) => {
    requestUrl = new URL(String(input));
    requestOptions = options;
    return Response.json([{ id: 71 }]);
  };
  try {
    const id = await createApprovedCustomNewsStory(env, {
      title: 'A custom story',
      category: 'childcare',
      link: 'https://publisher.example/story',
      image: 'https://images.example/story.jpg',
      description: 'Description',
      content: 'Summary context',
      aiSummary: 'A custom brief',
      pubDate: '2026-10-17T12:00:00.000Z',
      source: 'Publisher'
    }, 'littlables');
    assert.equal(id, 71);
    assert.equal(requestUrl.searchParams.get('on_conflict'), 'provider,category,article_url');
    const [row] = JSON.parse(requestOptions.body);
    assert.equal(row.provider, 'custom');
    assert.equal(row.article_url, 'https://publisher.example/story');
    assert.equal(row.image_url, 'https://images.example/story.jpg');
    assert.equal(row.approved, true);
    assert.equal(row.approved_by, 'littlables');
    assert.equal(row.decision_action, 'approve');
    assert.equal(row.previous_approved, false);
    assert.equal(row.ai_summary, 'A custom brief');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('story detail updates do not change moderation state', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestOptions;
  globalThis.fetch = async (input, options) => {
    requestUrl = new URL(String(input));
    requestOptions = options;
    return Response.json([{ id: 71 }]);
  };
  try {
    assert.equal(await updateNewsStory(env, '71', {
      title: 'Edited story',
      category: 'arts',
      link: 'https://publisher.example/edited',
      image: '',
      description: 'Edited description',
      content: 'Edited context',
      aiSummary: 'An edited brief',
      pubDate: '',
      source: 'Publisher'
    }), true);
    assert.equal(requestUrl.searchParams.get('id'), 'eq.71');
    const payload = JSON.parse(requestOptions.body);
    assert.equal(payload.title, 'Edited story');
    assert.equal(payload.category, 'arts');
    assert.equal(payload.article_url, 'https://publisher.example/edited');
    assert.equal(payload.image_url, null);
    assert.equal(payload.ai_summary, 'An edited brief');
    assert.equal(Object.hasOwn(payload, 'approved'), false);
    assert.equal(Object.hasOwn(payload, 'removed'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('disapprove keeps a story in the feed without treating it as approved', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const requestUrl = new URL(String(input));
    requests.push({ requestUrl, options });
    return requests.length === 1
      ? Response.json([{ id: 7, approved: true, removed: false }])
      : Response.json([{ id: 7 }]);
  };
  try {
    assert.equal(await disapproveNewsStory(env, '7', 'littlables'), true);
    assert.equal(requests.length, 2);
    const [lookup, update] = requests;
    assert.equal(lookup.requestUrl.searchParams.get('id'), 'eq.7');
    assert.equal(lookup.requestUrl.searchParams.get('removed'), 'eq.false');
    assert.equal(update.requestUrl.pathname, '/rest/v1/news_stories');
    assert.equal(update.requestUrl.searchParams.get('id'), 'eq.7');
    assert.equal(update.requestUrl.searchParams.get('approved'), 'eq.true');
    assert.equal(update.requestUrl.searchParams.get('removed'), 'eq.false');
    assert.equal(update.options.method, 'PATCH');
    const payload = JSON.parse(update.options.body);
    assert.equal(payload.approved, false);
    assert.equal(payload.removed, undefined);
    assert.equal(payload.decision_action, 'disapprove');
    assert.equal(payload.previous_approved, true);
    assert.equal(payload.previous_removed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ban hides an unapproved story while preserving its database row', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestOptions;
  globalThis.fetch = async (input, options) => {
    requestUrl = new URL(String(input));
    requestOptions = options;
    return Response.json([{ id: 7 }]);
  };
  try {
    assert.equal(await banNewsStory(env, '7', 'littlables'), true);
    assert.equal(requestUrl.searchParams.get('approved'), 'eq.false');
    assert.equal(requestUrl.searchParams.get('removed'), 'eq.false');
    const payload = JSON.parse(requestOptions.body);
    assert.equal(payload.removed, true);
    assert.equal(payload.decision_action, 'ban');
    assert.equal(payload.previous_removed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('undo restores the prior story state and only applies to the current decision', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    requests.push({ url, options });
    if (!options.method) {
      return Response.json([{
        id: 7,
        approved: false,
        removed: true,
        decision_action: 'ban',
        decision_at: '2026-10-17T12:00:00Z',
        previous_approved: false,
        previous_removed: false
      }]);
    }
    return Response.json([{ id: 7 }]);
  };
  try {
    assert.equal(await undoNewsStoryDecision(env, '7', 'littlables'), true);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url.searchParams.get('decision_action'), 'eq.ban');
    assert.equal(requests[1].url.searchParams.get('decision_at'), 'eq.2026-10-17T12:00:00Z');
    const payload = JSON.parse(requests[1].options.body);
    assert.equal(payload.approved, false);
    assert.equal(payload.removed, false);
    assert.equal(payload.previous_approved, null);
    assert.equal(payload.decision_action, 'undo');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider update completion stores status and clears the running lock', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestOptions;
  globalThis.fetch = async (input, options) => {
    requestUrl = new URL(String(input));
    requestOptions = options;
    return new Response(null, { status: 204 });
  };
  try {
    await finishNewsProviderSync(env, 'gnews', {
      status: 'partial',
      storiesSaved: 12,
      error: 'arts: request failed'
    });
    assert.equal(requestUrl.pathname, '/rest/v1/news_provider_sync');
    assert.equal(requestUrl.searchParams.get('provider'), 'eq.gnews');
    const payload = JSON.parse(requestOptions.body);
    assert.equal(payload.status, 'partial');
    assert.equal(payload.stories_saved, 12);
    assert.equal(payload.started_at, null);
    assert.equal(payload.last_error, 'arts: request failed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider sync reset clears a stuck running lock', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const requestUrl = new URL(String(input));
    requests.push({ url: requestUrl, options });
    if (!options.method) {
      return Response.json([{ provider: 'gnews', status: 'running', started_at: '2026-10-20T00:00:00Z' }]);
    }
    return new Response(null, { status: 204 });
  };
  try {
    const result = await resetNewsProviderSync(env, 'gnews', 'admin@example.com');
    assert.deepEqual(result, { provider: 'gnews', reset: true, previousStatus: 'running' });
    assert.equal(requests.length, 2);
    const patch = requests[1];
    assert.equal(patch.url.pathname, '/rest/v1/news_provider_sync');
    assert.equal(patch.url.searchParams.get('provider'), 'eq.gnews');
    assert.equal(patch.options.method, 'PATCH');
    const payload = JSON.parse(patch.options.body);
    assert.equal(payload.status, 'failed');
    assert.equal(payload.started_at, null);
    assert.equal(payload.updated_by, 'admin@example.com');
    assert.ok(payload.last_error.includes('admin@example.com'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider sync reset leaves a non-running provider untouched', async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async (input) => {
    requestCount += 1;
    return Response.json([{ provider: 'gnews', status: 'succeeded', started_at: null }]);
  };
  try {
    const result = await resetNewsProviderSync(env, 'gnews', 'admin@example.com');
    assert.deepEqual(result, { provider: 'gnews', reset: false, previousStatus: 'succeeded' });
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('setStoryDisplayCategories validates, dedupes, and clears overrides', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (input, options) => {
    requestBody = JSON.parse(options.body);
    return Response.json([{ id: 99 }]);
  };
  try {
    // Valid multi-category override, with duplicates and casing normalized
    let result = await setStoryDisplayCategories(env, 99, ['Animals', 'childcare', 'animals']);
    assert.equal(result.ok, true);
    assert.deepEqual(result.displayCategories, ['animals', 'childcare']);
    assert.deepEqual(requestBody, { display_categories: ['animals', 'childcare'] });

    // Empty list clears the override (NULL, not empty array)
    result = await setStoryDisplayCategories(env, 99, []);
    assert.equal(result.ok, true);
    assert.equal(result.displayCategories, null);
    assert.deepEqual(requestBody, { display_categories: null });

    // null clears too
    result = await setStoryDisplayCategories(env, 99, null);
    assert.equal(result.ok, true);
    assert.equal(result.displayCategories, null);

    // Unknown categories are rejected, nothing is written
    result = await setStoryDisplayCategories(env, 99, ['childcare', 'nonsense']);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Unknown category in override list');

    // 'all' is not an overridable display category
    result = await setStoryDisplayCategories(env, 99, ['all']);
    assert.equal(result.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('effectiveDisplayCategories prefers the override list', () => {
  assert.deepEqual(
    effectiveDisplayCategories({ category: 'tech', display_categories: ['childcare', 'animals'] }),
    ['childcare', 'animals']
  );
  assert.deepEqual(
    effectiveDisplayCategories({ category: 'tech', display_categories: [] }),
    ['tech']
  );
  assert.deepEqual(
    effectiveDisplayCategories({ category: 'tech', display_categories: null }),
    ['tech']
  );
  assert.deepEqual(
    effectiveDisplayCategories({ category: 'tech', displayCategories: ['arts'] }),
    ['arts']
  );
});

test('setStoryInterestKeywords validates, dedupes, and clears keyword tags', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (input, options) => {
    requestBody = JSON.parse(options.body);
    return Response.json([{ id: 99 }]);
  };
  try {
    // Valid keywords, with duplicates and casing normalized
    let result = await setStoryInterestKeywords(env, 99, ['Space', 'food', 'space']);
    assert.equal(result.ok, true);
    assert.deepEqual(result.interestKeywords, ['space', 'food']);
    assert.deepEqual(requestBody, { interest_keywords: ['space', 'food'] });

    // Country keyword derives region
    result = await setStoryInterestKeywords(env, 99, ['country-japan', 'space']);
    assert.equal(result.ok, true);
    assert.deepEqual(requestBody, { interest_keywords: ['country-japan', 'space'] });

    // Empty list clears the tags (NULL, not empty array)
    result = await setStoryInterestKeywords(env, 99, []);
    assert.equal(result.ok, true);
    assert.equal(result.interestKeywords, null);
    assert.deepEqual(requestBody, { interest_keywords: null });

    // Unknown keywords are rejected, nothing is written
    result = await setStoryInterestKeywords(env, 99, ['space', 'nonsense']);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Unknown interest keyword');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getStoriesByKeyword queries the interest_keywords array column', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  globalThis.fetch = async (input) => {
    requestUrls.push(new URL(input));
    return Response.json([]);
  };
  try {
    const feed = await getStoriesByKeyword(env, 'space');
    assert.equal(feed.provider, 'supabase');
    assert.deepEqual(feed.items, []);
    assert.equal(requestUrls.length, 2);
    assert.ok(requestUrls.every(u => u.searchParams.get('interest_keywords') === 'cs.{space}'));
    assert.ok(requestUrls.every(u => u.searchParams.get('removed') === 'eq.false'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getPersistedKeywordEmbeddings returns incomplete status without an AI binding', async () => {
  clearKeywordVectorCache();
  const result = await getPersistedKeywordEmbeddings(env);
  assert.equal(result.vectors, null);
  assert.equal(result.complete, false);
  clearKeywordVectorCache();
});

test('getPersistedKeywordEmbeddings loads vectors from Supabase without AI calls', async () => {
  clearKeywordVectorCache();
  const { INTEREST_KEYWORDS } = await import('./interest-keywords.mjs');
  const originalFetch = globalThis.fetch;
  let aiCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/keyword_embeddings') {
      return Response.json(
        INTEREST_KEYWORDS.map((kw) => ({
          keyword_id: kw.id,
          embedding: [0.1, 0.2, 0.3],
          model: '@cf/baai/bge-base-en-v1.5:kwv12',
        }))
      );
    }
    throw new Error('unexpected fetch: ' + url.pathname);
  };
  const aiEnv = {
    ...env,
    AI: { run: async () => { aiCalls++; return { data: [[0.1]] }; } },
  };
  try {
    const result = await getPersistedKeywordEmbeddings(aiEnv);
    assert.equal(result.complete, true);
    const map = result.vectors;
    assert.ok(map instanceof Map);
    assert.equal(map.size, INTEREST_KEYWORDS.length);
    assert.deepEqual(map.get('space'), [0.1, 0.2, 0.3]);
    assert.equal(aiCalls, 0, 'no AI calls when all vectors are stored');
    // Second call served from in-memory cache (no fetches at all)
    let fetches = 0;
    globalThis.fetch = async () => { fetches++; return Response.json([]); };
    const cached = await getPersistedKeywordEmbeddings(aiEnv);
    assert.equal(cached.vectors, map);
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearKeywordVectorCache();
  }
});

test('getKeywordVectorStatus reports stored count without backfilling', async () => {
  clearKeywordVectorCache();
  const { INTEREST_KEYWORDS } = await import('./interest-keywords.mjs');
  const originalFetch = globalThis.fetch;
  let aiCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/keyword_embeddings') {
      // Half the keywords stored with the current version.
      return Response.json(
        INTEREST_KEYWORDS.slice(0, Math.floor(INTEREST_KEYWORDS.length / 2)).map((kw) => ({
          keyword_id: kw.id,
          model: '@cf/baai/bge-base-en-v1.5:kwv12',
        }))
      );
    }
    throw new Error('unexpected fetch: ' + url.pathname);
  };
  const aiEnv = {
    ...env,
    AI: { run: async () => { aiCalls++; return { data: [[0.2]] }; } },
  };
  try {
    const status = await getKeywordVectorStatus(aiEnv);
    assert.equal(status.complete, false);
    assert.equal(status.done, Math.floor(INTEREST_KEYWORDS.length / 2));
    assert.equal(status.total, INTEREST_KEYWORDS.length);
    assert.equal(aiCalls, 0, 'status check must not call AI');
  } finally {
    globalThis.fetch = originalFetch;
    clearKeywordVectorCache();
  }
});

test('getPersistedKeywordEmbeddings ignores vectors from an older description version', async () => {
  clearKeywordVectorCache();
  const { INTEREST_KEYWORDS } = await import('./interest-keywords.mjs');
  const originalFetch = globalThis.fetch;
  // All stored, but with the v1 model string -> treated as missing
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/keyword_embeddings') {
      if (options && options.method === 'POST') return Response.json([]);
      return Response.json(
        INTEREST_KEYWORDS.map((kw) => ({
          keyword_id: kw.id,
          embedding: [0.1],
          model: '@cf/baai/bge-base-en-v1.5',
        }))
      );
    }
    throw new Error('unexpected fetch: ' + url.pathname);
  };
  const aiEnv = {
    ...env,
    AI: { run: async () => ({ data: [[0.2]] }) },
  };
  try {
    const result = await getPersistedKeywordEmbeddings(aiEnv);
    // One chunk (25) backfilled with the new version; still incomplete
    assert.equal(result.complete, false);
    assert.equal(result.done, 25);
  } finally {
    globalThis.fetch = originalFetch;
    clearKeywordVectorCache();
  }
});

test('getPersistedKeywordEmbeddings backfills missing vectors and is all-or-nothing', async () => {
  clearKeywordVectorCache();
  const { INTEREST_KEYWORDS } = await import('./interest-keywords.mjs');
  const originalFetch = globalThis.fetch;
  // All but one stored; the last one fails to embed -> incomplete -> null
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/keyword_embeddings') {
      if (options && options.method === 'POST') return Response.json([]);
      return Response.json(
        INTEREST_KEYWORDS.slice(0, INTEREST_KEYWORDS.length - 1).map((kw) => ({
          keyword_id: kw.id,
          embedding: [0.1],
          model: '@cf/baai/bge-base-en-v1.5:kwv12',
        }))
      );
    }
    throw new Error('unexpected fetch: ' + url.pathname);
  };
  const failingAiEnv = {
    ...env,
    AI: { run: async () => { throw new Error('AI down'); } },
  };
  try {
    const result = await getPersistedKeywordEmbeddings(failingAiEnv);
    assert.equal(result.vectors, null, 'partial backfill must not enable tagging');
    assert.equal(result.complete, false);
    assert.equal(result.done, INTEREST_KEYWORDS.length - 1);
    assert.equal(result.total, INTEREST_KEYWORDS.length);
  } finally {
    globalThis.fetch = originalFetch;
    clearKeywordVectorCache();
  }
});

test('titleSimilarity detects near-duplicate titles', async () => {
  const { titleSimilarity, findNearDuplicates, hashUrl } = await import('./news-storage.mjs');

  // Identical titles
  assert.equal(titleSimilarity('Breaking: New Study Shows Coffee Is Great', 'Breaking: New Study Shows Coffee Is Great'), 1);

  // Near-duplicates (same story, slightly different headline)
  const sim1 = titleSimilarity(
    'Scientists Discover New Species of Frog in Amazon Rainforest',
    'New Frog Species Discovered by Scientists in the Amazon'
  );
  assert.ok(sim1 >= 0.5, `Expected high similarity, got ${sim1}`);

  // Different stories
  const sim2 = titleSimilarity(
    'Local Bakery Wins Award for Best Sourdough',
    'NASA Launches New Mars Rover Mission'
  );
  assert.ok(sim2 < 0.3, `Expected low similarity, got ${sim2}`);

  // Empty titles
  assert.equal(titleSimilarity('', ''), 0);
  assert.equal(titleSimilarity('Hello World Test', ''), 0);
});

test('findNearDuplicates filters duplicate stories', async () => {
  const { findNearDuplicates } = await import('./news-storage.mjs');

  const existing = [
    { id: 1, title: 'Scientists Discover New Species of Frog in Amazon Rainforest', link: 'https://example.com/frog' },
  ];
  const candidates = [
    { id: 2, title: 'Scientists Discover New Frog Species in Amazon Rainforest', link: 'https://other.com/frog2' },
    { id: 3, title: 'Local Bakery Wins Award for Best Sourdough', link: 'https://example.com/bakery' },
    { id: 4, title: 'Exact Same Story', link: 'https://example.com/frog' }, // same URL
  ];

  const dups = findNearDuplicates(candidates, existing, 0.7);
  assert.equal(dups.length, 2); // id 2 (similar title) and id 4 (same URL)
  assert.ok(dups.some(d => d.candidate.id === 2 && d.reason === 'similar-title'));
  assert.ok(dups.some(d => d.candidate.id === 4 && d.reason === 'same-url'));
});

test('hashUrl produces consistent hashes', async () => {
  const { hashUrl } = await import('./news-storage.mjs');
  const h1 = hashUrl('https://example.com/story');
  const h2 = hashUrl('https://example.com/story');
  const h3 = hashUrl('https://example.com/other');
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.ok(h1.startsWith('h'));
});

test('recordEngagementEvent stores keywords and attribution', async () => {
  const { recordEngagementEvent } = await import('./news-storage.mjs');
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (input, options) => {
    sentBody = JSON.parse(options.body);
    return Response.json({});
  };
  const testEnv = { ...env, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sk-test' };
  try {
    const result = await recordEngagementEvent(testEnv, {
      url: 'https://example.com/story',
      title: 'Test Story',
      category: 'animals',
      eventType: 'click',
      sessionId: 'sess123',
      keywords: ['dinosaurs', 'not-a-keyword', 'space'],
      referrer_domain: 'google.com',
      utm_source: 'newsletter',
      country_code: 'us',
    });
    assert.equal(result.ok, true);
    // Only known keyword ids are stored; unknown ones dropped.
    assert.deepEqual(sentBody.keywords, ['dinosaurs', 'space']);
    assert.equal(sentBody.referrer_domain, 'google.com');
    assert.equal(sentBody.utm_source, 'newsletter');
    assert.equal(sentBody.country_code, 'US');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('isInternalRequest filters admin, dev, and localhost traffic', async () => {
  const { isInternalRequest } = await import('./news-storage.mjs');
  const req = (referer, origin = '') => ({
    headers: {
      get: (name) => {
        const n = name.toLowerCase();
        if (n === 'referer') return referer;
        if (n === 'origin') return origin;
        return null;
      },
    },
  });
  // Admin panel
  assert.equal(isInternalRequest(req('https://hello-ai.cryptokatiee.workers.dev/admin')), true);
  assert.equal(isInternalRequest(req('https://hello-ai.cryptokatiee.workers.dev/admin/api/ads')), true);
  // Dev site and localhost
  assert.equal(isInternalRequest(req('https://dev.littlables.com/')), true);
  assert.equal(isInternalRequest(req('http://localhost:5173/')), true);
  assert.equal(isInternalRequest(req('', 'http://127.0.0.1:3000')), true);
  // Real traffic
  assert.equal(isInternalRequest(req('https://littlables.com/')), false);
  assert.equal(isInternalRequest(req('https://www.google.com/')), false);
  assert.equal(isInternalRequest(req('')), false);
});

test('deriveStoryRegion maps country keywords to ISO and region', async () => {
  const { deriveStoryRegion, deriveCountryFromKeywords } = await import('./interest-keywords.mjs');
  assert.equal(deriveCountryFromKeywords(['dinosaurs', 'country-japan']), 'JP');
  assert.equal(deriveCountryFromKeywords(['country-uk']), 'GB');
  assert.equal(deriveCountryFromKeywords(['dinosaurs']), null);
  assert.equal(deriveCountryFromKeywords(null), null);
  assert.deepEqual(deriveStoryRegion(['country-japan']), { country_code: 'JP', region: 'asia' });
  assert.deepEqual(deriveStoryRegion(['country-us']), { country_code: 'US', region: 'north-america' });
  assert.deepEqual(deriveStoryRegion(['country-brazil']), { country_code: 'BR', region: 'south-america' });
  assert.deepEqual(deriveStoryRegion(['dinosaurs']), { country_code: null, region: 'global' });
  assert.deepEqual(deriveStoryRegion([]), { country_code: null, region: 'global' });
});

test('getStoriesByInterests returns empty for no IDs', async () => {
  const { getStoriesByInterests } = await import('./news-storage.mjs');
  const result = await getStoriesByInterests(env, []);
  assert.deepEqual(result.items, []);
  assert.equal(result.provider, 'supabase');
});

test('getStoriesByInterests uses overlap query for keywords', async () => {
  const { getStoriesByInterests } = await import('./news-storage.mjs');
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  globalThis.fetch = async (input) => {
    const requestUrl = new URL(String(input));
    requestUrls.push(requestUrl);
    return Response.json([{
      provider: 'gnews',
      category: 'childcare',
      title: 'Keyword story',
      article_url: 'https://publisher.example/kw1',
      interest_keywords: ['childcare-babies'],
      approved: requestUrl.searchParams.get('approved') === 'eq.true',
      published_at: '2026-10-23T12:00:00Z',
      fetched_at: '2026-10-23T13:00:00Z'
    }]);
  };
  try {
    const result = await getStoriesByInterests(env, ['childcare-babies', 'sleep-training']);
    assert.equal(result.items.length, 1); // deduped by URL
    assert.equal(result.items[0].title, 'Keyword story');
    // Verify overlap query was used
    const kwQuery = requestUrls.find(u => u.searchParams.get('interest_keywords')?.startsWith('ov.'));
    assert.ok(kwQuery, 'should use ov. overlap query');
    assert.ok(kwQuery.searchParams.get('interest_keywords').includes('childcare-babies'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getStoriesByInterests handles category IDs via front-page feeds', async () => {
  const { getStoriesByInterests } = await import('./news-storage.mjs');
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  globalThis.fetch = async (input) => {
    const requestUrl = new URL(String(input));
    requestUrls.push(requestUrl);
    return Response.json([{
      provider: 'gnews',
      category: 'childcare',
      title: 'Category story',
      article_url: 'https://publisher.example/cat1',
      approved: requestUrl.searchParams.get('approved') === 'eq.true',
      published_at: '2026-10-23T12:00:00Z',
      fetched_at: '2026-10-23T13:00:00Z'
    }]);
  };
  try {
    const result = await getStoriesByInterests(env, ['childcare']);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, 'Category story');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getStoriesByInterests ranks same-day stories by total reactions', async () => {
  const { getStoriesByInterests } = await import('./news-storage.mjs');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const requestUrl = new URL(String(input));
    if (requestUrl.pathname === '/rest/v1/article_reactions') {
      return Response.json([
        { story_id: 's_qosezd', reaction_type: 'love', count: 10 },
        { story_id: 's_qosezd', reaction_type: 'mind', count: 5 },
        { story_id: 's_yagyed', reaction_type: 'love', count: 2 }
      ]);
    }
    if (requestUrl.searchParams.get('approved') === 'eq.false') return Response.json([]);
    return Response.json([
      { provider: 'gnews', category: 'childcare', title: 'Toy story', article_url: 'https://publisher.example/toy', interest_keywords: ['childcare-babies'], approved: true, published_at: '2026-10-17T14:00:00Z' },
      { provider: 'gnews', category: 'childcare', title: 'Dino story', article_url: 'https://publisher.example/dino', interest_keywords: ['childcare-babies'], approved: true, published_at: '2026-10-17T12:00:00Z' },
      { provider: 'gnews', category: 'childcare', title: 'Family story', article_url: 'https://publisher.example/family', interest_keywords: ['childcare-babies'], approved: true, published_at: '2026-10-17T10:00:00Z' }
    ]);
  };
  try {
    const result = await getStoriesByInterests(env, ['childcare-babies']);
    assert.deepEqual(result.items.map(item => item.title), ['Dino story', 'Toy story', 'Family story']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getPlayroomFeed ranks same-day stories by total reactions', async () => {
  const { getPlayroomFeed } = await import('./news-storage.mjs');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const table = url.pathname.split('/').pop();
    if (table === 'profiles') {
      return Response.json([{ id: 'user-123' }]);
    }
    if (table === 'playrooms' && url.searchParams.get('select') === 'id') {
      return Response.json([{ id: 'playroom-456' }]);
    }
    if (table === 'playrooms') {
      return Response.json([{
        id: 'playroom-456',
        user_id: 'user-123',
        name: 'My Playroom',
        slug: 'my-playroom'
      }]);
    }
    if (table === 'playroom_spaces') {
      return Response.json([{
        position: 0,
        boards: {
          id: 'space-789',
          name: 'Babies',
          slug: 'babies',
          pills: [{ type: 'keyword', id: 'childcare-babies' }]
        }
      }]);
    }
    if (table === 'article_reactions') {
      return Response.json([
        { story_id: 's_qosezd', reaction_type: 'love', count: 10 },
        { story_id: 's_qosezd', reaction_type: 'mind', count: 5 },
        { story_id: 's_yagyed', reaction_type: 'love', count: 2 }
      ]);
    }
    // news_stories queries
    if (url.searchParams.get('approved') === 'eq.false') return Response.json([]);
    return Response.json([
      { provider: 'gnews', category: 'childcare', title: 'Toy story', article_url: 'https://publisher.example/toy', interest_keywords: ['childcare-babies'], approved: true, published_at: '2026-10-17T14:00:00Z' },
      { provider: 'gnews', category: 'childcare', title: 'Dino story', article_url: 'https://publisher.example/dino', interest_keywords: ['childcare-babies'], approved: true, published_at: '2026-10-17T12:00:00Z' },
      { provider: 'gnews', category: 'childcare', title: 'Family story', article_url: 'https://publisher.example/family', interest_keywords: ['childcare-babies'], approved: true, published_at: '2026-10-17T10:00:00Z' }
    ]);
  };
  try {
    const result = await getPlayroomFeed(env, null, null, 'littlables', 'my-playroom');
    assert.deepEqual(result.items.map(item => item.title), ['Dino story', 'Toy story', 'Family story']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getPlayroomFeed returns empty for missing playroom', async () => {
  const { getPlayroomFeed } = await import('./news-storage.mjs');
  const result = await getPlayroomFeed(env, null, null, null, null);
  assert.deepEqual(result.playroom, null);
  assert.deepEqual(result.spaces, []);
  assert.deepEqual(result.items, []);
});

test('getPlayroomFeed resolves username+slug to playroom', async () => {
  const { getPlayroomFeed } = await import('./news-storage.mjs');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const table = url.pathname.split('/').pop();
    if (table === 'profiles') {
      return Response.json([{ id: 'user-123' }]);
    }
    if (table === 'playrooms' && url.searchParams.get('select') === 'id') {
      return Response.json([{ id: 'playroom-456' }]);
    }
    if (table === 'playrooms') {
      return Response.json([{
        id: 'playroom-456',
        user_id: 'user-123',
        name: 'My Playroom',
        slug: 'my-playroom'
      }]);
    }
    if (table === 'playroom_spaces') {
      return Response.json([{
        position: 0,
        boards: {
          id: 'space-789',
          name: 'Babies',
          slug: 'babies',
          pills: [{ type: 'keyword', id: 'childcare-babies' }]
        }
      }]);
    }
    // news_stories queries
    return Response.json([{
      provider: 'gnews',
      category: 'childcare',
      title: 'Playroom story',
      article_url: 'https://publisher.example/pr1',
      interest_keywords: ['childcare-babies'],
      approved: url.searchParams.get('approved') === 'eq.true',
      published_at: '2026-10-23T12:00:00Z',
      fetched_at: '2026-10-23T13:00:00Z'
    }]);
  };
  try {
    const result = await getPlayroomFeed(env, null, null, 'littlables', 'my-playroom');
    assert.equal(result.playroom.id, 'playroom-456');
    assert.equal(result.playroom.name, 'My Playroom');
    assert.equal(result.spaces.length, 1);
    assert.equal(result.spaces[0].name, 'Babies');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, 'Playroom story');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extractAiText reads choices-first like the AI tags extractor', () => {
  assert.equal(extractAiText({ choices: [{ message: { content: 'hello' } }] }), 'hello');
  assert.equal(extractAiText({ choices: [{ message: { content: 'hi' } }], response: { nested: true } }), 'hi');
  assert.equal(extractAiText('plain'), 'plain');
  assert.equal(extractAiText({ response: 'old shape' }), 'old shape');
  assert.equal(extractAiText({ response: { choices: [{ message: { content: 'nested' } }] } }), 'nested');
  assert.equal(extractAiText({ response: {} }), '');
  assert.equal(extractAiText(null), '');
});

test('AI curation uses choices-style model responses instead of silently falling back to heuristics', async () => {
  const aiEnv = {
    AI: {
      run: async (model) => {
        assert.match(model, /llama-3\.2-3b-instruct/);
        return {
          choices: [{ message: { content: JSON.stringify([{ id: 2, score: 95, reason: 'AI picked this one' }]) } }]
        };
      }
    }
  };
  const pendingRows = [
    { id: 1, provider: 'gnews', category: 'animals', title: 'Rescue otters learn to stack cups at the aquarium', article_url: 'https://publisher.example/otters', description: 'Otter enrichment fun', source_name: 'Example', published_at: '2026-10-25T10:00:00Z', fetched_at: '2026-10-25T11:00:00Z' },
    { id: 2, provider: 'gnews', category: 'animals', title: 'A backyard observatory spots a rare comet', article_url: 'https://publisher.example/comet', description: 'Stargazing news', source_name: 'Example', published_at: '2026-10-25T10:00:00Z', fetched_at: '2026-10-25T11:00:00Z' }
  ];
  const result = await runAiStoryCuration(aiEnv, {
    force: true,
    triggerSource: 'manual',
    preloadedRecentRows: [],
    preloadedBannedRows: [],
    preloadedPendingRows: pendingRows
  });
  assert.equal(result.skipped, false);
  assert.equal(result.totalStagedInRun, 2);
  assert.equal(result.stagedByCategory.animals, 2);
  const topPick = result.aiCuration.stagedPicks.find(p => p.category === 'animals' && p.rank === 1);
  assert.equal(topPick.storyId, 2);
  assert.equal(topPick.score, 95);
  assert.equal(topPick.reason, 'AI picked this one');
});

test('batch upsert posts one request for several categories with dedup', async () => {
  const originalFetch = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    posts.push({ url, body: JSON.parse(options.body) });
    return new Response(null, { status: 204 });
  };
  try {
    const result = await upsertNewsStoriesBatch(env, 'gnews', [
      { category: 'childcare', stories: [
        { title: 'A', link: 'https://example.com/a', image: null, description: 'd', content: 'c', pubDate: '2026-10-30T00:00:00Z', source: 'S' },
        { title: 'A dup', link: 'https://example.com/a' }
      ] },
      { category: 'animals', stories: [{ title: 'B', link: 'https://example.com/b' }] }
    ]);
    assert.equal(posts.length, 1, 'all categories must share one upsert POST');
    assert.equal(posts[0].url.searchParams.get('on_conflict'), 'provider,category,article_url');
    assert.equal(posts[0].body.length, 2);
    assert.deepEqual(posts[0].body.map(r => r.category), ['childcare', 'animals']);
    assert.equal(result.savedCount, 2);
    assert.equal(result.duplicatesSkipped, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('batch upsert throws on HTTP failure so callers can fall back', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 500 });
  try {
    await assert.rejects(
      upsertNewsStoriesBatch(env, 'gnews', [
        { category: 'childcare', stories: [{ title: 'A', link: 'https://example.com/a' }] }
      ]),
      /Saving gnews stories failed \(HTTP 500\)/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('flushProviderFetchLogs bulk-posts entries and falls back per entry on failure', async () => {
  const originalFetch = globalThis.fetch;
  const posts = [];
  let failBulk = true;
  globalThis.fetch = async (input, options) => {
    const body = JSON.parse(options.body);
    posts.push(body);
    if (failBulk && body.length > 1) return new Response(null, { status: 500 });
    return new Response(null, { status: 204 });
  };
  try {
    const n = await flushProviderFetchLogs(env, [
      { provider: 'gnews', category: 'all', status: 'succeeded' },
      { provider: 'bing', category: 'tech', status: 'succeeded' }
    ]);
    assert.equal(n, 2);
    assert.equal(posts.length, 3, 'bulk attempt + 2 individual fallbacks');
    assert.equal(posts[0].length, 2);
    assert.equal(posts[1].length, 1);
    assert.equal(posts[1][0].provider, 'gnews');
    assert.equal(posts[2][0].provider, 'bing');

    posts.length = 0;
    failBulk = false;
    const n2 = await flushProviderFetchLogs(env, [
      { provider: 'gnews', category: 'all', status: 'succeeded' }
    ]);
    assert.equal(n2, 1);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('flushProviderFetchLogs never throws', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const n = await flushProviderFetchLogs(env, [
      { provider: 'gnews', category: 'all', status: 'succeeded' }
    ]);
    assert.equal(n, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadProviderCooldownsFromDbIfStale loads once per window', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    fetches++;
    if (url.pathname.endsWith('/news_provider_sync')) {
      return Response.json([{
        provider: 'stale-test-provider',
        cooldown_until: new Date(Date.now() + 3600 * 1000).toISOString(),
        rate_limit_reset_at: null,
        last_error: 'test'
      }]);
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    clearProviderCooldownState('stale-test-provider');
    const first = await loadProviderCooldownsFromDbIfStale(env);
    assert.equal(first, 1);
    assert.equal(fetches, 1);
    const state = getProviderCooldownState('stale-test-provider');
    assert.ok(state);
    assert.equal(state.provider, 'stale-test-provider');
    const second = await loadProviderCooldownsFromDbIfStale(env);
    assert.equal(second, false);
    assert.equal(fetches, 1, 'second call within the window must not refetch');
    const forced = await loadProviderCooldownsFromDbIfStale(env, 0);
    assert.equal(forced, 1);
    assert.equal(fetches, 2);
    clearProviderCooldownState('stale-test-provider');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateProviderSyncStatus patches status fields without touching started_at', async () => {
  const originalFetch = globalThis.fetch;
  // Simulate a provider row claimed by a live sweep: started_at is set.
  const dbRow = { provider: 'gnews', status: 'running', started_at: '2026-10-30T20:00:00.000Z', stories_saved: 0, last_error: null };
  const patches = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'supabase.example' && url.pathname.endsWith('/news_provider_sync') && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      patches.push(body);
      Object.assign(dbRow, body);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const ok = await updateProviderSyncStatus(env, 'gnews', { status: 'succeeded', storiesSaved: 42 });
    assert.equal(ok, true);
    assert.equal(patches.length, 1);
    assert.ok(!('started_at' in patches[0]), 'PATCH must never include started_at');
    assert.equal(patches[0].status, 'succeeded');
    assert.equal(patches[0].stories_saved, 42);
    assert.equal(patches[0].last_error, null);
    assert.ok(patches[0].last_success_at);
    assert.ok(patches[0].updated_at);
    assert.equal(dbRow.started_at, '2026-10-30T20:00:00.000Z', 'live sweep claim survives the update');
    assert.equal(dbRow.status, 'succeeded');
    assert.equal(dbRow.stories_saved, 42);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateProviderSyncStatus fails open on HTTP errors and thrown fetches', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 500 });
    assert.equal(await updateProviderSyncStatus(env, 'gnews', { status: 'succeeded', storiesSaved: 1 }), false);
    globalThis.fetch = async () => { throw new Error('network down'); };
    assert.equal(await updateProviderSyncStatus(env, 'gnews', { status: 'succeeded', storiesSaved: 1 }), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
