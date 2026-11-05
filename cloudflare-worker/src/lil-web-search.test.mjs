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
  isBlockedDomain,
  isRelevantToKeywords,
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

test('isBlockedDomain matches the domain and its subdomains, and nothing else', () => {
  for (const blocked of [
    'theblackvault.com',
    'www.theblackvault.com',
    'news.theblackvault.com',
    'INFOWARS.COM',
    'www.naturalnews.com',
    'theonion.com'
  ]) {
    assert.equal(isBlockedDomain(blocked), true, blocked);
  }
  for (const clean of [
    'example.com',
    'theblackvault.com.evil.com',
    'nottheblackvault.com',
    'mytheonion.com',
    'wikipedia.org',
    '',
    null,
    undefined
  ]) {
    assert.equal(isBlockedDomain(clean), false, String(clean));
  }
});

test('isRelevantToKeywords keeps on-topic Wikipedia results and drops the 2026-11-05 junk', () => {
  const jwst = ['space', 'discoveries', 'james', 'webb', 'telescope'];
  const env = ['inspiring', 'positive', 'environmental', 'nature', 'stories'];
  // On-topic: the title or the extract shares a keyword.
  assert.equal(isRelevantToKeywords('James Webb Space Telescope', 'The James Webb Space Telescope is a space telescope.', jwst), true);
  assert.equal(isRelevantToKeywords('New Horizons', "New Horizons is an interplanetary space probe that was launched as a part of NASA's New Frontiers program.", jwst), true);
  // Loose but real: Chronology of the universe shares no JWST keyword,
  // so it drops — that is the screen working, not a miss.
  assert.equal(isRelevantToKeywords('Chronology of the universe', 'The chronology of the universe describes the history and future of the universe.', jwst), false);
  // The environmental question's live junk, with the real extracts
  // Wikipedia returned — none shares a keyword with the question.
  assert.equal(isRelevantToKeywords('Hitachi Magic Wand', 'The Magic Wand (formerly known as the Hitachi Magic Wand) is an AC-powered wand vibrator. It was originally manufactured for relieving tension and relaxing sore muscles.', env), false);
  assert.equal(isRelevantToKeywords('2021 in science', 'This is a list of several significant scientific events that occurred or were scheduled to occur in 2021.', env), false);
  assert.equal(isRelevantToKeywords('Machiavellianism (psychology)', 'In the field of personality psychology, Machiavellianism (sometimes abbreviated as MACH) is the name of a personality trait construct characterized by manipulativeness, callousness, and indifference to morality.', env), false);
  // Singular: 'pandas' matches an article titled 'Panda'.
  assert.equal(isRelevantToKeywords('Panda', 'Bears that eat bamboo.', ['pandas']), true);
  // But 'news' never becomes 'new'.
  assert.equal(isRelevantToKeywords('New Horizons', 'New images from the probe.', ['news']), false);
  // Empty keywords or empty text match nothing.
  assert.equal(isRelevantToKeywords('Panda', 'Pandas are bears.', []), false);
  assert.equal(isRelevantToKeywords('', '', ['pandas']), false);
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
    assert.deepEqual(result.counts, { balloons: 1, wikipedia: 1, ceramic: 0, serper: 2, flaggedFiltered: 1, irrelevantFiltered: 0 });
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
    assert.deepEqual(result.counts, { balloons: 0, wikipedia: 0, ceramic: 0, serper: 0, flaggedFiltered: 0, irrelevantFiltered: 0 });
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
    assert.deepEqual(result.counts, { balloons: 2, wikipedia: 1, ceramic: 1, serper: 0, flaggedFiltered: 2, irrelevantFiltered: 0 });
    assert.equal(result.sources.some((s) => /Zelensky|killed|bear attack/i.test(s.title)), false);
    assert.equal(result.balloons.some((s) => /Zelensky|killed|bear attack/i.test(s.title)), false);
    assert.deepEqual(calledHosts, ['supabase.example', 'en.wikipedia.org', 'google.serper.dev']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchLilWebSources drops blocked domains from web layers but keeps an approved balloon from one', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/news_stories') {
      return Response.json([
        // Approved by Katie, so the domain screen must not touch it —
        // her curation outranks the blocklist.
        balloonRow({ id: 's1', title: 'Webb finds a new galaxy', article_url: 'https://theblackvault.com/webb-galaxy', interest_keywords: ['space'] })
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
      return Response.json({
        organic: [
          { title: 'Scientists confirm the Moon is made of cheese', link: 'https://theonion.com/moon-cheese', snippet: 'A shocking discovery.' },
          { title: 'Webb telescope images a distant nebula', link: 'https://example.com/serper-webb', snippet: 'New images from Webb.' }
        ]
      });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const result = await searchLilWebSources(ceramicEnv([
      { title: 'NASA Denies Existence of Classified Briefings on James Webb Telescope Discoveries', url: 'https://theblackvault.com/nasa-briefings', description: 'NASA says there are no classified briefings.' },
      { title: 'James Webb telescope spots water vapor', url: 'https://example.com/ceramic-webb', description: 'Webb found water vapor on a distant world.' }
    ]), 'What new space discoveries happened recently from the James Webb telescope?');
    // The blocked Ceramic result (theblackvault.com) and the blocked
    // Serper result (theonion.com) never reach the grounding; the clean
    // result from each layer does. The approved balloon from
    // theblackvault.com rides along untouched.
    assert.equal(result.sources.length, 3);
    assert.equal(result.sources.some((s) => isBlockedDomain(s.domain)), false);
    assert.deepEqual(result.sources.map((s) => s.domain), ['wikipedia.org', 'example.com', 'example.com']);
    assert.deepEqual(result.balloons.map((b) => b.domain), ['theblackvault.com']);
    assert.deepEqual(result.layersUsed, ['wikipedia', 'ceramic', 'serper']);
    assert.deepEqual(result.counts, { balloons: 1, wikipedia: 1, ceramic: 1, serper: 1, flaggedFiltered: 2, irrelevantFiltered: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchLilWebSources drops irrelevant Wikipedia results so the live layers run (environmental question)', async () => {
  const originalFetch = globalThis.fetch;
  const query = 'What are the most inspiring positive environmental and nature news stories lately?';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/news_stories') {
      return Response.json([
        balloonRow({ id: 's1', title: 'Nature reserve opens for injured wildlife', article_url: 'https://example.com/nature-reserve', description: 'A new reserve gives injured wildlife a safe home.', interest_keywords: [] })
      ]);
    }
    if (url.hostname === 'en.wikipedia.org') {
      // The exact junk Wikipedia returned live for this question.
      return Response.json({
        query: {
          pages: [
            { title: 'Hitachi Magic Wand', extract: 'The Magic Wand (formerly known as the Hitachi Magic Wand) is an AC-powered wand vibrator. It was originally manufactured for relieving tension and relaxing sore muscles.', canonicalurl: 'https://en.wikipedia.org/wiki/Hitachi_Magic_Wand' },
            { title: '2021 in science', extract: 'This is a list of several significant scientific events that occurred or were scheduled to occur in 2021.', canonicalurl: 'https://en.wikipedia.org/wiki/2021_in_science' },
            { title: 'Machiavellianism (psychology)', extract: 'In the field of personality psychology, Machiavellianism (sometimes abbreviated as MACH) is the name of a personality trait construct characterized by manipulativeness, callousness, and indifference to morality.', canonicalurl: 'https://en.wikipedia.org/wiki/Machiavellianism_(psychology)' }
          ]
        }
      });
    }
    if (url.hostname === 'google.serper.dev') {
      return Response.json({
        organic: [
          { title: 'Renewable energy grows', link: 'https://example.org/renewables', snippet: 'Solar power keeps growing.', position: 1 },
          { title: 'Wildlife numbers recover', link: 'https://example.org/wildlife', snippet: 'Conservation helps wildlife recover.', position: 2 }
        ]
      });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const result = await searchLilWebSources(ceramicEnv([
      { title: 'New tree planting project restores forests', url: 'https://example.com/tree-planting', description: 'Volunteers planted a million trees.' },
      { title: 'Ocean cleanup removes plastic', url: 'https://kids.example.com/ocean-cleanup', description: 'A cleanup crew removed plastic from the ocean.' }
    ]), query);
    // All three Wikipedia results are dropped by the relevance screen,
    // so the grounding is live-only — and because the count no longer
    // hits the minimum on junk, both live layers run.
    assert.equal(result.sources.length, 4);
    assert.equal(result.sources.some((s) => s.domain === 'wikipedia.org'), false);
    assert.deepEqual(result.layersUsed, ['ceramic', 'serper']);
    assert.deepEqual(result.searchQueries, [
      `Wikipedia: ${query}`,
      'Ceramic: inspiring positive environmental nature stories',
      `Serper: ${query}`
    ]);
    assert.deepEqual(result.counts, { balloons: 1, wikipedia: 0, ceramic: 2, serper: 2, flaggedFiltered: 0, irrelevantFiltered: 3 });
    assert.deepEqual(result.balloons.map((b) => b.title), ['Nature reserve opens for injured wildlife']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchLilWebSources keeps running live layers until 5 grounded sources', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/news_stories') {
      return Response.json([balloonRow()]);
    }
    if (url.hostname === 'en.wikipedia.org') {
      return Response.json({
        query: {
          pages: [
            { title: 'Panda', extract: 'Pandas are bears.', canonicalurl: 'https://en.wikipedia.org/wiki/Panda' },
            { title: 'Giant panda', extract: 'The giant panda is a bear species.', canonicalurl: 'https://en.wikipedia.org/wiki/Giant_panda' },
            { title: 'Red panda', extract: 'The red panda is a small mammal.', canonicalurl: 'https://en.wikipedia.org/wiki/Red_panda' }
          ]
        }
      });
    }
    if (url.hostname === 'google.serper.dev') {
      return Response.json({
        organic: [{ title: 'More panda news', link: 'https://example.org/panda-news', snippet: 'Pandas in the news.', position: 1 }]
      });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const result = await searchLilWebSources(ceramicEnv([
      { title: 'Panda conservation wins', url: 'https://example.com/panda-win', description: 'Panda numbers are up.' }
    ]), 'pandas');
    // Three good Wikipedia results used to satisfy the old "3 is
    // enough" gate and stop the live layers. Now they keep running
    // until 5 grounded sources: Ceramic adds one, Serper adds one.
    assert.equal(result.sources.length, 5);
    assert.deepEqual(result.sources.map((s) => s.title), ['Panda', 'Giant panda', 'Red panda', 'Panda conservation wins', 'More panda news']);
    assert.deepEqual(result.layersUsed, ['wikipedia', 'ceramic', 'serper']);
    assert.deepEqual(result.searchQueries, ['Wikipedia: pandas', 'Ceramic: pandas', 'Serper: pandas']);
    assert.deepEqual(result.counts, { balloons: 1, wikipedia: 3, ceramic: 1, serper: 1, flaggedFiltered: 0, irrelevantFiltered: 0 });
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
    assert.deepEqual(result.counts, { balloons: 1, wikipedia: 0, ceramic: 0, serper: 0, flaggedFiltered: 0, irrelevantFiltered: 0 });
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
    assert.equal(seenBody.irrelevant_filtered, 0);
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
