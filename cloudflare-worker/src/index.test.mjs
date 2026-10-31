import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.js';
import { createAdminSessionCookie } from './github-auth.mjs';
import {
  clearProviderCooldownState,
  updateAiCurationConfig
} from './news-storage.mjs';
import { NEWS_CATEGORIES } from './news-provider-config.mjs';

// Quiet the worker's structured JSON event logs ({"event":"PROVIDER_FETCH",...})
// during tests so failures are easy to spot in CI output. Anything that isn't
// a JSON event object still prints, so real errors and assertion details are
// never hidden.
for (const method of ['log', 'warn', 'error']) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    if (args.length === 1 && typeof args[0] === 'string') {
      try {
        const parsed = JSON.parse(args[0]);
        if (parsed && typeof parsed === 'object' && 'event' in parsed) return;
      } catch {
        // Not JSON — fall through and print it.
      }
    }
    original(...args);
  };
}

const authEnv = {
  GITHUB_ALLOWED_USER: 'littlables',
  GITHUB_SESSION_SECRET: 'test-session-secret-that-is-long-enough'
};

async function adminCookie(login = 'littlables') {
  return createAdminSessionCookie(login, authEnv.GITHUB_SESSION_SECRET);
}

test('admin page offers GitHub sign-in when there is no valid session', async () => {
  const response = await worker.fetch(new Request('https://worker.example/admin'), {}, {});
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Continue with GitHub/);
});

test('admin page requires an authenticated GitHub session', async () => {
  const cookie = await adminCookie();
  const response = await worker.fetch(
    new Request('https://worker.example/admin', { headers: { Cookie: cookie.split(';')[0] } }),
    authEnv
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  const page = await response.text();
  assert.match(page, /Verifying GitHub session/);
  assert.match(page, /Pending Approval/);
  assert.match(page, /Approve/);
  assert.match(page, /Disapprove/);
  assert.match(page, /Ignore/);
  assert.match(page, /Ban/);
  assert.match(page, /Undo/);
  assert.match(page, /Banned stories/);
  assert.match(page, /id="custom-link"/);
  assert.match(page, /id="approval-provider"/);
  assert.match(page, /id="stage-halloween-btn"/);
  assert.match(page, /stage-halloween-batch/);
  assert.match(page, /All providers/);
  assert.match(page, /story\.provider === state\.activeProvider/);
  assert.match(page, /'\?provider=' \+ encodeURIComponent\(state\.activeProvider\)/);
  assert.match(page, /providerFilterEl\.addEventListener\('change', \(\) => \{\s*state\.activeProvider = providerFilterEl\.value;\s*refreshData\(\);/);
  assert.match(page, /textContent = state\.busy\.has\(provider\.id\) \? 'Updating…' : 'Update'/);
  assert.match(page, /id="providers-toggle"[^>]*aria-expanded="false" aria-controls="providers-body"/);
  assert.match(page, /id="providers-body"[^>]*hidden/);
  assert.match(page, /unstick-all-providers/);
  assert.match(page, /\/admin\/api\/providers\/unstick-all/);
  assert.match(page, /textContent = 'Profile'/);
  assert.match(page, /← Providers/);
  assert.match(page, /encodeURIComponent\(providerId\) \+ '\/profile'/);
  assert.match(page, /id="providers" class="providers"/);
  assert.match(page, /id="logs-nested-toggle"/);
  assert.match(page, /Live run:/);
  assert.match(page, /preview-dialog/);
  assert.match(page, /Add to approved stories/);
  assert.match(page, /Save &amp; approve|Save & approve/);
  assert.match(page, /openStoryPreview\(story\)/);
  assert.match(page, /AI summary source content/);
  assert.match(page, /editableField\(aiSummary, 'aiSummary', 'AI summary'/);
  assert.match(page, /Generate AI summary/);
  assert.match(page, /Generate AI image/);
  assert.match(page, /generatePreviewImage/);
  assert.match(page, /Total stories saved:/);
  assert.match(page, /Childcare & Family/);
  assert.match(page, /Future Tech & AI/);
  assert.match(page, /meta-provider/);
  assert.match(page, /meta-domain/);
  assert.match(page, /Last updated:/);
  assert.match(page, /formatElapsed/);
  assert.match(page, /status-succeeded/);
  assert.match(page, /provider-setup/);
  assert.match(page, /Set Worker secret/);
  assert.match(page, /Topics:/);
  assert.match(page, /between topic requests/);
  assert.match(page, /History/);
  assert.match(page, /id="history-categories"/);
  assert.match(page, /id="history-provider"/);
  assert.match(page, /decisions-toggle/);
  assert.match(page, /aria-expanded="false" aria-controls="stories"/);
  assert.match(page, /aria-expanded="false" aria-controls="banned-stories"/);
  assert.ok(page.indexOf('Saved story records:') < page.indexOf('id="providers-title"'));
  assert.ok(page.indexOf('id="custom-title"') < page.indexOf('id="providers-title"'));
  assert.match(page, /const PAGE_SIZE_OPTIONS = \[5, 10, 20, 50, 100\];/);
  assert.match(page, /littlables_admin_section_order_v1/);
  assert.match(page, /littlables_admin_collapsed_v1/);
  assert.match(page, /lockModalScroll\(\)/);
  assert.match(page, /closeInlineEditor\(\)/);
  assert.doesNotMatch(page, /Close preview/);
});


test('admin APIs reject missing and non-allowlisted GitHub sessions', async () => {
  const missing = await worker.fetch(new Request('https://worker.example/admin/api/status'), {}, {});
  const otherCookie = await adminCookie('someone-else');
  const other = await worker.fetch(
    new Request('https://worker.example/admin/api/status', {
      headers: { Cookie: otherCookie.split(';')[0] }
    }),
    authEnv
  );
  assert.equal(missing.status, 401);
  assert.equal(other.status, 401);
});

test('admin status rejects unknown provider filters', async () => {
  const cookie = await adminCookie();
  const response = await worker.fetch(
    new Request('https://worker.example/admin/api/status?provider=unknown', {
      headers: { Cookie: cookie.split(';')[0] }
    }),
    authEnv
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Unknown news provider' });
});

test('GitHub OAuth login uses configured callback and sets an HttpOnly state cookie', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/admin/auth/login', {
      headers: { 'CF-Connecting-IP': '192.0.2.10' }
    }),
    {
      ...authEnv,
      GITHUB_CLIENT_ID: 'github-client',
      GITHUB_CLIENT_SECRET: 'github-secret',
      GITHUB_OAUTH_CALLBACK_URL: 'https://worker.example/admin/auth/callback',
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
    }
  );
  const location = new URL(response.headers.get('Location'));
  assert.equal(response.status, 302);
  assert.equal(location.hostname, 'github.com');
  assert.equal(location.searchParams.get('client_id'), 'github-client');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://worker.example/admin/auth/callback');
  assert.ok(response.headers.get('Set-Cookie').includes('HttpOnly'));
  assert.ok(response.headers.get('Set-Cookie').includes('SameSite=Lax'));
});

test('GitHub OAuth callback only creates a session for the allowlisted GitHub login', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options });
    if (String(input).includes('/login/oauth/access_token')) {
      return Response.json({ access_token: 'github-access-token' });
    }
    return Response.json({ login: 'littlables' });
  };
  try {
    const state = 'a'.repeat(43);
    const response = await worker.fetch(
      new Request(`https://worker.example/admin/auth/callback?code=oauth-code&state=${state}`, {
        headers: { Cookie: `littlables_oauth_state=${state}`, 'CF-Connecting-IP': '192.0.2.10' }
      }),
      {
        ...authEnv,
        GITHUB_CLIENT_ID: 'github-client',
        GITHUB_CLIENT_SECRET: 'github-secret',
        GITHUB_OAUTH_CALLBACK_URL: 'https://worker.example/admin/auth/callback',
        SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
      }
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), 'https://worker.example/admin');
    assert.match(response.headers.get('Set-Cookie'), /__Host-littlables_admin=/);
    assert.ok(requests.some(({ url }) => url === 'https://api.github.com/user'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHub OAuth callback does not create a session for another account', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => String(input).includes('/login/oauth/access_token')
    ? Response.json({ access_token: 'github-access-token' })
    : Response.json({ login: 'someone-else' });
  try {
    const state = 'b'.repeat(43);
    const response = await worker.fetch(
      new Request(`https://worker.example/admin/auth/callback?code=oauth-code&state=${state}`, {
        headers: { Cookie: `littlables_oauth_state=${state}` }
      }),
      {
        ...authEnv,
        GITHUB_CLIENT_ID: 'github-client',
        GITHUB_CLIENT_SECRET: 'github-secret',
        GITHUB_OAUTH_CALLBACK_URL: 'https://worker.example/admin/auth/callback',
        SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
      }
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Set-Cookie'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHub OAuth callback rejects an invalid state without contacting GitHub', async () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('GitHub should not be contacted');
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/auth/callback?code=oauth-code&state=wrong', {
        headers: { Cookie: 'littlables_oauth_state=expected' }
      }),
      {
        ...authEnv,
        GITHUB_CLIENT_ID: 'github-client',
        GITHUB_CLIENT_SECRET: 'github-secret',
        GITHUB_OAUTH_CALLBACK_URL: 'https://worker.example/admin/auth/callback',
        SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
      }
    );
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin logout clears the session and requires a same-origin request', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/admin/logout', {
      method: 'POST',
      headers: { Origin: 'https://worker.example' }
    }),
    {}
  );
  const crossOrigin = await worker.fetch(
    new Request('https://worker.example/admin/logout', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example' }
    }),
    {}
  );
  assert.equal(response.status, 303);
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal(crossOrigin.status, 403);
});

