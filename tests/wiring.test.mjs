// The checks that catch a split or a rename going wrong. Each of these
// stood for a real failure: files parse alone but clash in one scope, a
// message type relayed but never handled, a field dropped in the relay.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, read, manifest, BACKGROUND_FILES, PAGE_FILES, suite } from './lib/harness.mjs';

const t = suite('wiring');
const m = manifest();

// --- every file the manifest names exists ----------------------------------
{
  const named = [
    ...BACKGROUND_FILES(),
    ...m.content_scripts.flatMap((s) => s.js),
    m.background.service_worker,
    m.action?.default_popup
  ].filter(Boolean);

  const missing = named.filter((f) => !existsSync(join(ROOT, f)));
  t.check(`every file the manifest names exists (${named.length} named)`, missing.length === 0);
  if (missing.length) console.log('        missing:', missing.join(', '));
}

// --- the service worker loads the same list, in the same order -------------
{
  const worker = read(m.background.service_worker);
  const imported = [...worker.matchAll(/'([\w./-]+\.js)'/g)].map((x) => x[1]);
  const expected = ['common/compat.js', ...BACKGROUND_FILES()];

  t.check('Chrome loads the same background files as Firefox, in order',
    JSON.stringify(imported) === JSON.stringify(expected));
  if (JSON.stringify(imported) !== JSON.stringify(expected)) {
    console.log('        worker:  ', imported.join(', '));
    console.log('        manifest:', expected.join(', '));
  }
}

// --- one shared scope, so nothing may be declared twice --------------------
for (const [label, files] of [['background', BACKGROUND_FILES()], ['page', PAGE_FILES()]]) {
  const combined = files.map(read).join('\n');
  const names = [...combined.matchAll(/^\s*(?:const|let|var|async function|function)\s+(\w+)/gm)]
    .map((x) => x[1]);

  // Page scripts are each wrapped in their own IIFE, so only their top
  // level would clash; the background files share one scope outright.
  const top = label === 'background'
    ? [...combined.matchAll(/^(?:const|let|var|async function|function)\s+(\w+)/gm)].map((x) => x[1])
    : [];

  const dupes = [...new Set(top.filter((n) => top.filter((x) => x === n).length > 1))];
  t.check(`${label}: nothing is declared twice in the shared scope`, dupes.length === 0);
  if (dupes.length) console.log('        declared twice:', dupes.join(', '));

  let parses = true;
  try { new Function(combined); } catch (error) {
    parses = false;
    console.log(`        ${label} fails when concatenated:`, error.message);
  }
  t.check(`${label}: the files parse together as the browser loads them`, parses);
  void names;
}

