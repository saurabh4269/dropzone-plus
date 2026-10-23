import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pkcePair, authorizeUrl, handleCallback, maskEmail } from '../lib/oauth.js';

process.env.RING_CLIENT_ID = 'cid'; process.env.RING_CLIENT_SECRET = 'sec'; process.env.RING_REDIRECT_URI = 'https://app.example/auth/ring/callback';

test('PKCE: challenge = base64url(sha256(verifier)), no padding', () => {
  const { verifier, challenge } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
});

test('authorize URL matches the documented Partner-Initiated parameters', () => {
  const { url, state } = authorizeUrl();
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://account.ring.com/account/integrations/partner-link/authorize');
  const q = u.searchParams;
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('scope'), 'ava.v1:read');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('state'), state);
  assert.equal(q.get('redirect_uri'), process.env.RING_REDIRECT_URI);
});

test('callback rejects unknown state (CSRF) and surfaces Ring errors', async () => {
  assert.equal((await handleCallback(new URLSearchParams({ state: 'nope', code: 'x' }))).error, 'invalid_state');
  const { state } = authorizeUrl();
  const r = await handleCallback(new URLSearchParams({ state, error: 'access_denied', error_description: 'no base plan' }));
  assert.equal(r.error, 'access_denied');
});

test('callback exchanges code with code_verifier; state is single-use', async () => {
  const { url, state } = authorizeUrl();
  const challenge = new URL(url).searchParams.get('code_challenge');
  let sent;
  const fetchImpl = async (u, o) => { sent = { u, body: new URLSearchParams(o.body) }; return new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 14400 }), { status: 200 }); };
  const r = await handleCallback(new URLSearchParams({ state, code: 'C0DE' }), { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(sent.u, 'https://oauth.ring.com/oauth/token');
  assert.equal(sent.body.get('grant_type'), 'authorization_code');
  assert.equal(createHash('sha256').update(sent.body.get('code_verifier')).digest('base64url'), challenge);
  assert.equal((await handleCallback(new URLSearchParams({ state, code: 'C0DE' }), { fetchImpl })).error, 'invalid_state');
});

test('account identifier is masked before it is sent to Ring', () => {
  assert.equal(maskEmail('user@partner.example.com'), 'u***r@partner.example.com');
});