test('public feed API reads approved and unapproved stories while excluding banned stories', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const requested = new URL(String(input));
    requests.push(requested);
    assert.equal(options.headers.apikey, 'service-secret');
    if (requested.searchParams.get('approved') === 'eq.false') {
      return Response.json([{
        provider: 'gnews',
        category: 'childcare',
        title: 'Unapproved family update',
        article_url: 'https://publisher.example/unapproved',
        approved: false,
        published_at: '2026-10-17T11:00:00Z'
      }]);
    }
    return Response.json([{
      provider: 'gnews',
      category: 'childcare',
      title: 'Family update',
      article_url: 'https://publisher.example/family',
      approved: true,
      published_at: '2026-10-17T12:00:00Z'
    }]);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/space?interest=childcare'),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret',
        SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
      }
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    const storyRequests = requests.filter(requested => requested.pathname === '/rest/v1/news_stories');
    const reactionRequests = requests.filter(requested => requested.pathname === '/rest/v1/article_reactions');
    assert.equal(storyRequests.length, 2);
    assert.equal(reactionRequests.length, 1);
    assert.ok(storyRequests.every(requested => requested.searchParams.get('removed') === 'eq.false'));
    assert.deepEqual(new Set(storyRequests.map(requested => requested.searchParams.get('approved'))), new Set(['eq.true', 'eq.false']));
    assert.equal(result.items[0].link, 'https://publisher.example/family');
    assert.equal(result.items[0].approved, true);
    assert.equal(result.items[1].approved, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('custom preview parses public article metadata for a homepage card', async () => {
  const originalFetch = globalThis.fetch;
  let fetched;
  globalThis.fetch = async (input, options) => {
    fetched = { url: String(input), options };
    return new Response(`<!doctype html>
      <html><head>
      <meta property="og:title" content="A &amp; B story">
      <meta name="description" content="A useful article description.">
      <meta property="og:image" content="/images/story.jpg">
      <meta property="article:published_time" content="2026-10-17T12:00:00Z">
      </head></html>`, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/preview', {
        method: 'POST',
        headers: {
          Origin: 'https://worker.example',
          Cookie: (await adminCookie()).split(';')[0],
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: 'https://publisher.example/story' })
      }),
      {
        ...authEnv,
        SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
      }
    );
    assert.equal(response.status, 200);
    assert.equal(fetched.url, 'https://publisher.example/story');
    assert.equal(fetched.options.redirect, 'manual');
    assert.deepEqual(await response.json(), {
      title: 'A & B story',
      description: 'A useful article description.',
      image: 'https://publisher.example/images/story.jpg',
      link: 'https://publisher.example/story',
      source: 'publisher.example',
      pubDate: '2026-10-17T12:00:00.000Z'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('custom preview rejects private URLs and cross-origin requests without fetching', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('Must not fetch');
  };
  try {
    const cookie = (await adminCookie()).split(';')[0];
    const privateUrl = await worker.fetch(
      new Request('https://worker.example/admin/api/preview', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: cookie },
        body: JSON.stringify({ url: 'http://127.0.0.1/admin' })
      }),
      authEnv
    );
    const crossOrigin = await worker.fetch(
      new Request('https://worker.example/admin/api/preview', {
        method: 'POST',
        headers: { Origin: 'https://attacker.example', Cookie: cookie },
        body: JSON.stringify({ url: 'https://publisher.example/story' })
      }),
      authEnv
    );
    assert.equal(privateUrl.status, 400);
    assert.equal(crossOrigin.status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin summary generates from current draft when article scraping fails', async () => {
  const originalFetch = globalThis.fetch;
  let aiInput;
  globalThis.fetch = async () => {
    throw new Error('publisher blocks automated access');
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/summary', {
        method: 'POST',
        headers: {
          Origin: 'https://worker.example',
          Cookie: (await adminCookie()).split(';')[0],
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Edited family story title',
          category: 'childcare',
          link: 'https://publisher.example/story',
          image: '',
          description: 'Edited description contains enough detail to create a useful neutral summary for our family news story.',
          content: 'This is the edited publisher source content that should be included in the request to the language model.',
          aiSummary: '',
          pubDate: '',
          source: 'Publisher'
        })
      }),
      {
        ...authEnv,
        SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
        AI: {
          run: async (model, input) => {
            aiInput = { model, input };
            return { response: 'Generated summary from edited details.' };
          }
        }
      }
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { summary: 'Generated summary from edited details.' });
    assert.equal(aiInput.model, '@cf/meta/llama-3.2-3b-instruct');
    assert.match(aiInput.input.messages[1].content, /Edited family story title/);
    assert.match(aiInput.input.messages[1].content, /Edited description contains enough detail/);
    assert.match(aiInput.input.messages[1].content, /edited publisher source content/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin summary reports Workers AI failures clearly and enforces same-origin requests', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('page unavailable'); };
  const body = JSON.stringify({
    title: 'A story',
    category: 'all',
    link: 'https://publisher.example/story',
    image: '',
    description: 'A sufficiently long description with relevant story facts for creating a useful summary.',
    content: '',
    pubDate: '',
    source: 'Publisher'
  });
  try {
    const failed = await worker.fetch(
      new Request('https://worker.example/admin/api/summary', {
        method: 'POST',
        headers: {
          Origin: 'https://worker.example',
          Cookie: (await adminCookie()).split(';')[0],
          'Content-Type': 'application/json'
        },
        body
      }),
      {
        ...authEnv,
        SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
        AI: { run: async () => { throw new Error('model unavailable'); } }
      }
    );
    const rejected = await worker.fetch(
      new Request('https://worker.example/admin/api/summary', {
        method: 'POST',
        headers: {
          Origin: 'https://attacker.example',
          Cookie: (await adminCookie()).split(';')[0],
          'Content-Type': 'application/json'
        },
        body
      }),
      {
        ...authEnv,
        SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
        AI: { run: async () => ({ response: 'not called' }) }
      }
    );
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /Workers AI could not generate the summary/);
    assert.equal(rejected.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('custom story endpoint inserts an approved homepage story', async () => {
  const originalFetch = globalThis.fetch;
  let requested;
  let saved;
  globalThis.fetch = async (input, options) => {
    requested = { url: new URL(String(input)), options };
    saved = JSON.parse(options.body)[0];
    return Response.json([{ id: 25 }]);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/stories', {
        method: 'POST',
        headers: {
          Origin: 'https://worker.example',
          Cookie: (await adminCookie()).split(';')[0],
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Edited custom title',
          category: 'childcare',
          link: 'https://publisher.example/story',
          image: 'https://images.example/story.jpg',
          description: 'Edited description',
          content: 'Edited context',
          aiSummary: 'The saved AI brief.',
          pubDate: '',
          source: 'Publisher'
        })
      }),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret'
      }
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: 25, approved: true });
    assert.equal(requested.url.pathname, '/rest/v1/news_stories');
    assert.equal(saved.provider, 'custom');
    assert.equal(saved.approved, true);
    assert.equal(saved.category, 'childcare');
    assert.equal(saved.title, 'Edited custom title');
    assert.equal(saved.image_url, 'https://images.example/story.jpg');
    assert.equal(saved.ai_summary, 'The saved AI brief.');
    assert.ok(Number.isFinite(Date.parse(saved.published_at)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Halloween batch staging inserts unapproved stories with images and tags interests', async () => {
  const originalFetch = globalThis.fetch;
  const savedRows = [];
  const patchedRows = [];
  globalThis.fetch = async (input, options) => {
    const method = options?.method || 'GET';
    if (method === 'PATCH') {
      patchedRows.push(JSON.parse(options.body));
      return Response.json([]);
    }
    if (method === 'GET') {
      // Untagged-rows lookup: every row just staged, keywords still NULL.
      return Response.json(savedRows.map((row, i) => ({ id: i + 1, article_url: row.article_url })));
    }
    savedRows.push(...JSON.parse(options.body));
    return Response.json([]);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/stories/stage-halloween-batch', {
        method: 'POST',
        headers: {
          Origin: 'https://worker.example',
          Cookie: (await adminCookie()).split(';')[0],
        }
      }),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret'
      }
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.staged, 20);
    assert.equal(body.duplicatesSkipped, 0);
    assert.equal(body.interestsSet, 20);
    assert.equal(body.interestsFailed, 0);
    assert.equal(savedRows.length, 20);
    assert.deepEqual(Object.keys(body.byCategory).sort(), ['animals', 'arts', 'childcare', 'tech', 'uplifting', 'world']);
    for (const row of savedRows) {
      assert.equal(row.provider, 'halloween-batch');
      // Unapproved by default: the insert must NOT set approved=true, so the
      // batch waits in Pending Approval instead of publishing as curated.
      assert.equal(row.approved, undefined);
      assert.ok(row.title && row.article_url && row.source_name && row.category);
      assert.match(row.image_url, /^https:\/\//);
    }
    assert.equal(patchedRows.length, 20);
    for (const patch of patchedRows) {
      assert.ok(Array.isArray(patch.interest_keywords));
      assert.ok(patch.interest_keywords.length >= 1 && patch.interest_keywords.length <= 3);
      assert.ok(patch.interest_keywords.includes('halloween'));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Halloween batch staging tops up rows with fewer than three interests', async () => {
  const originalFetch = globalThis.fetch;
  const patchedRows = [];
  globalThis.fetch = async (input, options) => {
    const method = options?.method || 'GET';
    if (method === 'PATCH') {
      patchedRows.push(JSON.parse(options.body));
      return Response.json([]);
    }
    if (method === 'GET') {
      // One pre-existing row with only 2 tags, one already fully tagged.
      return Response.json([
        { id: 1, article_url: 'https://www.thebestideasforkids.com/paper-plate-pumpkin/', interest_keywords: ['kids-crafts', 'halloween'] },
        { id: 2, article_url: 'https://portcharlotte.macaronikid.com/articles/6a918d2cd85a1b102f61c5d7/2026-halloween-events-worth-the-drive-from-port-charlotte', interest_keywords: ['theme-parks', 'zoos', 'halloween'] }
      ]);
    }
    return Response.json([]);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/stories/stage-halloween-batch', {
        method: 'POST',
        headers: {
          Origin: 'https://worker.example',
          Cookie: (await adminCookie()).split(';')[0],
        }
      }),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret'
      }
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interestsSet, 1);
    assert.equal(body.interestsFailed, 0);
    assert.equal(patchedRows.length, 1);
    assert.deepEqual(patchedRows[0].interest_keywords, ['kids-crafts', 'holidays', 'halloween']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('story edit endpoint updates card details without changing moderation state', async () => {
  const originalFetch = globalThis.fetch;
  let requested;
  let update;
  globalThis.fetch = async (input, options) => {
    requested = { url: new URL(String(input)), options };
    update = JSON.parse(options.body);
    return Response.json([{ id: 25 }]);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/stories/25', {
        method: 'PATCH',
        headers: {
          Origin: 'https://worker.example',
          Cookie: (await adminCookie()).split(';')[0],
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Edited title',
          category: 'arts',
          link: 'https://publisher.example/updated',
          image: '',
          description: 'Description',
          content: 'Context',
          aiSummary: 'Edited AI brief',
          pubDate: '',
          source: 'Publisher'
        })
      }),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret'
      }
    );
    assert.equal(response.status, 200);
    assert.equal(requested.url.searchParams.get('id'), 'eq.25');
    assert.equal(requested.options.method, 'PATCH');
    assert.equal(update.title, 'Edited title');
    assert.equal(update.category, 'arts');
    assert.equal(update.ai_summary, 'Edited AI brief');
    assert.equal(Object.hasOwn(update, 'approved'), false);
    assert.equal(Object.hasOwn(update, 'removed'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('story publishing rejects unsafe links and cross-origin edits before saving', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('Supabase must not be called');
  };
  try {
    const cookie = (await adminCookie()).split(';')[0];
    const unsafe = await worker.fetch(
      new Request('https://worker.example/admin/api/stories', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Unsafe link',
          category: 'all',
          link: 'http://127.0.0.1/private',
          image: '',
          description: '',
          content: '',
          pubDate: '',
          source: ''
        })
      }),
      authEnv
    );
    const crossOrigin = await worker.fetch(
      new Request('https://worker.example/admin/api/stories/25', {
        method: 'PATCH',
        headers: { Origin: 'https://attacker.example', Cookie: cookie, 'Content-Type': 'application/json' },
        body: '{}'
      }),
      authEnv
    );
    assert.equal(unsafe.status, 400);
    assert.equal(crossOrigin.status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin approval route updates only a pending story after same-origin check', async () => {
  const originalFetch = globalThis.fetch;
  let requested;
  let update;
  globalThis.fetch = async (input, options) => {
    requested = new URL(String(input));
    update = JSON.parse(options.body);
    return Response.json([{ id: 12 }]);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/stories/12/approve', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: (await adminCookie()).split(';')[0] }
      }),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret'
      }
    );
    assert.equal(response.status, 200);
    assert.equal(requested.searchParams.get('id'), 'eq.12');
    assert.equal(requested.searchParams.get('approved'), 'eq.false');
    assert.equal(update.approved, true);
    assert.equal(update.approved_by, 'littlables');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin ban route hides an unapproved story after same-origin check', async () => {
  const originalFetch = globalThis.fetch;
  let requested;
  let update;
  globalThis.fetch = async (input, options) => {
    requested = new URL(String(input));
    update = JSON.parse(options.body);
    return Response.json([{ id: 12 }]);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/stories/12/ban', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: (await adminCookie()).split(';')[0] }
      }),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret'
      }
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(requested.searchParams.get('id'), 'eq.12');
    assert.equal(requested.searchParams.get('approved'), 'eq.false');
    assert.equal(requested.searchParams.get('removed'), 'eq.false');
    assert.equal(update.removed, true);
    assert.equal(update.decision_action, 'ban');
    assert.equal(update.removed_by, 'littlables');
    assert.equal(result.action, 'ban');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin ban route rejects cross-origin requests without updating Supabase', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('Supabase should not be called');
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/stories/12/ban', {
        method: 'POST',
        headers: {
          Origin: 'https://attacker.example',
          Cookie: (await adminCookie()).split(';')[0]
        }
      }),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret'
      }
    );
    assert.equal(response.status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin disapprove route unapproves a story without banning it', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: new URL(String(input)), options });
    return requests.length === 1
      ? Response.json([{ id: 12, approved: true, removed: false }])
      : Response.json([{ id: 12 }]);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/stories/12/disapprove', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: (await adminCookie()).split(';')[0] }
      }),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret'
      }
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(requests[1].url.searchParams.get('approved'), 'eq.true');
    assert.equal(requests[1].url.searchParams.get('removed'), 'eq.false');
    const update = JSON.parse(requests[1].options.body);
    assert.equal(update.approved, false);
    assert.equal(update.removed, undefined);
    assert.equal(update.decision_action, 'disapprove');
    assert.equal(result.action, 'disapprove');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin undo route restores a story previous decision', async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  let update;
  globalThis.fetch = async (input, options = {}) => {
    requestCount += 1;
    if (requestCount === 1) {
      return Response.json([{
        id: 12,
        approved: false,
        removed: true,
        decision_action: 'ban',
        decision_at: '2026-10-17T12:00:00Z',
        previous_approved: false,
        previous_removed: false
      }]);
    }
    update = JSON.parse(options.body);
    return Response.json([{ id: 12 }]);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/stories/12/undo', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: (await adminCookie()).split(';')[0] }
      }),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret'
      }
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(requestCount, 2);
    assert.equal(update.approved, false);
    assert.equal(update.removed, false);
    assert.equal(update.decision_action, 'undo');
    assert.equal(result.action, 'undo');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin approval route rejects cross-origin approval attempts', async () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('should not be called');
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/stories/12/approve', {
        method: 'POST',
        headers: {
          Origin: 'https://attacker.example',
          Cookie: (await adminCookie()).split(';')[0]
        }
      }),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret'
      }
    );
    assert.equal(response.status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider update ingests all configured GNews categories and writes status', async () => {
  const originalFetch = globalThis.fetch;
  const apiCalls = [];
  const savedRows = [];
  const date = new Date().toISOString();
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'gnews.io') {
      apiCalls.push(url.searchParams.get('q') || url.searchParams.get('category'));
      assert.equal(options.headers['X-Api-Key'], 'gnews-secret');
      assert.equal(url.searchParams.has('apikey'), false);
      return Response.json({
        articles: [{
          title: 'Test story',
          description: 'Test story description.',
          content: 'Test story article excerpt.',
          url: `https://publisher.example/${encodeURIComponent(url.searchParams.get('q') || url.searchParams.get('category'))}`,
          image: 'https://images.example/test.jpg',
          publishedAt: date,
          source: { name: 'Example' }
        }]
      });

      test('provider update reports missing credentials before claiming a run', async () => {
        const originalFetch = globalThis.fetch;
        let claimed = false;
        globalThis.fetch = async input => {
          const url = new URL(String(input));
          if (url.pathname.endsWith('/rpc/claim_news_provider_sync')) claimed = true;
          throw new Error(`Unexpected fetch: ${url.href}`);
        };
        try {
          const response = await worker.fetch(
            new Request('https://worker.example/admin/api/providers/newsdata/update', {
              method: 'POST',
              headers: { Origin: 'https://worker.example', Cookie: (await adminCookie()).split(';')[0] }
            }),
            {
              ...authEnv,
              SUPABASE_URL: 'https://supabase.example',
              SUPABASE_SECRET_KEY: 'service-secret',
              SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
            }
          );
          assert.equal(response.status, 503);
          assert.match((await response.json()).error, /NEWSDATA_API_KEY/);
          assert.equal(claimed, false);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    }
    if (url.pathname.endsWith('/rpc/claim_news_provider_sync')) return Response.json(true);
    if (url.pathname.endsWith('/news_stories')) {
      savedRows.push(...JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/news_provider_sync')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/providers/gnews/update', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: (await adminCookie()).split(';')[0] }
      }),
      {
        ...authEnv,
        GNEWS_API_KEY: 'gnews-secret',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret',
        SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
      }
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.storiesSaved, 7);
    assert.equal(apiCalls.length, 7);
    assert.equal(savedRows.length, 7);
    assert.deepEqual(new Set(savedRows.map(row => row.category)), new Set([
      'all', 'childcare', 'animals', 'arts', 'tech', 'world', 'uplifting'
    ]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin ads API returns ads list and allows editing and creation', async () => {
  const cookie = (await adminCookie()).split(';')[0];
  
  // 1. GET /admin/api/ads
  const getResponse = await worker.fetch(
    new Request('https://worker.example/admin/api/ads', {
      headers: { Cookie: cookie }
    }),
    authEnv
  );
  assert.equal(getResponse.status, 200);
  const data = await getResponse.json();
  assert.ok(Array.isArray(data.ads));
  assert.ok(data.ads.length > 0);
  const firstAd = data.ads[0];

  // 2. PATCH /admin/api/ads/:id (edit an ad)
  const patchResponse = await worker.fetch(
    new Request(`https://worker.example/admin/api/ads/${encodeURIComponent(firstAd.id)}`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://worker.example',
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Updated Test Ad Title',
        desc: 'Updated test ad description with more details.'
      })
    }),
    authEnv
  );
  assert.equal(patchResponse.status, 200);
  const patchData = await patchResponse.json();
  assert.equal(patchData.updated, true);
  assert.equal(patchData.ad.title, 'Updated Test Ad Title');

  // 3. POST /admin/api/ads (create new ad)
  const postResponse = await worker.fetch(
    new Request('https://worker.example/admin/api/ads', {
      method: 'POST',
      headers: {
        Origin: 'https://worker.example',
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Brand New Showcase Product',
        desc: 'Exciting learning product.',
        sponsor: 'Creator Labs',
        cta: 'Get Now →',
        category: 'childcare',
        network: 'Partner'
      })
    }),
    authEnv
  );
  assert.equal(postResponse.status, 200);
  const postData = await postResponse.json();
  assert.equal(postData.created, true);
  assert.equal(postData.ad.title, 'Brand New Showcase Product');
});

