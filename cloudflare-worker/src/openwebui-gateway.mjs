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
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in required</title></head>
<body>
  <main>
    <h1>Sign in to Littlables</h1>
    <p id="status">Open Lil while signed in to your Littlables admin account to continue to Open WebUI.</p>
    <a href="https://littlables.com/lil">Go to Lil</a>
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
    announce();
    const retry = setInterval(() => {
      if (completed) clearInterval(retry);
      else announce();
    }, 1000);
    setTimeout(() => clearInterval(retry), 30000);
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
