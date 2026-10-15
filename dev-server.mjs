// Serveur local de développement : sert /public et imite /api/data avec un fichier JSON.
//   npm run dev              → mode partagé (fichier .data.local.json)
//   npm run dev -- --no-api  → simule l'absence de base (mode local navigateur)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const DB = process.env.DATA_FILE || path.join(root, '.data.local.json');
const PORT = Number(process.env.PORT) || 3000;
const PASSWORD = process.env.APP_PASSWORD || '';
const VIEW_PASSWORD = process.env.VIEW_PASSWORD || '';
const NO_API = process.argv.includes('--no-api');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

const load = async () => { try { return JSON.parse(await fs.readFile(DB, 'utf8')); } catch { return { version: 0, data: null }; } };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/data') {
    if (NO_API) return send(res, 503, { error: 'no-storage' });
    const key = req.headers['x-app-key'] || '';
    const role = !PASSWORD || key === PASSWORD ? 'edit' : VIEW_PASSWORD && key === VIEW_PASSWORD ? 'view' : null;
    if (!role) return send(res, 401, { error: 'Code d\'accès invalide' });
    const db = await load();
    if (req.method === 'GET') {
      const v = url.searchParams.get('v');
      if (v !== null && Number(v) === db.version) return send(res, 200, { version: db.version, role, unchanged: true });
      return send(res, 200, { ...db, role });
    }
    if (req.method === 'PUT') {
      if (role !== 'edit') return send(res, 403, { error: 'Accès en lecture seule' });
      let body = '';
      for await (const chunk of req) body += chunk;
      let j;
      try { j = JSON.parse(body); } catch { return send(res, 400, { error: 'JSON invalide' }); }
      if (j.baseVersion !== db.version) return send(res, 409, db);
      const next = { version: db.version + 1, data: j.data };
      await fs.writeFile(DB, JSON.stringify(next));
      return send(res, 200, { version: next.version });
    }
    return send(res, 405, { error: 'Méthode non autorisée' });
  }

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(publicDir, rel);
  if (!file.startsWith(publicDir + path.sep)) { res.writeHead(403); return res.end('Interdit'); }
  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end('Introuvable');
  }
}).listen(PORT, () => console.log(`Planning Chantier → http://localhost:${PORT}${NO_API ? ' (sans API)' : ''}`));
