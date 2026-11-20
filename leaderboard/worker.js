// Topplista för Turbogalopp (haest.se/turbogalopp/), som en Cloudflare Worker med en D1-databas.
//
// Bindningar som Workern behöver (se README.md):
//   DB      D1-databasen med tabellen i schema.sql
//   SECRET  en lång slumpad hemlighet, används för att signera spelomgångar
//   ALLOWED_ORIGINS (valfri) kommaseparerade adresser som får anropa, standard haest.se
//
// Endpoints:
//   POST /start   -> { token }            anropas när en spelomgång börjar
//   POST /submit  { token, name, score, playTime, dist, bonus } -> { ok, rank, top }
//   GET  /top     -> { top: [{ name, score, date }] }
//
// Fuskskydd: spelet körs i webbläsaren, så ingen topplista går att göra helt fuskfri.
// Den här gör det svårt: varje inskickning måste ha en signerad biljett från spelets start,
// biljetten kan bara användas en gång, poängen måste gå ihop med spelets egen formel och
// vara möjlig på den tid som faktiskt har gått, och samma IP kan bara skicka några gånger.
// Fusk som ändå slinker igenom raderar ni i D1-konsolen (se README.md).

// Spelets konstanter (turbogalopp/index.html): poäng = floor(sträcka * 0.5) + bonus,
// toppfart 300, morot 250 och hjärta 100 i bonus.
const MAX_SPEED = 300;
const MAX_BONUS_PER_SEC = 1600;   // mer än man hinner plocka även i toppfart
const MAX_PLAY_TIME = 60 * 60;    // en timme
const TOKEN_MAX_AGE = 2 * 60 * 60 * 1000;
const SUBMITS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;
const TOP_N = 10;

const DEFAULT_ORIGINS = ['https://haest.se', 'https://www.haest.se'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : DEFAULT_ORIGINS);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    const json = (body, status = 200, extra = {}) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!env.DB || !env.SECRET) return json({ error: 'Topplistan är inte konfigurerad.' }, 500);

    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/top' && request.method === 'GET') {
        return json({ top: await topList(env.DB) }, 200, { 'Cache-Control': 'public, max-age=15' });
      }
      if (pathname === '/start' && request.method === 'POST') {
        return json({ token: await makeToken(env.SECRET) }, 200, { 'Cache-Control': 'no-store' });
      }
      if (pathname === '/submit' && request.method === 'POST') {
        return await submit(request, env, json);
      }
      return json({ error: 'Finns inte.' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'Något gick fel, försök igen.' }, 500);
    }
  }
};

async function submit(request, env, json) {
  const text = await request.text();
  if (text.length > 2000) return json({ error: 'För stor förfrågan.' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Ogiltig förfrågan.' }, 400); }

  const run = await readToken(env.SECRET, body.token);
  if (!run) return json({ error: 'Ogiltig spelomgång.' }, 400);
  const elapsed = (Date.now() - run.t) / 1000;
  if (elapsed * 1000 > TOKEN_MAX_AGE) return json({ error: 'Spelomgången är för gammal.' }, 400);

  const name = cleanName(body.name);
  if (!name.ok) return json({ error: name.error }, 400);

  const score = body.score, playTime = body.playTime, dist = body.dist, bonus = body.bonus;
  const plausible =
    [score, playTime, dist, bonus].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) &&
    Number.isInteger(score) && Number.isInteger(bonus) && score >= 1 &&
    bonus % 50 === 0 &&
    playTime <= MAX_PLAY_TIME &&
    playTime <= elapsed + 3 &&                         // kan inte ha spelat längre än det gått
    dist <= MAX_SPEED * playTime * 1.02 + 50 &&        // inte snabbare än toppfarten
    bonus <= MAX_BONUS_PER_SEC * playTime + 2000 &&
    score === Math.floor(dist * 0.5) + bonus;          // samma formel som spelet
  if (!plausible) return json({ error: 'Poängen gick inte ihop.' }, 400);

  const ipHash = await hmac(env.SECRET, 'ip:' + (request.headers.get('CF-Connecting-IP') || 'okänd'));
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash.slice(0, 32), Date.now() - WINDOW_MS).first();
  if (recent && recent.n >= SUBMITS_PER_WINDOW) return json({ error: 'Lugna hästarna! Försök igen om en stund.' }, 429);

  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO scores (run_id, name, name_key, score, play_time, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(run.id, name.value, name.key, score, Math.round(playTime * 10) / 10, Date.now(), ipHash.slice(0, 32)).run();
  if (!res.meta || res.meta.changes !== 1) return json({ error: 'Den här omgången är redan inskickad.' }, 409);

  // Placering: antal namn vars bästa resultat är högre, plus ett.
  const better = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM (SELECT name_key, MAX(score) AS best FROM scores GROUP BY name_key) WHERE best > ?'
  ).bind(score).first();
  return json({ ok: true, rank: (better ? better.n : 0) + 1, top: await topList(env.DB) });
}