test('admin AI image endpoint creates a fun Littlables-themed prompt from story details and caches the generated image', async () => {
  const aiCalls = [];
  // Minimal valid JPEG header bytes in base64 (0xFF, 0xD8, 0xFF, 0xD9)
  const fakeJpegBase64 = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xd9));
  const cookie = (await adminCookie()).split(';')[0];

  const response = await worker.fetch(
    new Request('https://worker.example/admin/api/image', {
      method: 'POST',
      headers: {
        Origin: 'https://worker.example',
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Baby Sea Otters Learn to Juggle Shells at the Aquarium',
        category: 'animals',
        link: 'https://publisher.example/otters',
        image: '',
        description: 'Playful rescued sea otter pups practice dexterity with colorful seashells in a warm coastal habitat.',
        content: 'Caretakers introduced enrichment toys and shells to help the young otters build foraging skills.',
        aiSummary: 'Rescued sea otter pups are learning foraging skills through playful shell games.',
        pubDate: '2026-10-19T12:00:00Z',
        source: 'Ocean Wire'
      })
    }),
    {
      ...authEnv,
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
      AI: {
        run: async (model, input) => {
          aiCalls.push({ model, input });
          if (model === '@cf/meta/llama-3.2-3b-instruct') {
            return {
              response: 'Cheerful sea otter pups floating on cozy turquoise waves while juggling pastel seashells under warm sunlight.'
            };
          }
          return { image: fakeJpegBase64 };
        }
      }
    }
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.image.startsWith('https://worker.example/ai-image?prompt='));
  assert.match(data.prompt, /Create a fun image based around the story details that fit the theme of Littlables/i);
  assert.match(data.prompt, /sea otter/i);
  assert.equal(aiCalls.length, 2);
  assert.equal(aiCalls[0].model, '@cf/meta/llama-3.2-3b-instruct');
  assert.match(aiCalls[0].input.messages[1].content, /Create a fun image based around these story details that fit the theme of Littlables/);
  assert.match(aiCalls[0].input.messages[1].content, /Baby Sea Otters Learn to Juggle Shells/);
  assert.equal(aiCalls[1].model, '@cf/black-forest-labs/flux-1-schnell');

  // Verify GET /ai-image serves the cached image without re-invoking AI
  const imageGetResponse = await worker.fetch(new Request(data.image), {});
  assert.equal(imageGetResponse.status, 200);
  assert.equal(imageGetResponse.headers.get('Content-Type'), 'image/jpeg');
  const servedBytes = new Uint8Array(await imageGetResponse.arrayBuffer());
  assert.deepEqual(Array.from(servedBytes), [0xff, 0xd8, 0xff, 0xd9]);
  assert.equal(aiCalls.length, 2);
});

