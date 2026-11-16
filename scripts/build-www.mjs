// Kopiert die Web-App nach www/ und bündelt die nativen Capacitor-Plugins (native.js).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const FILES = ['index.html', 'styles.css', 'app.js', 'exercises.js', 'manifest.json', 'icon.svg', 'sw.js'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
FILES.forEach((f) => cpSync(f, `www/${f}`));

await build({ entryPoints: ['native/native.js'], bundle: true, format: 'iife', minify: true, target: 'es2020', outfile: 'www/native.js' });

const html = readFileSync('www/index.html', 'utf8');
if (!html.includes('<script src="exercises.js">')) throw new Error('index.html: exercises.js-Script nicht gefunden');
writeFileSync('www/index.html', html.replace('<script src="exercises.js">', '<script src="native.js"></script>\n  <script src="exercises.js">'));
console.log('www/ gebaut');
