// Builds the store packages into dist/. No dependencies: node tools/build.mjs
//
//   dist/gm-native-maps-firefox-<version>.zip   Firefox Add-ons (AMO)
//   dist/gm-native-maps-chromium-<version>.zip  Chrome Web Store, Edge Add-ons
//
// Both packages enumerate Google's official supported domains. Firefox runs background.scripts and
// wants the gecko block. Chrome runs service_worker and rejects both.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostPermissions, mapsMatches } from './google-domains.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const { version } = manifest;

// Everything a running extension needs, and nothing else.
const SHIP = ['common', 'hours', 'photos', 'popup', 'reviews', 'icons', 'service-worker.js', 'LICENSE', 'PRIVACY.md'];

const DIST = join(ROOT, 'dist');

// dist/ holds build output and nothing else is meant to live there, but
// captures and notes have ended up in it. Only the packages this script
// writes are removed, so anything else survives a build.
mkdirSync(DIST, { recursive: true });
for (const name of readdirSync(DIST)) {
  if (/^gm-native-maps-(firefox|chromium)(-[\d.]+\.zip)?$/.test(name)) {
    rmSync(join(DIST, name), { recursive: true, force: true });
  }
}

function pack(name, edit) {
  const dir = join(DIST, name);
  mkdirSync(dir, { recursive: true });
  for (const item of SHIP) cpSync(join(ROOT, item), join(dir, item), { recursive: true });

  const copy = structuredClone(manifest);
  edit(copy);
  copy.host_permissions = hostPermissions;
  for (const script of copy.content_scripts) script.matches = mapsMatches;
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(copy, null, 2) + '\n');

  const zip = join(DIST, `${name}-${version}.zip`);
  execFileSync('zip', ['-qr', zip, '.', '-x', '.*'], { cwd: dir });
  rmSync(dir, { recursive: true, force: true });
  console.log('built', zip.replace(ROOT, ''));
}

pack('gm-native-maps-firefox', (m) => {
  delete m.background.service_worker;
});

pack('gm-native-maps-chromium', (m) => {
  delete m.background.scripts;
  delete m.browser_specific_settings;
});
