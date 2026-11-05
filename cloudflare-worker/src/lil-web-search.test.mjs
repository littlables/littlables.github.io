import test from 'node:test';
import assert from 'node:assert/strict';

import {
  searchWikipedia,
  searchSerper,
  searchLilWebSources,
  logLilSearch,
  isFlaggedText,
  trimText,
  domainOf,
  LIL_WIKIPEDIA_USER_AGENT
} from './lil-web-search.mjs';

const ENV = {
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_SECRET_KEY: 'service-secret',
  SERPER_API_KEY: 'serper-test-key'
};

function balloonRow(overrides = {}) {
  return {
    id: 'story-1',
    provider: 'gnews',
    category: 'animals',
    title: 'Giant pandas eat bamboo all day',
    article_url: 'https://example.com/pandas',
    image_url: null,
    description: 'Pandas spend most of their day eating bamboo.',
    content: null,
    ai_summary: null,
    published_at: '2026-11-04T10:00:00Z',
    source_name: 'Example News',
    approved: true,
    removed: false,
    fetched_at: '2026-11-04T10:00:00Z',
    ...overrides
  };
}

test('isFlaggedText flags excluded topics and passes clean kids topics', () => {
  for (const flagged of [
    'Stock market crash wipes out gains',
    'Bitcoin price surges overnight',
    'Election results are in',
    'Obituary: beloved actor dies at 92',
    'Senate passes new law',
    'How to invest in crypto',
    'Company announces layoffs',
    'Clickbait: you will not believe this'
  ]) {
    assert.equal(isFlaggedText(flagged), true, flagged);
  }
  for (const clean of [
    'Giant pandas eat bamboo',
    'How do pumpkins grow?',
    'NASA launches a rocket to Mars',
    'The history of cryptography',
    'Livestock on a family farm',
    'Why do cats purr?'
  ]) {
    assert.equal(isFlaggedText(clean), false, clean);
  }
  assert.equal(isFlaggedText(''), false);
  assert.equal(isFlaggedText(null), false);
});

test('trimText and domainOf handle the small cases', () => {
  assert.equal(trimText('  hello   world  ', 100), 'hello world');
  assert.equal(trimText('abcdefghij', 5), 'abcde…');
  assert.equal(domainOf('https://www.bbc.com/news/123'), 'bbc.com');
  assert.equal(domainOf('not a url'), '');
});