async function topList(db) {
  const { results } = await db.prepare(
    `SELECT name, score, created_at FROM (
       SELECT name, score, created_at,
              ROW_NUMBER() OVER (PARTITION BY name_key ORDER BY score DESC, created_at ASC) AS rn
       FROM scores)
     WHERE rn = 1 ORDER BY score DESC, created_at ASC LIMIT ?`
  ).bind(TOP_N).all();
  return (results || []).map(r => ({ name: r.name, score: r.score, date: new Date(r.created_at).toISOString().slice(0, 10) }));
}

// ---- Namn ----

// Ord som inte får förekomma någonstans i namnet (även med siffror som bokstäver, t.ex. "n1gg3r").
const BLOCK_ANYWHERE = ['nigger', 'nigga', 'neger', 'faggot', 'hitler', 'nazi', 'siegheil', 'fitta', 'cunt', 'rapist', 'pedofil', 'pedophile', 'kukhuvud', 'horunge'];
// Korta ord som bara stoppas som hela ord, så att t.ex. "Stefan" och "Kukka" fungerar.
const BLOCK_WORD = ['kuk', 'hora', 'fag', 'fuck', 'shit', 'cock', 'dick', 'whore', 'slut', 'bög', 'mongo', 'jävla', 'javla', 'fan', 'skit'];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

export function cleanName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Skriv ett namn.' };
  const value = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (value.length < 2) return { ok: false, error: 'Namnet måste vara minst 2 tecken.' };
  if (value.length > 16) return { ok: false, error: 'Namnet får vara högst 16 tecken.' };
  if (!/^[\p{L}\p{N} _.\-!?']+$/u.test(value)) return { ok: false, error: 'Använd bara bokstäver, siffror och - _ . ! ?' };
  if (/https?|www\.|\.(com|se|net|org)\b/i.test(value)) return { ok: false, error: 'Inga länkar i namnet.' };
  const lower = value.toLowerCase();
  const squashed = [...lower].map(c => LEET[c] || c).join('').replace(/[^\p{L}]/gu, '');
  const words = lower.split(/[^\p{L}\p{N}]+/u).map(w => [...w].map(c => LEET[c] || c).join(''));
  if (BLOCK_ANYWHERE.some(w => squashed.includes(w)) || words.some(w => BLOCK_WORD.includes(w))) {
    return { ok: false, error: 'Välj ett annat namn.' };
  }
  return { ok: true, value, key: lower };
}

// ---- Signerade biljetter för spelomgångar ----

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function hmac(secret, data) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function makeToken(secret) {
  const id = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const payload = b64url(enc.encode(JSON.stringify({ id, t: Date.now() })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}
async function readToken(secret, token) {
  if (typeof token !== 'string' || token.length > 300) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const run = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return typeof run.id === 'string' && typeof run.t === 'number' && run.t <= Date.now() + 5000 ? run : null;
  } catch {
    return null;
  }
}