test('public feed and ads endpoints search stories and ads when custom topic keywords are used', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const requested = new URL(String(input));
    requests.push(requested);
    assert.equal(options.headers.apikey, 'service-secret');
    if (requested.searchParams.get('approved') === 'eq.true') {
      return Response.json([{
        provider: 'gnews',
        category: 'animals',
        title: 'Playful Puppy Learns New Tricks',
        article_url: 'https://publisher.example/puppy-tricks',
        approved: true,
        published_at: '2026-10-19T12:00:00Z'
      }]);
    }
    return Response.json([]);
  };

  try {
    const feedRes = await worker.fetch(
      new Request('https://worker.example/space?interest=puppy'),
      {
        ...authEnv,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SECRET_KEY: 'service-secret',
        SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
      }
    );
    assert.equal(feedRes.status, 200);
    const feedData = await feedRes.json();
    assert.equal(feedData.topic, 'puppy');
    assert.equal(feedData.items.length, 1);
    assert.equal(feedData.items[0].title, 'Playful Puppy Learns New Tricks');
    assert.ok(Array.isArray(feedData.ads));
    assert.ok(feedData.ads.length > 0);
    assert.ok(feedData.ads.some(ad => /puppy/i.test(ad.title + ' ' + ad.desc)));
    assert.equal(requests.length, 2);
    assert.ok(requests.every(req => req.searchParams.get('or')?.includes('title.ilike.*puppy*')));

    const adsRes = await worker.fetch(new Request('https://worker.example/ads?q=puppy'), {});
    assert.equal(adsRes.status, 200);
    const adsData = await adsRes.json();
    assert.ok(Array.isArray(adsData.ads));
    assert.ok(adsData.ads.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rate-limited provider stops immediately, applies cooldown, and queues remaining categories for retry (no cross-provider failover)', async () => {
  const originalFetch = globalThis.fetch;
  const gnewsCalls = [];
  const newsdataCalls = [];
  const savedBatches = [];
  const queueUpserts = [];
  const persistedLogs = [];
  const date = new Date().toISOString();

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'gnews.io') {
      const catOrQ = url.searchParams.get('q') || url.searchParams.get('category');
      gnewsCalls.push(catOrQ);
      if (gnewsCalls.length === 1) {
        return Response.json({
          articles: [{
            title: 'GNews First Category Story',
            description: 'Story before rate limit.',
            content: 'Content.',
            url: 'https://publisher.example/gnews-1',
            image: 'https://images.example/1.jpg',
            publishedAt: date,
            source: { name: 'Example' }
          }]
        });
      }
      return new Response(
        JSON.stringify({ errors: ['You have reached your request quota for the hour.'] }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '900',
            'X-RateLimit-Remaining': '0'
          }
        }
      );
    }
    if (url.hostname === 'newsdata.io') {
      newsdataCalls.push(url.searchParams.get('q') || 'all');
      return Response.json({ results: [] });
    }
    if (url.pathname.endsWith('/rpc/claim_news_provider_sync')) return Response.json(true);
    if (url.pathname.endsWith('/provider_retry_queue') && options.method === 'POST') {
      queueUpserts.push(JSON.parse(options.body));
      return new Response(null, { status: 201 });
    }
    if (url.pathname.endsWith('/news_provider_logs') && options.method === 'POST') {
      persistedLogs.push(...JSON.parse(options.body));
      return new Response(null, { status: 201 });
    }
    if (url.pathname.endsWith('/news_provider_logs')) {
      const sorted = [...persistedLogs].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return Response.json(sorted);
    }
    if (url.pathname.endsWith('/news_stories')) {
      savedBatches.push(...JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/news_provider_sync')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected fetch: ${url.href}`);
  };

  try {
    const cookie = (await adminCookie()).split(';')[0];
    const envWithKeys = {
      ...authEnv,
GNEWS_API_KEY: 'gnews-secret',
      NEWSDATA_API_KEY: 'newsdata-secret',
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SECRET_KEY: 'service-secret',
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
    };

    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/providers/gnews/update?force=1', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: cookie }
      }),
      envWithKeys
    );

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.provider, 'gnews');
    assert.equal(result.rateLimited, true);
    assert.ok(result.cooldownUntil);
    assert.equal(result.failoverProvider, undefined, 'No cross-provider failover should occur');
    assert.equal(gnewsCalls.length, 2, 'GNews must stop immediately after hitting 429 on category #2');
    assert.equal(newsdataCalls.length, 0, 'No other provider should be queried (failover removed)');
    assert.ok(queueUpserts.length >= 1, 'Remaining categories must be queued for retry');
    for (const q of queueUpserts) {
      assert.equal(q.provider, 'gnews');
      assert.equal(q.status, 'pending');
      assert.ok(q.not_before, 'Retry must have a not_before time from the rate-limit headers');
    }

    // Subsequent non-forced call should respect cooldown without hitting GNews again
    const cooldownRes = await worker.fetch(
      new Request('https://worker.example/admin/api/providers/gnews/update', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: cookie }
      }),
      envWithKeys
    );
    const cooldownData = await cooldownRes.json();
    assert.equal(cooldownData.status, 'rate_limited');
    assert.equal(gnewsCalls.length, 2, 'GNews must not be queried while in active cooldown');

    // Check detailed logs via /admin/api/logs
    const logsRes = await worker.fetch(
      new Request('https://worker.example/admin/api/logs?status=rate_limited', {
        headers: { Cookie: cookie }
      }),
      envWithKeys
    );
    assert.equal(logsRes.status, 200);
    const logsData = await logsRes.json();
    assert.ok(logsData.logs.length >= 1);
    assert.equal(logsData.logs[0].provider, 'gnews');
    assert.equal(logsData.logs[0].httpStatus, 429);
    assert.equal(logsData.logs[0].retryAfterSeconds, 900);
    assert.equal(logsData.logs[0].failoverProvider, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('hourly scheduled cron trigger and admin auto-sync toggle control automatic provider querying', async () => {
  const originalFetch = globalThis.fetch;
  let bingFetches = 0;
  const rss = `<rss><channel><item><title>Hourly Story</title><link>https://publisher.example/hourly</link><description>Summary</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'www.bing.com') {
      bingFetches++;
      return new Response(rss);
    }
    if (url.hostname === 'www.reddit.com') {
      return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Reddit Post</title><published>${new Date().toISOString()}</published><link href="https://www.reddit.com/r/Parenting/comments/1/post/" /><content type="html">Content</content></entry></feed>`);
    }
    if (url.pathname.endsWith('/rpc/claim_news_provider_sync')) return Response.json(true);
    if (url.pathname.endsWith('/news_stories')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/news_provider_sync')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected fetch: ${url.href}`);
  };

  try {
    const cookie = (await adminCookie()).split(';')[0];
    const cronEnv = {
      ...authEnv,
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SECRET_KEY: 'service-secret',
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
    };

    // Pause auto-sync via admin API
    const pauseRes = await worker.fetch(
      new Request('https://worker.example/admin/api/auto-sync', {
        method: 'POST',
        headers: {
          Origin: 'https://worker.example',
          Cookie: cookie,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: false })
      }),
      cronEnv
    );
    assert.equal(pauseRes.status, 200);
    const pauseData = await pauseRes.json();
    assert.equal(pauseData.autoSync.enabled, false);

    // Scheduled cron should respect paused state
    await worker.scheduled({ cron: '0 * * * *' }, cronEnv, {});
    assert.equal(bingFetches, 0, 'Cron must not query providers when auto-sync is paused');

    // Re-enable auto-sync
    const enableRes = await worker.fetch(
      new Request('https://worker.example/admin/api/auto-sync', {
        method: 'POST',
        headers: {
          Origin: 'https://worker.example',
          Cookie: cookie,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: true })
      }),
      cronEnv
    );
    assert.equal((await enableRes.json()).autoSync.enabled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});




