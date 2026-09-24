// Runs every test file. No dependencies: node tests/run.mjs
//
// These exist because the extension cannot be tested by looking at it. Its
// behaviour is a conversation between a page, a relay and a background
// script, spread over reloads, and most of the bugs it has had were in the
// conversation rather than in any one part.

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
          .filter((l) => !l.startsWith('[GM-ROLL]') && !l.startsWith('[GM-GALLERY]'))
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
