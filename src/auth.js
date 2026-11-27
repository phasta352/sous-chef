// Verifies the Cloudflare Access JWT on every API request.
//
// Cloudflare Access sits in front of the app and only lets in the emails you
// allow. As a second line of defence the Worker checks the signed token Access
// attaches (Cf-Access-Jwt-Assertion), so a misconfigured route can never expose
// the data. If Access is not configured the API refuses every request.

const CERTS_TTL_MS = 60 * 60 * 1000;
let certsCache = { url: null, keys: null, fetchedAt: 0 };

function b64urlToBytes(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob((str + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function getSigningKeys(teamDomain, fetchImpl) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const now = Date.now();
  if (certsCache.url === url && certsCache.keys && now - certsCache.fetchedAt < CERTS_TTL_MS) {
    return certsCache.keys;
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Could not fetch Access certs (${res.status})`);
  const { keys } = await res.json();
  certsCache = { url, keys, fetchedAt: now };
  return keys;
}

export function _resetCertsCache() {
  certsCache = { url: null, keys: null, fetchedAt: 0 };
}

async function verifyAccessJwt(token, teamDomain, aud, fetchImpl) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeJson(headerB64);
  const payload = decodeJson(payloadB64);

  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');

  const keys = await getSigningKeys(teamDomain, fetchImpl);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new Error('Bad signature');

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < nowSec) throw new Error('Token expired');
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) throw new Error('Token not yet valid');
  if (payload.iss !== `https://${teamDomain}`) throw new Error('Wrong issuer');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  // ACCESS_AUD may list several tags separated by commas (e.g. production and preview apps).
  const allowed = aud.split(',').map((a) => a.trim()).filter(Boolean);
  if (!auds.some((a) => allowed.includes(a))) throw new Error('Wrong audience');
  if (!payload.email) throw new Error('Token has no email');

  return payload.email;
}

/**
 * Returns the signed-in user's email, or null if the request is not authenticated.
 */
export async function authenticate(request, env, fetchImpl = fetch) {
  // Local development only: `.dev.vars` can set DEV_USER_EMAIL to skip Access.
  if (env.DEV_USER_EMAIL) return env.DEV_USER_EMAIL;

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;

  try {
    return await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, fetchImpl);
  } catch (err) {
    console.warn('Access JWT rejected:', err.message);
    return null;
  }
}
