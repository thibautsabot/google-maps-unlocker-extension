// Settings reads can resolve out of order at document_start. Only the newest
// snapshot should reach MAIN-world feature scripts.
import { read, suite, wait } from './lib/harness.mjs';

const t = suite('bridge');
const reads = [], messages = [], listeners = {};
const browser = {
  storage: {
    local: { get: () => new Promise((resolve) => reads.push(resolve)) },
    onChanged: { addListener: (fn) => { listeners.changed = fn; } }
  },
  runtime: { sendMessage: async (message) => { messages.push(message); } }
};
const published = [];
const win = { postMessage: (message) => published.push(message) };
new Function('browser', 'window', 'location', 'console', 'setTimeout',
  `${read('common/features.js')}\n${read('common/bridge.js')}`)(
  browser, win, { origin: 'https://www.google.com' }, console, setTimeout);
listeners.changed({ features: {} }, 'local');
reads[1]({ features: { photos: true } });
await wait(0);
reads[0]({ features: { photos: false } });
await wait(0);
t.check('only latest settings read is published', published.length === 1 && published[0].features.photos === true);
t.check('missing switches default off', published[0].features.hours === false && published[0].features.reviews === false);
t.check('page-load message carries no unused URL', messages.length === 1 && messages[0].type === 'gm-hello' && !('url' in messages[0]));
listeners.changed({ somethingElse: {} }, 'local');
listeners.changed({ features: {} }, 'sync');
t.check('irrelevant storage changes cause no read', reads.length === 2);
process.exit(t.done());