test('image check reports missing and broken images with pagination', async () => {
  const originalFetch = globalThis.fetch;
  const rows = [
    { id: 3, title: 'No pic', article_url: 'https://example.com/3', image_url: '', category: 'animals', approved: true, removed: false },
    { id: 2, title: 'Good pic', article_url: 'https://example.com/2', image_url: 'https://img.example.com/good.jpg', category: 'animals', approved: true, removed: false },
    { id: 1, title: 'Bad pic', article_url: 'https://example.com/1', image_url: 'https://img.example.com/bad.jpg', category: 'world', approved: false, removed: false },
  ];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes('/rest/v1/news_stories')) {
      const u = new URL(url);
      const idFilter = u.searchParams.get('id');
      let out = rows;
      if (idFilter && idFilter.startsWith('lt.')) {
        const before = Number(idFilter.slice(3));
        out = rows.filter((r) => r.id < before);
      }
      return Response.json(out.slice(0, 40));
    }
    if (url === 'https://img.example.com/good.jpg') return new Response(null, { status: 200 });
    if (url === 'https://img.example.com/bad.jpg') return new Response(null, { status: 404 });
    throw new Error('unexpected fetch: ' + url);
  };
  try {
    const cookie = await adminCookie();
    const env = { ...authEnv, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'test-key' };
    const headers = { Cookie: cookie.split(';')[0] };
    // batch=1: only the first image-bearing story is HEAD-checked per call.
    const res1 = await worker.fetch(new Request('https://worker.example/admin/api/stories/check-images?batch=1', { headers }), env);
    const data1 = await res1.json();
    assert.equal(res1.status, 200);
    assert.deepEqual(data1.noImage.map((s) => s.id), [3]);
    assert.deepEqual(data1.broken.map((s) => s.id), []);
    assert.equal(data1.done, false);
    assert.equal(data1.nextBefore, 2);
    const res2 = await worker.fetch(new Request(`https://worker.example/admin/api/stories/check-images?batch=1&before=${data1.nextBefore}`, { headers }), env);
    const data2 = await res2.json();
    assert.deepEqual(data2.broken.map((s) => s.id), [1]);
    assert.equal(data2.broken[0].status, 404);
    assert.equal(data2.done, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin ai-usage endpoint returns daily counter rows', async () => {
  const originalFetch = globalThis.fetch;
  const cookie = await adminCookie();
  const env = { ...authEnv, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'test-key' };
  const rows = [
    { usage_date: '2026-10-29', model: 'llama', usage_key: 'curation', calls: 7, errors: 0 },
    { usage_date: '2026-10-28', model: 'bge', usage_key: 'validation', calls: 3, errors: 1 }
  ];
  let seenUrl = '';
  globalThis.fetch = async (url) => {
    seenUrl = String(url);
    return { ok: true, json: async () => rows };
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/ai-usage?days=30', {
        headers: { Origin: 'https://worker.example', Cookie: cookie.split(';')[0] }
      }),
      env
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.rows, rows);
    assert.match(seenUrl, /ai_usage_daily/);
    assert.match(seenUrl, /usage_date=gte\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('hourly sweep fetches providers concurrently with batched writes', async () => {
  const originalFetch = globalThis.fetch;
  const providerFetchOrder = [];
  const gnewsCategories = [];
  const storyPosts = [];
  const logPosts = [];
  const retryQueuePosts = [];
  const rss = `<rss><channel><item><title>Hourly Story</title><link>https://publisher.example/hourly</link><description>Summary</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;

  const gnewsCategoryFromUrl = (url) => {
    if (url.pathname.includes('top-headlines')) {
      return url.searchParams.get('category') === 'world' ? 'world' : 'all';
    }
    const q = url.searchParams.get('q') || '';
    if (q.includes('childcare')) return 'childcare';
    if (q.includes('animals')) return 'animals';
    if (q.includes('arts')) return 'arts';
    if (q.includes('technology')) return 'tech';
    return 'uplifting';
  };

  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method || 'GET';
    if (url.hostname === 'gnews.io') {
      providerFetchOrder.push(url.hostname);
      gnewsCategories.push(gnewsCategoryFromUrl(url));
      return Response.json({ articles: [{
        title: 'G story',
        url: 'https://publisher.example/g',
        image: '',
        description: 'd',
        content: 'c',
        publishedAt: new Date().toISOString(),
        source: { name: 'GNews Source' }
      }] });
    }
    if (url.hostname === 'www.bing.com') {
      providerFetchOrder.push(url.hostname);
      return new Response(rss);
    }
    if (url.hostname === 'www.reddit.com') {
      providerFetchOrder.push(url.hostname);
      // Non-Atom body: the adapter throws fast, so Reddit costs no pacing time.
      return new Response('not an atom feed');
    }
    if (url.hostname === 'supabase.example') {
      if (url.pathname.endsWith('/rpc/claim_news_provider_sync')) return Response.json(true);
      if (url.pathname.endsWith('/news_stories')) {
        storyPosts.push(JSON.parse(options.body));
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/news_provider_logs')) {
        logPosts.push(JSON.parse(options.body));
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/news_provider_sync')) {
        return method === 'GET' ? Response.json([]) : new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/provider_retry_queue')) {
        if (method === 'GET') return Response.json([]);
        retryQueuePosts.push(JSON.parse(options.body));
        return new Response(null, { status: 204 });
      }
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };

  try {
    const cookie = (await adminCookie()).split(';')[0];
    const cronEnv = {
      ...authEnv,
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SECRET_KEY: 'service-secret',
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
      GNEWS_API_KEY: 'test-key'
    };

    // Guarantee a clean sweep regardless of earlier tests in this file.
    const enableRes = await worker.fetch(
      new Request('https://worker.example/admin/api/auto-sync', {
        method: 'POST',
        headers: {
          Origin: 'https://worker.example',
          Cookie: cookie,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: true })
      }),
      cronEnv
    );
    assert.equal(enableRes.status, 200);
    for (const provider of ['gnews', 'bing', 'reddit']) clearProviderCooldownState(provider);
    updateAiCurationConfig({ enabled: false });

    await worker.scheduled({ cron: '0 * * * *' }, cronEnv, {});

    // Concurrent chains: all three providers start together (the first
    // three fetch starts cover all three hosts), each completes its own
    // categories in order, and no provider waits on another's pacing.
    assert.deepEqual(providerFetchOrder.slice(0, 3), ['gnews.io', 'www.bing.com', 'www.reddit.com']);
    for (const host of ['gnews.io', 'www.bing.com', 'www.reddit.com']) {
      assert.equal(providerFetchOrder.filter(h => h === host).length, NEWS_CATEGORIES.length);
    }
    assert.deepEqual(gnewsCategories, NEWS_CATEGORIES);

    // One batched upsert per successful provider, covering all 7 categories.
    assert.equal(storyPosts.length, 2);
    for (const rows of storyPosts) {
      assert.equal(rows.length, 7);
      assert.deepEqual(rows.map(r => r.category), NEWS_CATEGORIES);
    }
    assert.deepEqual(
      storyPosts.map(rows => rows[0].provider).sort(),
      ['bing', 'gnews']
    );

    // One batched log flush per provider: gnews + bing succeeded, reddit failed.
    assert.equal(logPosts.length, 3);
    const logsByProvider = {};
    for (const rows of logPosts) logsByProvider[rows[0].provider] = rows;
    assert.equal(logsByProvider.gnews.length, 7);
    assert.ok(logsByProvider.gnews.every(r => r.status === 'succeeded'));
    assert.equal(logsByProvider.bing.length, 7);
    assert.ok(logsByProvider.bing.every(r => r.status === 'succeeded'));
    assert.equal(logsByProvider.reddit.length, 7);
    assert.ok(logsByProvider.reddit.every(r => r.status === 'failed'));

    // No 429s, no 5xx: nothing may be queued for retry.
    assert.equal(retryQueuePosts.length, 0);
  } finally {
    updateAiCurationConfig({ enabled: true });
    globalThis.fetch = originalFetch;
  }
});

test('hourly sweep runs provider chains concurrently so a slow provider does not block others', async () => {
  const originalFetch = globalThis.fetch;
  let bingFetches = 0;
  let gnewsAllReleased = false;
  let releaseGnewsAll;
  const gnewsAllGate = new Promise(resolve => { releaseGnewsAll = resolve; });
  const rss = `<rss><channel><item><title>Hourly Story</title><link>https://publisher.example/hourly</link><description>Summary</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
  const gnewsArticles = () => Response.json({ articles: [{
    title: 'G story',
    url: 'https://publisher.example/g',
    image: '',
    description: 'd',
    content: 'c',
    publishedAt: new Date().toISOString(),
    source: { name: 'GNews Source' }
  }] });

  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method || 'GET';
    if (url.hostname === 'gnews.io') {
      // GNews 'all' (top-headlines, no world category) stalls behind a
      // gate: its chain cannot advance until the test releases it.
      if (url.pathname.includes('top-headlines') && url.searchParams.get('category') !== 'world') {
        await gnewsAllGate;
        gnewsAllReleased = true;
      }
      return gnewsArticles();
    }
    if (url.hostname === 'www.bing.com') {
      bingFetches++;
      return new Response(rss);
    }
    if (url.hostname === 'www.reddit.com') return new Response('not an atom feed');
    if (url.hostname === 'supabase.example') {
      if (url.pathname.endsWith('/rpc/claim_news_provider_sync')) return Response.json(true);
      if (url.pathname.endsWith('/news_stories')) return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/news_provider_logs')) return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/news_provider_sync')) {
        return method === 'GET' ? Response.json([]) : new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/provider_retry_queue')) return Response.json([]);
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };

  try {
    const cookie = (await adminCookie()).split(';')[0];
    const cronEnv = {
      ...authEnv,
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SECRET_KEY: 'service-secret',
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
      GNEWS_API_KEY: 'test-key'
    };
    const enableRes = await worker.fetch(
      new Request('https://worker.example/admin/api/auto-sync', {
        method: 'POST',
        headers: {
          Origin: 'https://worker.example',
          Cookie: cookie,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: true })
      }),
      cronEnv
    );
    assert.equal(enableRes.status, 200);
    for (const provider of ['gnews', 'bing', 'reddit']) clearProviderCooldownState(provider);
    updateAiCurationConfig({ enabled: false });

    const sweepPromise = worker.scheduled({ cron: '0 * * * *' }, cronEnv, {});
    // Bing's second fetch (~2s pacing pause after its first) must start
    // while GNews 'all' is still gated — under the old sequential loop
    // bing could not start its second pair until gnews/all resolved.
    for (let i = 0; i < 100 && bingFetches < 2; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(bingFetches >= 2, 'bing advanced past its first pair while gnews was gated');
    assert.equal(gnewsAllReleased, false);
    releaseGnewsAll();
    await sweepPromise;
    assert.equal(gnewsAllReleased, true);
  } finally {
    updateAiCurationConfig({ enabled: true });
    globalThis.fetch = originalFetch;
  }
});

