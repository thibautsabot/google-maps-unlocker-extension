// Builds the store packages into dist/. No dependencies: node tools/build.mjs
//
//   dist/gm-native-maps-firefox-<version>.zip   Firefox Add-ons (AMO)
//   dist/gm-native-maps-chromium-<version>.zip  Chrome Web Store, Edge Add-ons
//
// The two differ only in the manifest. Firefox runs background.scripts and
// wants the gecko block. Chrome runs service_worker and rejects both.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const { version } = manifest;

// Everything a running extension needs, and nothing else.
const SHIP = ['common', 'hours', 'options', 'photos', 'popup', 'reviews', 'icons', 'service-worker.js', 'LICENSE', 'PRIVACY.md'];

const DIST = join(ROOT, 'dist');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

function pack(name, edit) {
  const dir = join(DIST, name);
  mkdirSync(dir, { recursive: true });
  for (const item of SHIP) cpSync(join(ROOT, item), join(dir, item), { recursive: true });

  const copy = structuredClone(manifest);
  edit(copy);
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
