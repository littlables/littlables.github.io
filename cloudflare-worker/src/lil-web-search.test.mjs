import test from 'node:test';
import assert from 'node:assert/strict';

import {
  searchWikipedia,
  searchCeramic,
  searchSerper,
  searchApprovedBalloons,
  searchLilWebSources,
  logLilSearch,
  isFlaggedText,
  extractSearchKeywords,
  trimText,
  domainOf,
  LIL_WIKIPEDIA_USER_AGENT
} from './lil-web-search.mjs';

const ENV = {
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_SECRET_KEY: 'service-secret',
  SERPER_API_KEY: 'serper-test-key'
};

// ENV plus a mocked Workers AI websearch binding returning the given items,
// shaped like the real binding response (`{ items, metadata }`).
function ceramicEnv(items) {
  return {
    ...ENV,
    AI: {
      websearch: async () => Response.json({
        items,
        metadata: { query: 'mock', requestId: 'req-mock', latencyMs: 12 }
      })
    }
  };
}

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
    interest_keywords: [],
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

test('searchLilWebSources keeps balloons out of grounding; Wikipedia and Serper ground the answer', async () => {
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
    const result = await searchLilWebSources(ceramicEnv([]), 'pandas');
    // Grounding is Wikipedia + Serper only — the balloon is separate, and
    // Ceramic ran (empty) between them.
    assert.equal(result.sources.length, 3);
    assert.equal(result.sources[0].title, 'Panda');
    assert.equal(result.sources[1].title, 'Panda facts');
    assert.equal(result.sources[2].title, 'More pandas');
    assert.deepEqual(result.balloons.map((b) => b.title), ['Giant pandas eat bamboo all day']);
    assert.deepEqual(result.layersUsed, ['wikipedia', 'serper']);
    assert.deepEqual(result.searchQueries, ['Wikipedia: pandas', 'Ceramic: pandas', 'Serper: pandas']);
    assert.deepEqual(result.counts, { balloons: 1, wikipedia: 1, ceramic: 0, serper: 2, flaggedFiltered: 1 });
    assert.deepEqual(result.layerErrors, {});
    assert.equal(result.serperSkipped, null);
    assert.equal(typeof result.latencyMs, 'number');
    // The balloon's text never reaches the model prompt.
    assert.equal(result.grounding.length, 3);
    assert.match(result.grounding[0].text, /bears/);
    assert.equal(result.grounding.some((g) => /bamboo all day/i.test(g.text)), false);
    assert.deepEqual(calledHosts, ['supabase.example', 'en.wikipedia.org', 'google.serper.dev']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchLilWebSources still runs Wikipedia and Serper when balloons are plentiful', async () => {
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
    if (url.hostname === 'en.wikipedia.org') {
      return Response.json({
        query: {
          pages: [{ title: 'Panda', extract: 'Pandas are bears.', canonicalurl: 'https://en.wikipedia.org/wiki/Panda' }]
        }
      });
    }
    if (url.hostname === 'google.serper.dev') {
      return Response.json({
        organic: [{ title: 'Panda facts', link: 'https://kids.example.com/pandas', snippet: 'Fun panda facts.', position: 1 }]
      });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const result = await searchLilWebSources(ceramicEnv([]), 'pandas');
    // Four balloons ride along, but the web layers run anyway — balloons
    // no longer count toward the "thin" threshold. Ceramic ran (empty)
    // between Wikipedia and Serper.
    assert.equal(result.balloons.length, 4);
    assert.equal(result.sources.length, 2);
    assert.equal(result.sources[0].title, 'Panda');
    assert.deepEqual(result.layersUsed, ['wikipedia', 'serper']);
    assert.deepEqual(result.searchQueries, ['Wikipedia: pandas', 'Ceramic: pandas', 'Serper: pandas']);
    assert.deepEqual(calledHosts, ['supabase.example', 'en.wikipedia.org', 'google.serper.dev']);
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
    assert.deepEqual(result.balloons, []);
    assert.deepEqual(result.grounding, []);
    assert.deepEqual(result.counts, { balloons: 0, wikipedia: 0, ceramic: 0, serper: 0, flaggedFiltered: 0 });
    // Unlike the old searchNewsStories path (which swallowed its own
    // failures), searchApprovedBalloons reports its error, so both failed
    // layers show up here — plus Ceramic, whose binding is missing from
    // this env entirely.
    assert.deepEqual(result.layerErrors, { balloons: 'fetch-failed', wikipedia: 'fetch-failed', ceramic: 'unavailable' });
    assert.equal(result.serperSkipped, 'no-key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extractSearchKeywords keeps content words and drops the question', () => {
  assert.deepEqual(
    extractSearchKeywords('What new space discoveries happened recently from the James Webb telescope?'),
    ['space', 'discoveries', 'james', 'webb', 'telescope']
  );
  assert.deepEqual(extractSearchKeywords('pandas'), ['pandas']);
  assert.deepEqual(extractSearchKeywords('What is the moon?'), ['moon']);
  assert.deepEqual(extractSearchKeywords('How far away is K2-18b?'), ['far', 'away', 'k2-18b']);
  assert.deepEqual(extractSearchKeywords('What is it?'), []);
  assert.deepEqual(extractSearchKeywords(''), []);
  assert.deepEqual(extractSearchKeywords(null), []);
  // Deduplicated and capped at 5, in order.
  assert.deepEqual(
    extractSearchKeywords('Tell me about pandas pandas and bamboo and bears and forests and eating'),
    ['pandas', 'bamboo', 'bears', 'forests', 'eating']
  );
});

test('isFlaggedText catches the death words the JWST live test exposed', () => {
  for (const flagged of [
    'Mother and daughter killed in grizzly bear attack',
    'Miami helicopter crash leaves one person dead and two injured',
    'Beloved actor dies at 92',
    'Man died after a fall',
    'Deadly disease spreads in the region',
    'Scientist stabbed in the park',
    'Teen dies by suicide'
  ]) {
    assert.equal(isFlaggedText(flagged), true, flagged);
  }
  for (const clean of [
    'Shooting stars light up the night sky',
    'Flu shots keep kids healthy',
    'The project deadline is Friday',
    'Studies show pandas love bamboo',
    'How do caterpillars turn into butterflies?'
  ]) {
    assert.equal(isFlaggedText(clean), false, clean);
  }
});

test('searchApprovedBalloons is approved-only and drops excluded-interest rows', async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl;
  globalThis.fetch = async (input) => {
    seenUrl = String(input);
    return Response.json([
      balloonRow({ id: 's1', title: 'James Webb telescope finds water vapor', article_url: 'https://example.com/webb' }),
      balloonRow({ id: 's2', title: 'Zelensky doubts Musk acted alone', article_url: 'https://example.com/zelensky', interest_keywords: ['politics'] }),
      balloonRow({ id: 's3', title: 'Bear attack kills hikers', article_url: 'https://example.com/bears', interest_keywords: ['death'] }),
      balloonRow({ id: 's4', title: 'Webb spots a distant galaxy', article_url: 'https://example.com/galaxy', approved: false }),
      balloonRow({ id: 's5', title: 'Stock market crash wipes out gains', article_url: 'https://example.com/stocks' })
    ]);
  };
  try {
    const { sources, flaggedFiltered, error } = await searchApprovedBalloons(ENV, 'James Webb telescope');
    assert.equal(error, null);
    assert.equal(sources.length, 2);
    assert.equal(sources[0].title, 'James Webb telescope finds water vapor');
    // Politics + death dropped by classification here (flaggedFiltered 2).
    // The stocks row survives this level — the stem filter in the
    // orchestrator drops it, and the JWST regression test below proves it.
    assert.equal(sources[1].title, 'Stock market crash wipes out gains');
    assert.equal(flaggedFiltered, 2);
    assert.match(seenUrl, /approved=eq\.true/);
    assert.match(seenUrl, /removed=eq\.false/);
    assert.match(seenUrl, /title\.ilike\.\*james\*/);
    assert.match(seenUrl, /title\.ilike\.\*webb\*/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchApprovedBalloons skips the fetch when no keywords survive', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json([]); };
  try {
    assert.deepEqual(
      await searchApprovedBalloons(ENV, 'What is it?'),
      { sources: [], flaggedFiltered: 0, error: null }
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchApprovedBalloons fails open on HTTP errors, bad bodies, and thrown fetches', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('nope', { status: 500 });
    assert.deepEqual(
      await searchApprovedBalloons(ENV, 'pandas'),
      { sources: [], flaggedFiltered: 0, error: 'http-500' }
    );
    globalThis.fetch = async () => Response.json({ notRows: true });
    assert.deepEqual(
      await searchApprovedBalloons(ENV, 'pandas'),
      { sources: [], flaggedFiltered: 0, error: 'bad-response' }
    );
    globalThis.fetch = async () => { throw new Error('network down'); };
    assert.deepEqual(
      await searchApprovedBalloons(ENV, 'pandas'),
      { sources: [], flaggedFiltered: 0, error: 'fetch-failed' }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchLilWebSources JWST regression: Wikipedia grounds, space balloons ride along, no death or politics', async () => {
  const originalFetch = globalThis.fetch;
  const calledHosts = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calledHosts.push(url.hostname);
    if (url.pathname === '/rest/v1/news_stories') {
      return Response.json([
        balloonRow({ id: 's1', title: 'James Webb telescope finds water vapor on a distant planet', article_url: 'https://example.com/webb-water', interest_keywords: ['space'] }),
        balloonRow({ id: 's2', title: 'New images from the James Webb telescope', article_url: 'https://example.com/webb-images', interest_keywords: [] }),
        balloonRow({ id: 's3', title: 'Webb spots the oldest galaxy yet', article_url: 'https://example.com/galaxy', approved: false }),
        balloonRow({ id: 's4', title: 'Zelensky doubts Musk acted alone in Ukraine', article_url: 'https://example.com/zelensky', interest_keywords: ['politics'] }),
        balloonRow({ id: 's5', title: 'Mother and daughter killed in grizzly bear attack', article_url: 'https://example.com/bears', interest_keywords: ['death'] })
      ]);
    }
    if (url.hostname === 'en.wikipedia.org') {
      return Response.json({
        query: {
          pages: [{ title: 'James Webb Space Telescope', extract: 'The James Webb Space Telescope is a space telescope.', canonicalurl: 'https://en.wikipedia.org/wiki/James_Webb_Space_Telescope' }]
        }
      });
    }
    if (url.hostname === 'google.serper.dev') {
      return Response.json({ organic: [] });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const result = await searchLilWebSources(ceramicEnv([
      { title: 'James Webb telescope spots water vapor', url: 'https://example.com/ceramic-webb', description: 'Webb found water vapor on a distant world.' }
    ]), 'What new space discoveries happened recently from the James Webb telescope?');
    // Grounding is the Wikipedia article plus the Ceramic result — the two
    // approved space balloons are shown separately, never in the answer's
    // sources. Serper still ran (grounding was 2 after Ceramic) but found
    // nothing.
    assert.equal(result.sources.length, 2);
    assert.equal(result.sources[0].title, 'James Webb Space Telescope');
    assert.equal(result.sources[1].title, 'James Webb telescope spots water vapor');
    assert.deepEqual(result.balloons.map((b) => b.title), [
      'James Webb telescope finds water vapor on a distant planet',
      'New images from the James Webb telescope'
    ]);
    assert.deepEqual(result.layersUsed, ['wikipedia', 'ceramic']);
    assert.deepEqual(result.searchQueries, [
      'Wikipedia: What new space discoveries happened recently from the James Webb telescope?',
      'Ceramic: space discoveries james webb telescope',
      'Serper: What new space discoveries happened recently from the James Webb telescope?'
    ]);
    assert.deepEqual(result.counts, { balloons: 2, wikipedia: 1, ceramic: 1, serper: 0, flaggedFiltered: 2 });
    assert.equal(result.sources.some((s) => /Zelensky|killed|bear attack/i.test(s.title)), false);
    assert.equal(result.balloons.some((s) => /Zelensky|killed|bear attack/i.test(s.title)), false);
    assert.deepEqual(calledHosts, ['supabase.example', 'en.wikipedia.org', 'google.serper.dev']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchLilWebSources balloons never ground the answer when the web layers find nothing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/news_stories') {
      return Response.json([balloonRow()]);
    }
    if (url.hostname === 'en.wikipedia.org') {
      return Response.json({ query: { pages: [] } });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    // No Serper key: the layer is skipped, so the web layers contribute
    // nothing — the balloon is still shown, but the answer has no sources
    // to ground in, and the handler's refusal line applies. Ceramic is
    // attempted (the query has keywords) but this env has no websearch
    // binding, so it reports 'unavailable' instead of throwing.
    const result = await searchLilWebSources({ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SECRET_KEY: 'service-secret' }, 'pandas');
    assert.deepEqual(result.sources, []);
    assert.deepEqual(result.grounding, []);
    assert.deepEqual(result.balloons.map((b) => b.title), ['Giant pandas eat bamboo all day']);
    assert.deepEqual(result.layersUsed, []);
    assert.deepEqual(result.searchQueries, ['Wikipedia: pandas']);
    assert.deepEqual(result.counts, { balloons: 1, wikipedia: 0, ceramic: 0, serper: 0, flaggedFiltered: 0 });
    assert.deepEqual(result.layerErrors, { ceramic: 'unavailable' });
    assert.equal(result.serperSkipped, 'no-key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchCeramic calls the binding with gateway, provider and alias, and trims long descriptions', async () => {
  let seenArgs;
  const env = {
    ...ENV,
    AI: {
      websearch: async (args) => {
        seenArgs = args;
        return Response.json({
          items: [
            { title: 'Panda facts', url: 'https://kids.example.com/pandas', description: 'Fun panda facts.' },
            { title: 'Long read', url: 'https://example.org/pandas', description: 'x'.repeat(5000) },
            { title: '', url: 'https://example.org/empty', description: 'No title, dropped.' },
            { title: 'No URL', url: '', description: 'No URL, dropped.' }
          ],
          metadata: { query: 'pandas', requestId: 'req-1', latencyMs: 42 }
        });
      }
    }
  };
  const { results, error } = await searchCeramic(env, 'pandas');
  assert.equal(error, null);
  assert.deepEqual(seenArgs, {
    gatewayId: 'littlables-lil',
    query: 'pandas',
    provider: 'ceramic',
    byokAlias: 'default',
    limit: 5
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'Panda facts');
  assert.equal(results[0].snippet, 'Fun panda facts.');
  assert.equal(results[0].domain, 'kids.example.com');
  // Ceramic descriptions can run to 8,000 chars — trimmed to 300 like Serper's.
  assert.equal(results[1].snippet.length, 301);
  assert.ok(results[1].snippet.endsWith('…'));
});

test('searchCeramic fails open when the binding is missing or the call fails', async () => {
  assert.deepEqual(await searchCeramic({}, 'pandas'), { results: [], error: 'unavailable' });
  assert.deepEqual(await searchCeramic({ AI: {} }, 'pandas'), { results: [], error: 'unavailable' });
  assert.deepEqual(
    await searchCeramic({ AI: { websearch: async () => { throw new Error('down'); } } }, 'pandas'),
    { results: [], error: 'fetch-failed' }
  );
  // A missing provider/alias fails with 400 instead of falling back to credits.
  assert.deepEqual(
    await searchCeramic({ AI: { websearch: async () => new Response('nope', { status: 400 }) } }, 'pandas'),
    { results: [], error: 'http-400' }
  );
  assert.deepEqual(
    await searchCeramic({ AI: { websearch: async () => Response.json({ notItems: true }) } }, 'pandas'),
    { results: [], error: 'bad-response' }
  );
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
    assert.equal(seenBody.ceramic_count, 0);
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