test('searchWikipedia parses generator results and sends the required User-Agent', async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, options = {}) => {
    seen.push({ url: String(input), headers: options.headers || {} });
    return Response.json({
      query: {
        pages: [
          {
            title: 'Giant panda',
            extract: 'The giant panda is a bear species endemic to China.',
            canonicalurl: 'https://en.wikipedia.org/wiki/Giant_panda'
          },
          { title: 'Red panda', extract: 'The red panda is a small mammal.', canonicalurl: '' }
        ]
      }
    });
  };
  try {
    const { results, error } = await searchWikipedia(ENV, 'pandas');
    assert.equal(error, null);
    assert.equal(results.length, 2);
    assert.equal(results[0].title, 'Giant panda');
    assert.equal(results[0].url, 'https://en.wikipedia.org/wiki/Giant_panda');
    assert.equal(results[0].domain, 'wikipedia.org');
    assert.match(results[0].snippet, /bear species endemic to China/);
    // No canonical URL falls back to a built Wikipedia link.
    assert.equal(results[1].url, 'https://en.wikipedia.org/wiki/Red_panda');
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /action=query/);
    assert.match(seen[0].url, /generator=search/);
    assert.match(seen[0].url, /gsrnamespace=0/);
    assert.equal(seen[0].headers['User-Agent'], LIL_WIKIPEDIA_USER_AGENT);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchWikipedia fails open on HTTP errors, bad bodies, and thrown fetches', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('nope', { status: 500 });
    assert.deepEqual(await searchWikipedia(ENV, 'pandas'), { results: [], error: 'http-500' });

    globalThis.fetch = async () => Response.json({ query: {} });
    assert.deepEqual(await searchWikipedia(ENV, 'pandas'), { results: [], error: 'bad-response' });

    globalThis.fetch = async () => { throw new Error('network down'); };
    assert.deepEqual(await searchWikipedia(ENV, 'pandas'), { results: [], error: 'fetch-failed' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchSerper skips without a key and never calls the API', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({ organic: [] }); };
  try {
    const result = await searchSerper({ SUPABASE_URL: ENV.SUPABASE_URL }, 'pandas');
    assert.deepEqual(result, { results: [], skipped: 'no-key', error: null });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchSerper trims snippets, sends the key header, and fails open', async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, options = {}) => {
    seen.push({ url: String(input), headers: options.headers || {}, body: options.body });
    return Response.json({
      organic: [
        { title: 'Pandas', link: 'https://www.example.com/pandas', snippet: 'x'.repeat(400), position: 1 },
        { title: '', link: 'https://example.com/empty', snippet: 'no title', position: 2 },
        { title: 'No link', link: '', snippet: 'no link', position: 3 }
      ]
    });
  };
  try {
    const { results, skipped, error } = await searchSerper(ENV, 'pandas');
    assert.equal(skipped, null);
    assert.equal(error, null);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Pandas');
    assert.equal(results[0].domain, 'example.com');
    assert.equal(results[0].snippet.length, 301); // 300 chars + ellipsis
    assert.equal(seen.length, 1);
    assert.equal(seen[0].headers['X-API-KEY'], 'serper-test-key');
    assert.equal(JSON.parse(seen[0].body).q, 'pandas');
    assert.equal(JSON.parse(seen[0].body).num, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchSerper reports timeout when the call hangs past the abort', async () => {
  const originalFetch = globalThis.fetch;
  // Abort-aware mock (per abort_aware_test_mocks): the hang only settles
  // when the signal fires, so the test stays fast with a short timeout.
  globalThis.fetch = async (input, options = {}) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });
  try {
    const result = await searchSerper(ENV, 'pandas', { timeoutMs: 20 });
    assert.deepEqual(result, { results: [], skipped: null, error: 'timeout' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchSerper fails open on HTTP errors and bad bodies', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('nope', { status: 429 });
    assert.deepEqual(
      await searchSerper(ENV, 'pandas'),
      { results: [], skipped: null, error: 'http-429' }
    );
    globalThis.fetch = async () => Response.json({ notOrganic: true });
    assert.deepEqual(
      await searchSerper(ENV, 'pandas'),
      { results: [], skipped: null, error: 'bad-response' }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchLilWebSources puts balloons first and only calls Serper when thin', async () => {
  const originalFetch = globalThis.fetch;
  const calledHosts = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calledHosts.push(url.hostname);
    if (url.pathname === '/rest/v1/news_stories') {
      return Response.json([
        balloonRow(),
        balloonRow({ id: 'story-2', title: 'Stock market crash wipes out gains', article_url: 'https://example.com/stocks' })
      ]);
    }
    if (url.hostname === 'en.wikipedia.org') {
      return Response.json({
        query: {
          pages: [{ title: 'Panda', extract: 'Pandas are bears.', canonicalurl: 'https://en.wikipedia.org/wiki/Panda' }]
        }
      });
    }
    if (url.hostname === 'google.serper.dev') {
      return Response.json({
        organic: [
          { title: 'Panda facts', link: 'https://kids.example.com/pandas', snippet: 'Fun panda facts.', position: 1 },
          { title: 'More pandas', link: 'https://example.org/pandas', snippet: 'Even more.', position: 2 }
        ]
      });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const result = await searchLilWebSources(ENV, 'pandas');
    assert.equal(result.sources.length, 4);
    assert.equal(result.sources[0].title, 'Giant pandas eat bamboo all day');
    assert.equal(result.sources[1].title, 'Panda');
    assert.equal(result.sources[2].title, 'Panda facts');
    assert.deepEqual(result.layersUsed, ['balloons', 'wikipedia', 'serper']);
    assert.deepEqual(result.searchQueries, ['Wikipedia: pandas', 'Serper: pandas']);
    assert.deepEqual(result.counts, { balloons: 1, wikipedia: 1, serper: 2, flaggedFiltered: 1 });
    assert.deepEqual(result.layerErrors, {});
    assert.equal(result.serperSkipped, null);
    assert.equal(typeof result.latencyMs, 'number');
    assert.equal(result.grounding.length, 4);
    assert.match(result.grounding[0].text, /bamboo/);
    assert.deepEqual(calledHosts, ['supabase.example', 'en.wikipedia.org', 'google.serper.dev']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchLilWebSources skips Wikipedia and Serper when balloons already answer', async () => {
  const originalFetch = globalThis.fetch;
  const calledHosts = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calledHosts.push(url.hostname);
    if (url.pathname === '/rest/v1/news_stories') {
      return Response.json([
        balloonRow({ id: 's1', title: 'Panda one', article_url: 'https://example.com/1' }),
        balloonRow({ id: 's2', title: 'Panda two', article_url: 'https://example.com/2' }),
        balloonRow({ id: 's3', title: 'Panda three', article_url: 'https://example.com/3' }),
        balloonRow({ id: 's4', title: 'Panda four', article_url: 'https://example.com/4' })
      ]);
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const result = await searchLilWebSources(ENV, 'pandas');
    assert.equal(result.sources.length, 4);
    assert.deepEqual(result.layersUsed, ['balloons']);
    assert.deepEqual(result.searchQueries, []);
    assert.deepEqual(calledHosts, ['supabase.example']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchLilWebSources fails open when every layer fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const result = await searchLilWebSources({ SUPABASE_URL: ENV.SUPABASE_URL }, 'pandas');
    assert.deepEqual(result.sources, []);
    assert.deepEqual(result.grounding, []);
    assert.deepEqual(result.counts, { balloons: 0, wikipedia: 0, serper: 0, flaggedFiltered: 0 });
    // searchNewsStories fails open silently (a balloons failure is
    // indistinguishable from no matches), so only the layers that report
    // their own errors show up here.
    assert.deepEqual(result.layerErrors, { wikipedia: 'fetch-failed' });
    assert.equal(result.serperSkipped, 'no-key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('logLilSearch stores metadata only — never a title, description, or snippet', async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl;
  let seenBody;
  globalThis.fetch = async (input, options = {}) => {
    seenUrl = String(input);
    seenBody = JSON.parse(options.body);
    return new Response(null, { status: 201 });
  };
  try {
    const ok = await logLilSearch(ENV, {
      userId: 'admin-user',
      query: 'pandas',
      layersUsed: ['balloons', 'wikipedia'],
      counts: { balloons: 1, wikipedia: 1, serper: 0, flaggedFiltered: 1 },
      resultUrls: ['https://example.com/pandas', 'https://en.wikipedia.org/wiki/Panda'],
      domains: ['example.com', 'wikipedia.org'],
      latencyMs: 123,
      status: 'ok',
      errorType: null
    });
    assert.equal(ok, true);
    assert.match(seenUrl, /\/rest\/v1\/lil_search_log$/);
    assert.equal(seenBody.user_id, 'admin-user');
    assert.equal(seenBody.query, 'pandas');
    assert.deepEqual(seenBody.layers, ['balloons', 'wikipedia']);
    assert.equal(seenBody.balloons_count, 1);
    assert.equal(seenBody.flagged_filtered, 1);
    assert.deepEqual(seenBody.result_urls, ['https://example.com/pandas', 'https://en.wikipedia.org/wiki/Panda']);
    // The payload must carry no result text at all.
    const bodyText = JSON.stringify(seenBody);
    assert.doesNotMatch(bodyText, /"title"/);
    assert.doesNotMatch(bodyText, /"snippet"/);
    assert.doesNotMatch(bodyText, /"description"/);
    assert.doesNotMatch(bodyText, /bamboo/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('logLilSearch fails open and never throws', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('nope', { status: 500 });
    assert.equal(await logLilSearch(ENV, { userId: 'u1', query: 'x' }), false);
    globalThis.fetch = async () => { throw new Error('down'); };
    assert.equal(await logLilSearch(ENV, { userId: 'u1', query: 'x' }), false);
    assert.equal(await logLilSearch({}, { userId: 'u1', query: 'x' }), false);
    assert.equal(await logLilSearch(ENV, { query: 'x' }), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
