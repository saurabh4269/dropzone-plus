// Ring account linking: Partner-Initiated OAuth 2.0 (PKCE S256), as documented at
// https://developer.amazon.com/docs/ring/api-documentation.html ("Partner-Initiated OAuth 2.0").
//   1. /auth/ring/start   -> redirect to account.ring.com/.../partner-link/authorize (client_id, redirect_uri,
//                            response_type=code, scope=ava.v1:read, state, code_challenge, S256)
//   2. user signs in to Ring, approves permissions and picks devices (Ring's UI)
//   3. /auth/ring/callback -> validate state, exchange code (+ code_verifier) at oauth.ring.com/oauth/token
//   4. PATCH /v1/accounts/me/app-integrations {status:"completed", account_identifier}
// Requires partner credentials issued during Ring onboarding (RING_CLIENT_ID, RING_CLIENT_SECRET,
// RING_REDIRECT_URI). Hackathon entrants don't receive these, so this path is implemented per the docs
// but has not been run against Ring; the Playground token and demo mode are the working fallbacks.

import { randomBytes, createHash } from 'node:crypto';

const AUTHORIZE = 'https://account.ring.com/account/integrations/partner-link/authorize';
const TOKEN = 'https://oauth.ring.com/oauth/token';
const pending = new Map(); // state -> { verifier, at }

export function oauthConfigured() {
  return Boolean(process.env.RING_CLIENT_ID && process.env.RING_CLIENT_SECRET && process.env.RING_REDIRECT_URI);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkcePair() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function authorizeUrl() {
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(16));
  pending.set(state, { verifier, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60000) pending.delete(k); // 10-min window
  const q = new URLSearchParams({
    client_id: process.env.RING_CLIENT_ID,
    redirect_uri: process.env.RING_REDIRECT_URI,
    response_type: 'code',
    scope: 'ava.v1:read', // the only scope the docs list as supported
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `${AUTHORIZE}?${q}`, state };
}

/** Validate state, exchange the code. Returns { ok, tokens } or { ok:false, error, description }. */
export async function handleCallback(params, { fetchImpl = fetch } = {}) {
  const state = params.get('state');
  const entry = state && pending.get(state);
  if (!entry) return { ok: false, error: 'invalid_state', description: 'State did not match a pending link request.' };
  pending.delete(state);
  if (params.get('error')) return { ok: false, error: params.get('error'), description: params.get('error_description') || '' };
  const code = params.get('code');
  if (!code) return { ok: false, error: 'missing_code' };
  const res = await fetchImpl(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: entry.verifier, client_id: process.env.RING_CLIENT_ID, client_secret: process.env.RING_CLIENT_SECRET, redirect_uri: process.env.RING_REDIRECT_URI }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) return { ok: false, error: 'token_exchange_failed', description: `HTTP ${res.status}` };
  return { ok: true, tokens: { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: Date.now() + (body.expires_in || 14400) * 1000 } };
}

export function maskEmail(email = '') {
  const [u, d] = String(email).split('@');
  if (!d) return 'dropzone-user';
  return `${u[0] || ''}***${u.length > 1 ? u[u.length - 1] : ''}@${d}`;
}