test('admin unstick-all resets running providers and closes open runs', async () => {
  const originalFetch = globalThis.fetch;
  const providerPatches = [];
  const runPatches = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method || 'GET';
    if (url.hostname === 'supabase.example') {
      if (url.pathname.endsWith('/news_provider_sync')) {
        if (method === 'GET') {
          if (url.searchParams.get('status') === 'running') {
            return Response.json([{ provider: 'gnews', status: 'running', started_at: '2026-10-30T03:20:04Z' }]);
          }
          return Response.json([{ provider: 'gnews', status: 'running' }]);
        }
        providerPatches.push(JSON.parse(options.body));
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/provider_sync_runs')) {
        if (method === 'GET') {
          return Response.json([{ id: 'run-1', summary: { inProgress: true, providers: [] } }]);
        }
        runPatches.push(JSON.parse(options.body));
        return new Response(null, { status: 204 });
      }
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const cookie = (await adminCookie()).split(';')[0];
    const env = {
      ...authEnv,
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SECRET_KEY: 'service-secret',
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
    };
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/providers/unstick-all', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: cookie }
      }),
      env
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.providersReset, ['gnews']);
    assert.deepEqual(data.runsClosed, ['run-1']);
    assert.equal(providerPatches.length, 1);
    assert.equal(providerPatches[0].status, 'failed');
    assert.equal(providerPatches[0].started_at, null);
    assert.equal(runPatches.length, 1);
    assert.equal(runPatches[0].status, 'failed');
    assert.equal(runPatches[0].current_provider, null);
    assert.equal(runPatches[0].summary.inProgress, true);
    assert.equal(runPatches[0].summary.unstuck, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('hourly sweep never reports a claim-collided provider as currently fetching', async () => {
  const originalFetch = globalThis.fetch;
  const runPatches = [];
  const rss = `<rss><channel><item><title>Hourly Story</title><link>https://publisher.example/hourly</link><description>Summary</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method || 'GET';
    if (url.hostname === 'gnews.io') {
      return Response.json({ articles: [{
        title: 'G story',
        url: 'https://publisher.example/g',
        image: '',
        description: 'd',
        content: 'c',
        publishedAt: new Date().toISOString(),
        source: { name: 'GNews Source' }
      }] });
    }
    if (url.hostname === 'www.bing.com') return new Response(rss);
    if (url.hostname === 'www.reddit.com') return new Response('not an atom feed');
    if (url.hostname === 'supabase.example') {
      if (url.pathname.endsWith('/rpc/claim_news_provider_sync')) {
        // GNews collides (another run holds its lock); the others claim fine.
        const body = JSON.parse(options.body || '{}');
        return Response.json(body.p_provider !== 'gnews');
      }
      if (url.pathname.endsWith('/news_provider_sync')) {
        return method === 'GET' ? Response.json([]) : new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/provider_sync_runs')) {
        if (method === 'POST') return Response.json([{ id: 'run-1' }]);
        runPatches.push(JSON.parse(options.body));
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/news_stories')) return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/news_provider_logs')) return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/provider_retry_queue')) return Response.json([]);
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const cookie = (await adminCookie()).split(';')[0];
    const cronEnv = {
      ...authEnv,
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SECRET_KEY: 'service-secret',
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
      GNEWS_API_KEY: 'test-key'
    };
    const enableRes = await worker.fetch(
      new Request('https://worker.example/admin/api/auto-sync', {
        method: 'POST',
        headers: {
          Origin: 'https://worker.example',
          Cookie: cookie,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: true })
      }),
      cronEnv
    );
    assert.equal(enableRes.status, 200);
    for (const provider of ['gnews', 'bing', 'reddit']) clearProviderCooldownState(provider);
    updateAiCurationConfig({ enabled: false });

    await worker.scheduled({ cron: '0 * * * *' }, cronEnv, {});

    // The fetching chains report themselves; the collided chain never
    // reaches the fetch, so no heartbeat may name it as current.
    const reported = runPatches.filter(p => p.current_provider != null);
    assert.ok(reported.length > 0);
    assert.ok(reported.every(p => p.current_provider !== 'gnews'));
  } finally {
    updateAiCurationConfig({ enabled: true });
    globalThis.fetch = originalFetch;
  }
});

test('admin ai-usage endpoint works without an Origin header (same-origin GET)', async () => {
  // Regression test: browsers send no Origin header on same-origin GET
  // fetches, so the endpoint must not require one — otherwise the dashboard
  // counts fetch 403s on every load and the counts stay hidden.
  const originalFetch = globalThis.fetch;
  const cookie = await adminCookie();
  const env = { ...authEnv, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'test-key' };
  const rows = [
    { usage_date: '2026-10-30', model: 'llama', usage_key: 'curation', calls: 2, errors: 0 }
  ];
  globalThis.fetch = async () => ({ ok: true, json: async () => rows });
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/ai-usage?days=30', {
        headers: { Cookie: cookie.split(';')[0] }
      }),
      env
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.rows, rows);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('hourly sweep finishes every provider when a pacing deferral cannot queue retries', async () => {
  const originalFetch = globalThis.fetch;
  const finishPatches = [];
  const storyPosts = [];
  const rss = `<rss><channel><item><title>Hourly Story</title><link>https://publisher.example/hourly</link><description>Summary</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
  // GNews reports an exhausted quota, so the second GNews pair takes the
  // pacing-deferral branch — whose retry-queue write is rigged to fail.
  // enqueue swallows queue failures (returns false), so the deferral must
  // complete with 0 queued and the sweep must finish every provider anyway,
  // not wedge or abort.
  const resetEpoch = Math.floor(Date.now() / 1000) + 3600;

  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method || 'GET';
    if (url.hostname === 'gnews.io') {
      return new Response(JSON.stringify({ articles: [{
        title: 'G story',
        url: 'https://publisher.example/g',
        image: '',
        description: 'd',
        content: 'c',
        publishedAt: new Date().toISOString(),
        source: { name: 'GNews Source' }
      }] }), { headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(resetEpoch) } });
    }
    if (url.hostname === 'www.bing.com') return new Response(rss);
    if (url.hostname === 'www.reddit.com') return new Response('not an atom feed');
    if (url.hostname === 'supabase.example') {
      if (url.pathname.endsWith('/rpc/claim_news_provider_sync')) return Response.json(true);
      if (url.pathname.endsWith('/news_stories')) {
        storyPosts.push(JSON.parse(options.body));
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/news_provider_logs')) return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/news_provider_sync')) {
        if (method === 'GET') return Response.json([]);
        // Only PATCH is a finish write; persistProviderCooldown upserts
        // via POST and must not be counted as one.
        if (method === 'PATCH') finishPatches.push({ provider: url.searchParams.get('provider'), body: JSON.parse(options.body) });
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/provider_retry_queue')) {
        if (method === 'GET') return Response.json([]);
        throw new Error('queue down');
      }
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };

  try {
    const cookie = (await adminCookie()).split(';')[0];
    const cronEnv = {
      ...authEnv,
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SECRET_KEY: 'service-secret',
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
      GNEWS_API_KEY: 'test-key'
    };
    const enableRes = await worker.fetch(
      new Request('https://worker.example/admin/api/auto-sync', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true })
      }),
      cronEnv
    );
    assert.equal(enableRes.status, 200);
    for (const provider of ['gnews', 'bing', 'reddit']) clearProviderCooldownState(provider);
    updateAiCurationConfig({ enabled: false });

    await worker.scheduled({ cron: '0 * * * *' }, cronEnv, {});

    // Every provider got a finish write despite the failed queue write, and
    // the pairs completed before the deferral still saved their stories.
    const finishedByProvider = {};
    for (const p of finishPatches) finishedByProvider[p.provider.replace('eq.', '')] = p.body.status;
    assert.deepEqual(Object.keys(finishedByProvider).sort(), ['bing', 'gnews', 'reddit']);
    assert.equal(finishedByProvider.gnews, 'partial');
    assert.equal(finishedByProvider.bing, 'succeeded');
    assert.equal(finishedByProvider.reddit, 'failed');
    assert.equal(storyPosts.length, 2);
    assert.equal(storyPosts.find(rows => rows[0].provider === 'gnews').length, 1);
    assert.equal(storyPosts.find(rows => rows[0].provider === 'bing').length, 7);
  } finally {
    updateAiCurationConfig({ enabled: true });
    globalThis.fetch = originalFetch;
  }
});

