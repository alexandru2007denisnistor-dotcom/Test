import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Liest eine einfache .env-Datei (KEY=VALUE). Echte Umgebungsvariablen haben Vorrang. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadDotEnv() {
  try {
    return parseEnv(readFileSync(path.join(ROOT, '.env'), 'utf8'));
  } catch {
    return {};
  }
}

export function loadConfig(env = { ...loadDotEnv(), ...process.env }) {
  const get = (k, fallback = '') => (env[k] ?? '').toString().trim() || fallback;
  return {
    root: ROOT,
    port: Number(get('PORT', '3000')),
    host: get('HOST', '127.0.0.1'),
    spotify: {
      clientId: get('SPOTIFY_CLIENT_ID'),
      clientSecret: get('SPOTIFY_CLIENT_SECRET'),
      market: get('SPOTIFY_MARKET', 'DE'),
    },
    youtube: {
      apiKey: get('YOUTUBE_API_KEY'),
      region: get('YOUTUBE_REGION', 'DE'),
    },
  };
}
