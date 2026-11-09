// Bundles the helper (and the shared code it reuses) into ONE file, because Apps Script has
// no module system and the owner pastes a single file into the editor (see docs/SETUP.md B4.4).
//
//   node scripts/build.mjs           writes release/Code.js and release/appsscript.json
//   node scripts/build.mjs --check   fails if the committed release is out of date (CI/`npm run check`)
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const out = new URL('release/Code.js', root);
const check = process.argv.includes('--check');

// Functions the Apps Script editor, triggers and the web-app runtime look up *by name*. They must
// exist as top-level declarations (the editor's Run menu only lists those), so we append thin
// wrappers around the bundled implementation.
const ENTRY_POINTS = ['doGet', 'doPost', 'setup', 'runScheduler', 'runHousekeeping', 'runDigest'];

const result = await build({
  // Pin the working directory: esbuild writes source paths into comments relative to it, so
  // building from the repo root and from this folder must give identical bytes.
  absWorkingDir: root.pathname,
  entryPoints: [new URL('src/Code.ts', root).pathname],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'Sorted',
  target: 'es2020',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['import'],
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning',
});

const banner = `/**
 * Sorted helper: GENERATED FILE. Do not edit here.
 * Source: apps-script/src (+ shared/src). Rebuild with \`npm run build -w apps-script\`.
 * Paste this whole file into the Apps Script editor's Code.gs (docs/SETUP.md B4.4).
 */
`;
const wrappers = ENTRY_POINTS.map(
  (n) => `function ${n}(...args) { return Sorted.${n}(...args); }`,
).join('\n');
const code = `${banner}${result.outputFiles[0].text}\n${wrappers}\n`;

const manifest = readFileSync(new URL('appsscript.json', root), 'utf8');
const files = [
  [out, code],
  [new URL('release/appsscript.json', root), manifest],
];

if (check) {
  const stale = files.filter(
    ([url, text]) => !existsSync(url) || readFileSync(url, 'utf8') !== text,
  );
  if (stale.length) {
    console.error(
      `apps-script/release is out of date (${stale.map(([u]) => u.pathname.split('/').pop()).join(', ')}). Run: npm run build -w apps-script`,
    );
    process.exit(1);
  }
  console.log('apps-script/release is up to date');
} else {
  mkdirSync(new URL('release/', root), { recursive: true });
  for (const [url, text] of files) writeFileSync(url, text);
  console.log(
    `Wrote release/Code.js (${(code.length / 1024).toFixed(0)} KB) and release/appsscript.json`,
  );
}
