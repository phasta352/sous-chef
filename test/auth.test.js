import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, _resetCertsCache } from '../src/auth.js';
import worker from '../src/worker.js';

const TEAM = 'example.cloudflareaccess.com';
const AUD = 'test-aud-123';

const b64url = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
const fakeFetch = async () => new Response(JSON.stringify({ keys: [jwk] }));

async function makeToken(overrides = {}, header = { alg: 'RS256', kid: 'k1' }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://${TEAM}`, aud: [AUD], email: 'ben@example.com', exp: now + 600, iat: now, ...overrides };
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

const req = (token) =>
  new Request('https://app.test/api/me', token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {});
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

beforeEach(() => _resetCertsCache());

test('accepts a valid Access token', async () => {
  assert.equal(await authenticate(req(await makeToken()), env, fakeFetch), 'ben@example.com');
});

test('rejects a request with no token', async () => {
  assert.equal(await authenticate(req(), env, fakeFetch), null);
});

test('rejects wrong audience, issuer, expiry and tampered tokens', async () => {
  assert.equal(await authenticate(req(await makeToken({ aud: ['other'] })), env, fakeFetch), null);
  assert.equal(await authenticate(req(await makeToken({ iss: 'https://evil.test' })), env, fakeFetch), null);
  assert.equal(await authenticate(req(await makeToken({ exp: 1 })), env, fakeFetch), null);
  const good = await makeToken();
  const [h, , s] = good.split('.');
  const forged = b64url(new TextEncoder().encode(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: 'x@evil.test', exp: 9999999999 })));
  assert.equal(await authenticate(req(`${h}.${forged}.${s}`), env, fakeFetch), null);
});

test('ACCESS_AUD accepts a comma-separated list', async () => {
  const multi = { ...env, ACCESS_AUD: `preview-aud, ${AUD}` };
  assert.equal(await authenticate(req(await makeToken()), multi, fakeFetch), 'ben@example.com');
  assert.equal(await authenticate(req(await makeToken({ aud: ['other'] })), multi, fakeFetch), null);
});

test('fails closed when Access is not configured', async () => {
  assert.equal(await authenticate(req(await makeToken()), {}, fakeFetch), null);
});

test('DEV_USER_EMAIL signs in locally', async () => {
  assert.equal(await authenticate(req(), { DEV_USER_EMAIL: 'dev@example.com' }, fakeFetch), 'dev@example.com');
});

test('worker returns 401 for unauthenticated API calls and serves assets otherwise', async () => {
  const assets = { fetch: async () => new Response('index') };
  const res = await worker.fetch(new Request('https://app.test/api/me'), { ...env, ASSETS: assets });
  assert.equal(res.status, 401);
  const page = await worker.fetch(new Request('https://app.test/'), { ...env, ASSETS: assets });
  assert.equal(await page.text(), 'index');
});

test('worker /api/me and /api/health work when signed in', async () => {
  const DB = { prepare: () => ({ first: async () => ({ items: 3 }) }) };
  const devEnv = { DEV_USER_EMAIL: 'dev@example.com', DB };
  const me = await worker.fetch(new Request('https://app.test/api/me'), devEnv);
  assert.deepEqual(await me.json(), { email: 'dev@example.com' });
  const health = await worker.fetch(new Request('https://app.test/api/health'), devEnv);
  assert.deepEqual(await health.json(), { ok: true, items: 3 });
});
