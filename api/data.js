// Fonction serverless Vercel : stockage partagé du planning dans Upstash Redis (API REST).
// Variables d'environnement (créées automatiquement par l'intégration Upstash du Marketplace Vercel) :
//   KV_REST_API_URL / KV_REST_API_TOKEN   (ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)
//   APP_PASSWORD (optionnel, recommandé) : code d'accès demandé aux utilisateurs.
import { timingSafeEqual } from 'node:crypto';

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PASSWORD = process.env.APP_PASSWORD || '';
const K_VER = 'planning:version';
const K_DATA = 'planning:data';

// Écriture atomique : n'enregistre que si la version de base correspond (sinon conflit 409).
const SAVE_SCRIPT = `
local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v ~= tonumber(ARGV[1]) then return {0, v} end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SET', KEYS[1], v + 1)
return {1, v + 1}`;

async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `Redis HTTP ${r.status}`);
  return j.result;
}

function authorized(req) {
  if (!PASSWORD) return true;
  const given = Buffer.from(String(req.headers['x-app-key'] || ''));
  const expected = Buffer.from(PASSWORD);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function current() {
  const [ver, data] = await redis(['MGET', K_VER, K_DATA]);
  return { version: Number(ver || 0), data: data ? JSON.parse(data) : null };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) return res.status(401).json({ error: 'Code d\'accès invalide' });
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ error: 'no-storage' });

  try {
    if (req.method === 'GET') {
      if (req.query.v !== undefined) {
        const ver = Number((await redis(['GET', K_VER])) || 0);
        if (ver === Number(req.query.v)) return res.status(200).json({ version: ver, unchanged: true });
      }
      return res.status(200).json(await current());
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { baseVersion, data } = body || {};
      if (!Number.isInteger(baseVersion) || !data || !Array.isArray(data.techs) || !Array.isArray(data.sites) || !Array.isArray(data.jobs)) {
        return res.status(400).json({ error: 'Données invalides' });
      }
      const [ok, version] = await redis(['EVAL', SAVE_SCRIPT, '2', K_VER, K_DATA, String(baseVersion), JSON.stringify(data)]);
      if (ok === 1) return res.status(200).json({ version });
      return res.status(409).json(await current());
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
