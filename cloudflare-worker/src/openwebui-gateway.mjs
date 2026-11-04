import { getAdminIdentity } from './github-auth.mjs';

const SESSION_COOKIE = '__Host-lil_openwebui';
const SESSION_TTL_SECONDS = 15 * 60;
const SESSION_PATH = '/__lil/auth';
const UPSTREAM_PREFIX = '/_internal/openwebui';
const ALLOWED_PARENT_ORIGINS = ['https://littlables.com', 'https://www.littlables.com'];

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  return base64UrlEncodeBytes(bytes);
}

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function getCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator >= 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function sessionKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('LIL_WEBUI_SESSION_SECRET must be at least 32 characters');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function createSessionCookie(login, secret, now = Date.now()) {
  const payload = base64UrlEncode(JSON.stringify({
    login,
    expiresAt: Math.floor(now / 1000) + SESSION_TTL_SECONDS
  }));
  const key = await sessionKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await key, new TextEncoder().encode(payload)));
  const token = `${payload}.${base64UrlEncodeBytes(signature)}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

async function hasValidSession(request, secret) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const separator = token.lastIndexOf('.');
  if (separator < 1) return false;
  try {
    const payload = token.slice(0, separator);
    const signature = base64UrlDecode(token.slice(separator + 1));
    const key = await sessionKey(secret);
    if (!await crypto.subtle.verify('HMAC', await key, signature, new TextEncoder().encode(payload))) {
      return false;
    }
    const session = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    return typeof session.login === 'string' && session.login.length > 0 &&
      Number.isInteger(session.expiresAt) && session.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function relayPage() {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#160c2b">
  <title>Sign in required | Littlables Lil</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: 'Quicksand', 'Segoe UI', sans-serif;
      color: #fbf7ff;
      background: #10091d;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }
    * { box-sizing: border-box; }
    body {
      min-width: 320px;
      min-height: 100vh;
      min-height: 100svh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(ellipse at 18% 18%, rgba(147, 51, 234, .22), transparent 42%),
        radial-gradient(ellipse at 86% 82%, rgba(217, 70, 239, .13), transparent 38%),
        #10091d;
    }
    main {
      width: min(100%, 480px);
      padding: clamp(28px, 7vw, 48px);
      border: 1px solid rgba(216, 180, 254, .22);
      border-radius: 28px;
      background: linear-gradient(145deg, rgba(38, 21, 64, .96), rgba(25, 13, 43, .98));
      box-shadow: 0 24px 80px rgba(0, 0, 0, .38), 0 0 50px rgba(147, 51, 234, .1);
      text-align: center;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      margin-bottom: 28px;
      color: #e9d5ff;
      font-size: .78rem;
      font-weight: 700;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    .brand-mark {
      display: grid;
      width: 36px;
      height: 36px;
      place-items: center;
      border: 1px solid rgba(216, 180, 254, .3);
      border-radius: 13px;
      background: linear-gradient(145deg, #9333ea, #d946ef);
      box-shadow: 0 5px 18px rgba(168, 85, 247, .3);
      font-size: 19px;
      letter-spacing: 0;
    }
    h1 {
      margin: 0;
      font-family: 'Fredoka', 'Trebuchet MS', sans-serif;
      font-size: clamp(1.8rem, 7vw, 2.35rem);
      font-weight: 600;
      letter-spacing: -.025em;
    }
    .description {
      margin: 14px 0 26px;
      color: #c4b5d7;
      font-size: 1rem;
      line-height: 1.7;
    }
    .status {
      min-height: 1.5em;
      margin: 0 0 22px;
      color: #e9d5ff;
      font-size: .9rem;
      line-height: 1.5;
    }
    .continue {
      display: flex;
      min-height: 52px;
      align-items: center;
      justify-content: center;
      gap: 9px;
      padding: 13px 20px;
      border: 1px solid rgba(245, 208, 254, .38);
      border-radius: 16px;
      background: linear-gradient(100deg, #9333ea, #c026d3);
      box-shadow: 0 8px 24px rgba(147, 51, 234, .25);
      color: #fff;
      font-size: 1rem;
      font-weight: 700;
      text-decoration: none;
      transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
    }
    .continue:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 30px rgba(147, 51, 234, .36);
      filter: brightness(1.08);
    }
    .continue:focus-visible {
      outline: 3px solid #f0abfc;
      outline-offset: 4px;
    }
    .footnote {
      margin: 22px 0 0;
      color: #9c8bab;
      font-size: .78rem;
      line-height: 1.55;
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="brand-mark" aria-hidden="true">✦</span> Littlables <span aria-hidden="true">·</span> Lil</div>
    <h1>Sign in to Littlables</h1>
    <p class="description">Your little corner for curious questions and big discoveries.</p>
    <p class="status" id="status" role="status" aria-live="polite">Open Lil while signed in to your Littlables admin account to continue to Open WebUI.</p>
    <a class="continue" href="https://littlables.com/lil?openWebUI=1">Go to Lil <span aria-hidden="true">→</span></a>
    <p class="footnote">Open WebUI is available to Littlables administrators.</p>
  </main>
  <script>
    const parentOrigin = ${JSON.stringify(ALLOWED_PARENT_ORIGINS)};
    const status = document.getElementById('status');
    let completed = false;
    function announce() {
      if (window.parent === window) return;
      for (const origin of parentOrigin) {
        window.parent.postMessage({ type: 'LITTLABLES_OPENWEBUI_AUTH_REQUIRED' }, origin);
      }
    }
    window.addEventListener('message', async (event) => {
      if (completed || !parentOrigin.includes(event.origin) ||
          event.data?.type !== 'LITTLABLES_OPENWEBUI_ADMIN_SESSION' ||
          typeof event.data.accessToken !== 'string') return;
      completed = true;
      status.textContent = 'Verifying your Littlables account…';
      try {
        const response = await fetch('${SESSION_PATH}', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + event.data.accessToken },
          credentials: 'same-origin'
        });
        if (!response.ok) {
          status.textContent = response.status === 403
            ? 'This Littlables account is not an administrator.'
            : 'Could not verify the Littlables account. Please sign in again and retry.';
          completed = false;
          return;
        }
        location.replace('/');
      } catch {
        status.textContent = 'Could not verify the Littlables account. Please retry.';
        completed = false;
      }
    });
    if (window.parent === window) {
      status.textContent = 'Opening Open WebUI through your Littlables account…';
      window.location.replace('https://littlables.com/lil?openWebUI=1');
    } else {
      announce();
      const retry = setInterval(() => {
        if (completed) clearInterval(retry);
        else announce();
      }, 1000);
      setTimeout(() => clearInterval(retry), 30000);
    }
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "connect-src 'self'",
        `frame-ancestors ${ALLOWED_PARENT_ORIGINS.join(' ')}`,
        "base-uri 'none'",
        "form-action 'none'"
      ].join('; '),
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function jsonResponse(body, status) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

function removeGatewayCookie(cookieHeader) {
  const cookies = String(cookieHeader || '')
    .split(';')
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie && !cookie.startsWith(`${SESSION_COOKIE}=`));
  return cookies.length ? cookies.join('; ') : null;
}

function getApiOrigin(env) {
  const configuredOrigin = String(env.LIL_API_ORIGIN || '').trim();
  if (!configuredOrigin) throw new Error('LIL_API_ORIGIN is not configured');
  const origin = new URL(configuredOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') {
    throw new Error('LIL_API_ORIGIN must be an HTTPS origin');
  }
  return origin;
}

export async function handleOpenWebUIGateway(request, env) {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === SESSION_PATH) {
    if (request.headers.get('Origin') !== url.origin) {
      return jsonResponse({ error: 'Same-origin sign-in is required.' }, 403);
    }
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ') || !authHeader.slice(7).trim()) {
      return jsonResponse({ error: 'A Littlables sign-in is required.' }, 401);
    }
    const identityRequest = new Request(request.url, {
      headers: { Authorization: authHeader }
    });
    const identity = await getAdminIdentity(identityRequest, env);
    if (!identity?.login) {
      return jsonResponse({ error: 'A Littlables administrator account is required.' }, 403);
    }
    try {
      return new Response(null, {
        status: 204,
        headers: {
          'Set-Cookie': await createSessionCookie(identity.login, env.LIL_WEBUI_SESSION_SECRET),
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
          'X-Content-Type-Options': 'nosniff'
        }
      });
    } catch (error) {
      console.error('[Open WebUI gateway] Session setup failed:', error);
      return jsonResponse({ error: 'Littlables sign-in is not configured.' }, 503);
    }
  }

  if (request.method === 'POST' && url.pathname === '/__lil/logout') {
    return new Response(null, {
      status: 204,
      headers: {
        'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
        'Cache-Control': 'no-store'
      }
    });
  }

  let hasSession = false;
  try {
    hasSession = await hasValidSession(request, env.LIL_WEBUI_SESSION_SECRET);
  } catch (error) {
    console.error('[Open WebUI gateway] Session verification failed:', error);
  }
  if (!hasSession) {
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/') {
      return relayPage();
    }
    return jsonResponse({ error: 'A Littlables administrator sign-in is required.' }, 401);
  }

  const proxySecret = String(env.LIL_OPENWEBUI_PROXY_SECRET || '');
  if (proxySecret.length < 32) {
    return jsonResponse({ error: 'Open WebUI gateway is not configured.' }, 503);
  }

  let upstream;
  try {
    const apiOrigin = getApiOrigin(env);
    const upstreamUrl = new URL(`${UPSTREAM_PREFIX}${url.pathname}${url.search}`, apiOrigin);
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('cf-connecting-ip');
    const cookie = removeGatewayCookie(headers.get('Cookie'));
    if (cookie) headers.set('Cookie', cookie);
    else headers.delete('Cookie');
    headers.set('X-Lil-OpenWebUI-Proxy-Secret', proxySecret);
    headers.set('X-Forwarded-Host', url.host);
    headers.set('X-Forwarded-Proto', 'https');
    const init = {
      method: request.method,
      headers,
      redirect: 'manual'
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
    upstream = await fetch(upstreamUrl, init);
  } catch (error) {
    console.error('[Open WebUI gateway] Upstream request failed:', error);
    return jsonResponse({ error: 'Open WebUI is currently unavailable.' }, 502);
  }

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}