test('hourly sweep still saves stories when finish calls fail', async () => {
  const originalFetch = globalThis.fetch;
  const storyPosts = [];
  let finishAttempts = 0;
  const rss = `<rss><channel><item><title>Hourly Story</title><link>https://publisher.example/hourly</link><description>Summary</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;

  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method || 'GET';
    if (url.hostname === 'gnews.io') {
      return Response.json({ articles: [{
        title: 'G story',
        url: 'https://publisher.example/g',
        image: '',
        description: 'd',
        content: 'c',
        publishedAt: new Date().toISOString(),
        source: { name: 'GNews Source' }
      }] });
    }
    if (url.hostname === 'www.bing.com') return new Response(rss);
    if (url.hostname === 'www.reddit.com') return new Response('not an atom feed');
    if (url.hostname === 'supabase.example') {
      if (url.pathname.endsWith('/rpc/claim_news_provider_sync')) return Response.json(true);
      if (url.pathname.endsWith('/news_stories')) {
        storyPosts.push(JSON.parse(options.body));
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/news_provider_logs')) return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/news_provider_sync')) {
        if (method === 'GET') return Response.json([]);
        finishAttempts++;
        return new Response(null, { status: 500 });
      }
      if (url.pathname.endsWith('/provider_retry_queue')) return Response.json([]);
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };

  try {
    const cookie = (await adminCookie()).split(';')[0];
    const cronEnv = {
      ...authEnv,
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SECRET_KEY: 'service-secret',
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
      GNEWS_API_KEY: 'test-key'
    };
    const enableRes = await worker.fetch(
      new Request('https://worker.example/admin/api/auto-sync', {
        method: 'POST',
        headers: { Origin: 'https://worker.example', Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true })
      }),
      cronEnv
    );
    assert.equal(enableRes.status, 200);
    for (const provider of ['gnews', 'bing', 'reddit']) clearProviderCooldownState(provider);
    updateAiCurationConfig({ enabled: false });

    await worker.scheduled({ cron: '0 * * * *' }, cronEnv, {});

    // Stories still saved for both successful providers, and the sweep
    // completed instead of dying: each provider's finish was attempted in
    // the flush, retried in the flush catch, and retried by the safety net.
    assert.equal(storyPosts.length, 2);
    assert.equal(storyPosts.find(rows => rows[0].provider === 'gnews').length, 7);
    assert.equal(storyPosts.find(rows => rows[0].provider === 'bing').length, 7);
    assert.equal(finishAttempts, 9);
  } finally {
    updateAiCurationConfig({ enabled: true });
    globalThis.fetch = originalFetch;
  }
});

test('admin provider profile aggregates runs, logs and live status', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method || 'GET';
    if (url.hostname === 'supabase.example') {
      if (url.pathname.endsWith('/news_provider_sync') && method === 'GET') {
        return Response.json([{ provider: 'gnews', status: 'succeeded', started_at: null, last_attempt_at: '2026-10-30T21:00:00Z', last_success_at: '2026-10-30T21:00:00Z', stories_saved: 10, last_error: null, cooldown_until: null, rate_limit_reset_at: null, updated_at: '2026-10-30T21:00:00Z' }]);
      }
      if (url.pathname.endsWith('/provider_sync_runs')) {
        return Response.json([
          { id: 'run-live', trigger: 'cron', provider: null, status: 'running', started_at: '2026-10-30T21:00:00Z', finished_at: null, pairs_total: 42, pairs_done: 3, current_provider: 'gnews', current_category: 'tech', last_activity_at: '2026-10-30T21:01:00Z', last_telemetry: null, summary: { inProgress: true, providers: [{ provider: 'gnews', pairs: 3, lastStatus: 'succeeded', lastCategory: 'tech' }] } },
          { id: 'run-old', trigger: 'cron', provider: null, status: 'succeeded', started_at: '2026-10-30T20:00:00Z', finished_at: '2026-10-30T20:05:00Z', pairs_total: 42, pairs_done: 42, current_provider: null, current_category: null, last_activity_at: '2026-10-30T20:05:00Z', last_telemetry: null, summary: { totalStoriesSaved: 400, providers: [{ provider: 'gnews', status: 'succeeded', storiesSaved: 70 }] } }
        ]);
      }
      if (url.pathname.endsWith('/news_provider_logs')) {
        const allLogs = [
          { status: 'succeeded', items_fetched: 10, stories_saved: 10, created_at: '2026-10-30T20:00:00Z' },
          { status: 'failed', items_fetched: 0, stories_saved: 0, created_at: '2026-10-30T19:00:00Z' },
          { status: 'rate_limited', items_fetched: 0, stories_saved: 0, created_at: '2026-10-30T18:00:00Z' },
          { status: 'succeeded', items_fetched: 10, stories_saved: 10, created_at: '2026-10-30T17:00:00Z' }
        ];
        if (url.searchParams.get('limit') === '10') {
          return Response.json(allLogs.slice(0, 2).map(l => ({ ...l, category: 'tech', trigger_source: 'cron', http_status: 200, duration_ms: 100, attempt_count: 1, error_message: null })));
        }
        const offset = Number(url.searchParams.get('offset') || 0);
        return Response.json(allLogs.slice(offset));
      }
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const cookie = (await adminCookie()).split(';')[0];
    const env = {
      ...authEnv,
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SECRET_KEY: 'service-secret',
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
    };
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/providers/gnews/profile', {
        headers: { Origin: 'https://worker.example', Cookie: cookie }
      }),
      env
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.provider.id, 'gnews');
    assert.equal(data.provider.label, 'GNews');
    assert.equal(data.provider.credentialConfigured, false);
    assert.ok(data.provider.categories.includes('tech'));
    assert.equal(data.live.running, false);
    assert.equal(data.live.pairsDone, 3);
    assert.equal(data.live.isCurrentPair, true);
    assert.equal(data.live.activeRun.id, 'run-live');
    assert.equal(data.lastRuns.length, 2);
    assert.equal(data.lastRuns[0].providerStatus, 'succeeded', 'heartbeat-shaped entries resolve via lastStatus');
    assert.equal(data.lastRuns[1].storiesSaved, 70);
    assert.equal(data.lifetime.totalRequests, 4);
    assert.equal(data.lifetime.fetched, 20);
    assert.equal(data.lifetime.saved, 20);
    assert.equal(data.lifetime.succeeded, 2);
    assert.equal(data.lifetime.failed, 1);
    assert.equal(data.lifetime.rateLimited, 1);
    assert.equal(data.lifetime.lastSuccessAt, '2026-10-30T20:00:00Z');
    assert.equal(data.lifetime.truncated, false);
    assert.equal(data.recentLogs.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin provider profile rejects unknown providers', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('must not fetch for unknown providers'); };
  try {
    const cookie = (await adminCookie()).split(';')[0];
    const env = {
      ...authEnv,
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SECRET_KEY: 'service-secret',
      SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
    };
    const response = await worker.fetch(
      new Request('https://worker.example/admin/api/providers/nope/profile', {
        headers: { Origin: 'https://worker.example', Cookie: cookie }
      }),
      env
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Unknown news provider' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