// --- the extension has no way to touch cookies ------------------------------
// The photo fill runs in the page and sends nothing out. Borrowing a session
// from a private window once needed the cookies permission, a consent dialog
// and private-window access, and failed on every session tried.
{
  const everything = [
    ...BACKGROUND_FILES(),
    ...m.content_scripts.flatMap((c) => c.js),
    'popup/popup.js'
  ].map(read).join('\n');

  t.check('no cookies permission is requested', !m.permissions.includes('cookies'));
  t.check('no private-window access is requested', m.incognito === undefined);
  t.check('no code reads or writes cookies', !/browser\.cookies|chrome\.cookies/.test(everything));
  t.check('no code opens a private window', !/windows\.create|incognito/i.test(everything));
  t.check('no consent dialog is left in the popup', !read('popup/popup.html').includes('cookie-consent'));
  t.check('the only permission is storage', m.permissions.length === 1 && m.permissions[0] === 'storage');

  const page = PAGE_FILES().map(read).join('\n');
  const sent = [...page.matchAll(/(?:tell|ask)\(\s*(?:\{\s*type:\s*)?'([\w-]+)'/g)].map((x) => x[1]);
  t.check('the page scripts send nothing to the background', sent.length === 0);
  if (sent.length) console.log('        sends:', [...new Set(sent)].join(', '));
}

// --- the background only clears the reload prompt ---------------------------
{
  const background = BACKGROUND_FILES().map(read).join('\n');
  const handled = [...background.matchAll(/handles\([^,]+, '([\w-]+)'/g)].map((x) => x[1]);
  t.check('the background answers the hello and nothing else', handled.length === 1 && handled[0] === 'gm-hello');
}

// --- the background must not touch the DOM ---------------------------------
{
  const background = BACKGROUND_FILES().map(read).join('\n');
  const dom = [...background.matchAll(/\b(document|window|localStorage|sessionStorage)\./g)]
    .map((x) => x[1]);

  t.check('the background touches no DOM, so Chrome can run it as a service worker',
    dom.length === 0);
  if (dom.length) console.log('        uses:', [...new Set(dom)].join(', '));
}

// --- localized Google Maps hosts -----------------------------------------------
{
  const helper = read('common/maps-url.js');
  const checker = new Function(`${helper}; return isGoogleMapsUrl;`)();
  const matches = m.content_scripts[0].matches;
  const hosts = matches.map((pat) => pat.match(/^https:\/\/\*\.([^/]+)\/maps\/\*$/)?.[1]);

  t.check('popup Maps URL helper accepts localized Maps hosts',
    checker('https://www.google.fr/maps/place/X')
      && checker('https://maps.google.co.uk/maps/place/X')
      && checker('https://www.google.co.jp/maps'));
  t.check('popup Maps URL helper rejects non-Maps and lookalike hosts',
    !checker('https://www.google.fr/search?q=maps')
      && !checker('https://google.fr.evil.example/maps')
      && !checker('https://maps.google.com.evil.example/maps'));
  t.check('localized hosts include google.fr, google.de and multi-label google.co.uk',
    hosts.includes('google.fr') && hosts.includes('google.de') && hosts.includes('google.co.uk'));
  t.check('every Maps match has a corresponding Google host permission',
    hosts.length === new Set(hosts).size
      && hosts.every((host) => m.host_permissions.includes(`*://*.${host}/*`)));
}

// --- a feature is only real if the catalogue, the folders and the manifest
// --- all agree about it -----------------------------------------------------
{
  const catalogue = read('common/features.js');
  const listed = [...catalogue.matchAll(/id: '(\w+)'/g)].map((x) => x[1]);
  const scripts = [...BACKGROUND_FILES(), ...m.content_scripts.flatMap((s) => s.js)];

  const withoutScripts = listed.filter((id) => !scripts.some((f) => f.startsWith(`${id}/`)));
  t.check(`every feature in the catalogue has scripts (${listed.join(', ')})`,
    withoutScripts.length === 0);
  if (withoutScripts.length) console.log('        no folder:', withoutScripts.join(', '));

  const folders = [...new Set(scripts.map((f) => f.split('/')[0]))]
    .filter((d) => d !== 'common' && d !== 'popup');
  const unlisted = folders.filter((d) => !listed.includes(d));
  t.check('every feature folder is in the catalogue', unlisted.length === 0);
  if (unlisted.length) console.log('        not in the catalogue:', unlisted.join(', '));
}

// --- every message handled belongs to a registered feature -----------------
{
  const background = BACKGROUND_FILES().map(read).join('\n');
  const registered = [...background.matchAll(/handles\((null|'(\w+)')/g)].map((x) => x[2] ?? null);
  const catalogue = read('common/features.js');
  const known = [...catalogue.matchAll(/id: '(\w+)'/g)].map((x) => x[1]);

  const strangers = [...new Set(registered.filter((f) => f && !known.includes(f)))];
  t.check('handlers are registered against features that exist', strangers.length === 0);
  if (strangers.length) console.log('        unknown feature:', strangers.join(', '));

  t.check('the dispatcher names no feature of its own',
    !/'(photos|hours)'/.test(read('common/dispatch.js')));
}

// --- package names use version placeholders --------------------------------
{
  const readme = read('README.md');
  t.check('the install guide names the Firefox package',
    readme.includes('dist/gm-native-maps-firefox-<version>.zip'));
  t.check('the install guide names the Chromium package',
    readme.includes('dist/gm-native-maps-chromium-<version>.zip'));
}

process.exit(t.done());
