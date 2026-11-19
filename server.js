import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './src/config.js';
import { createApi } from './src/api.js';
import { createDeezer } from './src/providers/deezer.js';
import { createSpotify } from './src/providers/spotify.js';
import { createYouTube } from './src/providers/youtube.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createProviders(config, fetchImpl) {
  return {
    deezer: createDeezer({ fetchImpl }),
    spotify: createSpotify({ ...config.spotify, fetchImpl }),
    youtube: createYouTube({ ...config.youtube, fetchImpl }),
  };
}

export function createAppServer({ config = loadConfig(), providers = createProviders(config) } = {}) {
  const api = createApi({ providers });
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

  async function serveStatic(pathname, res) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir + path.sep)) return false; // kein Ausbrechen aus /public
    try {
      const info = await stat(file);
      if (!info.isFile()) return false;
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const out = await api(req.method, url.pathname, url.searchParams);
        const status = out?.status ?? 404;
        const body = out?.body ?? { error: 'Nicht gefunden' };
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(JSON.stringify(body));
        return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (await serveStatic(url.pathname, res)) return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nicht gefunden');
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Interner Fehler');
    }
  });
}

// Direkt gestartet (node server.js)?
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const server = createAppServer({ config });
  server.listen(config.port, config.host, () => {
    const on = (b) => (b ? 'aktiv' : 'nicht eingerichtet');
    console.log(`\n  🎧 Klangwerk läuft auf http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}\n`);
    console.log(`  Deezer   aktiv (kein Schlüssel nötig)`);
    console.log(`  Spotify  ${on(config.spotify.clientId && config.spotify.clientSecret)}`);
    console.log(`  YouTube  ${on(config.youtube.apiKey)}\n`);
  });
}
