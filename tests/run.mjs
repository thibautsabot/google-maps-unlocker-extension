// Runs every test file. No dependencies: node tests/run.mjs
//
// Covers payload parsing, size-10 pagination, response framing, bundle
// discovery, static wiring and background reload-prompt record cleanup.

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE).filter((f) => f.endsWith('.test.mjs')).sort();

const verbose = process.argv.includes('--verbose');
let failures = 0;

for (const file of files) {
  console.log(`\n${file}`);

  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, file)], {
      stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'inherit']
    });

    // The extension's own logging is noise here unless something failed.
    if (!verbose) {
      let held = '';
      child.stdout.on('data', (chunk) => { held += chunk; });
      child.on('close', () => {
        process.stdout.write(held.split('\n')
          .filter((l) => !/^\[GM-(?:GALLERY|GALLERY-UI|REVIEWS|HOURS|NATIVE|RELAY)\]/.test(l))
          .join('\n'));
      });
    }

    child.on('close', resolve);
  });

  failures += code;
}

console.log(failures
  ? `\n${failures} check(s) failed. Run with --verbose to see the extension's own logging.`
  : '\neverything passes');

process.exit(failures ? 1 : 0);
