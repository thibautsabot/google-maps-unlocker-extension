// Reviews signed out: five reviews a page and no token for the next. The call
// does take a row offset at args[1][2], so the list is paged in the order the
// user chose instead of being mixed from other sorts.

import { loadPage, suite } from './lib/harness.mjs';
import { frame } from './lib/real.mjs';

const t = suite('more');
const RPC = 'qv9Egd';
const PAGE = 5;

const review = (id, text, stars = 5) => [[id, ['0x0:0x1', null, 1, 1, [null, null, null, null, null, ['Someone']], null, 'a year ago',
  null, null, null, null, null, null, null, null, text], [stars]]];
const reply = (records, end = true) => frame(RPC, [null, null, records, null, null, end ? true : null]);

// A server holding `total` reviews in a fixed order: the page at an offset.
const server = (total, label = 'r') => (offset) => {
  const rows = [];
  for (let i = offset; i < Math.min(offset + PAGE, total); i++) rows.push(review(`${label}${i}`, `review number ${i} with some words`, 1 + (i % 5)));
  return reply(rows);
};

const asking = ({ sort = null, query = null, cursor = '', offset = null } = {}) => new URLSearchParams({
  'f.req': JSON.stringify([[[RPC, JSON.stringify([[['0x1:0x2'], null, query, null, null, [null, null, null, [[1], [3]]]],
    offset === null ? [10, cursor] : [10, cursor, offset], null, null, ['sess'], null, null, [null, 1], null, null, [3, 1], null,
    sort === null ? [1] : [sort]]), null, 'generic']]])
}).toString();

const opened = async (replies, body = asking(), on = true) => {
  const page = loadPage();
  page.win.postMessage({ source: 'gm-native-maps', type: 'gm-settings', features: { reviews: on, photos: false, hours: false } });
  return { page, response: await page.receiveRpc(RPC, replies, body) };
};
const read = async (response) => {
  const m = [...(await response.text()).matchAll(/"wrb\.fr","qv9Egd","((?:[^"\\]|\\.)*)"/g)][0];
  return JSON.parse(JSON.parse(`"${m[1]}"`));
};
const ids = (p) => p[2].map((r) => r[0][0]);
// Calls the script made itself; the page's own call carries no init.
const extra = (page) => page.win.fetchCalls.filter((c) => c.init);
const offsetsOf = (page) => extra(page).map((c) =>
  JSON.parse(JSON.parse(new URLSearchParams(c.init.body).get('f.req'))[0][0][1])[1][2]);
const argsOf = (call) => JSON.parse(JSON.parse(new URLSearchParams(call.init.body).get('f.req'))[0][0][1]);

const s = server(40);

// First load: the page's own five, then the next pages in order.
{
  const { page, response } = await opened([s(0), s(5), s(10), s(15)]);
  const p = await read(response);
  t.check('first: five become twenty, in server order', ids(p).join() === Array.from({ length: 20 }, (_, i) => `r${i}`).join());
  t.check('first: asks for the next three offsets', offsetsOf(page).join() === '5,10,15');
  t.check('first: it offers a next page', typeof p[1] === 'string' && p[5] === null);
}

// Scrolling: the next offsets, no repeats, same order.
{
  const { page, response } = await opened([s(0), s(5), s(10), s(15)]);
  const first = await read(response);
  const second = await read(await page.receiveRpc(RPC, [s(20), s(25), s(30)], asking({ cursor: first[1] })));
  t.check('scroll: continues where the list stopped', ids(second).join() === Array.from({ length: 15 }, (_, i) => `r${20 + i}`).join());
  t.check('scroll: asks for offsets 20, 25 and 30', offsetsOf(page).join() === '20,25,30');
  t.check('scroll: our marker is not sent to Google', argsOf(extra(page)[0])[1][1] === '');
  t.check('scroll: still offers another page', typeof second[1] === 'string');

  const third = await read(await page.receiveRpc(RPC, [s(35), s(40), s(45)], asking({ cursor: second[1] })));
  t.check('end: a short page ends the list', ids(third).join() === 'r35,r36,r37,r38,r39' && third[1] === null && third[5] === true);
  const later = await page.receiveRpc(RPC, [s(0)], asking({ cursor: 'gm-more:55' }));
  t.check('end: a new reply carries the same url, type and flag', later.url.includes('rpcids=qv9Egd') && later.type === 'basic');
}

// A sort the user chose is kept: every page asks for it.
{
  const { page } = await opened([s(0), s(5), s(10), s(15)], asking({ sort: 4 }));
  t.check('sort: every extra page keeps the chosen sort', extra(page).length === 3 && extra(page).every((c) => argsOf(c)[12][0] === 4));
}

// The list changing (another sort or place) never reuses an old marker.
{
  const { page, response } = await opened([s(0), s(5), s(10), s(15)], asking({ sort: 4 }));
  const first = await read(response);
  const other = await read(await page.receiveRpc(RPC, [s(20)], asking({ sort: 2, cursor: first[1] })));
  t.check('stale marker: no request reaches the server', extra(page).length === 0);
  t.check('stale marker: the list ends cleanly', ids(other).length === 0 && other[1] === null);
}

// A marker with no list behind it (page reloaded) also ends the list.
{
  const page = loadPage();
  page.win.postMessage({ source: 'gm-native-maps', type: 'gm-settings', features: { reviews: true, photos: false, hours: false } });
  const r = await page.receiveRpc(RPC, [s(0)], asking({ cursor: 'gm-more:20' }));
  await r.text();
  t.check('no state: the marker is not sent to the server', extra(page).length === 0);
}

// Untouched cases.
{
  const { page, response } = await opened([s(0)], asking(), false);
  t.check('off: reply passes through', ids(await read(response)).length === 5 && extra(page).length === 0);
}
{
  const own = reply(Array.from({ length: 5 }, (_, i) => review(`x${i}`, 'words here and there')), false);
  const signedIn = frame(RPC, [null, 'T'.repeat(60), s0(), null, null, null]);
  function s0() { return Array.from({ length: 10 }, (_, i) => review(`y${i}`, 'words here and there')); }
  const { page, response } = await opened([signedIn]);
  t.check('signed in: a reply with its own token is untouched', (await read(response))[1] === 'T'.repeat(60) && extra(page).length === 0);
  void own;
}
{
  const small = server(3);
  const { response } = await opened([small(0), small(5), small(10), small(15)]);
  const p = await read(response);
  t.check('short list: three reviews, no next page', ids(p).length === 3 && p[1] === null);
}
{
  const { response } = await opened([s(0), s(5), s(10), s(15)], asking({ query: 'words', offset: null }));
  const p = await read(response);
  t.check('search: paged the same way', ids(p).length === 20);
}

// A failing extra request must not break the page's own reply.
{
  const own = s(0);
  const page = loadPage();
  page.win.postMessage({ source: 'gm-native-maps', type: 'gm-settings', features: { reviews: true, photos: false, hours: false } });
  const orig = page.win.fetch;
  let calls = 0;
  page.win.fetch = async (...a) => { if (++calls > 1) throw new Error('offline'); return orig(...a); };
  const response = await page.receiveRpc(RPC, [own], asking());
  t.check('failure: the original reply is still delivered', (await response.text()) === own);
}

// Accents and emoji: a chunk is counted in characters, not bytes, and the
// trailers after ours are kept as they were.
{
  const googleJson = (v) => JSON.stringify(v).replace(/[<>&=\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const withTrailers = (payload) => {
    const body = googleJson([['wrb.fr', RPC, googleJson(payload), null, null, null, 'generic']]);
    const trailers = ['[["di",37],["af.httprm",37,"8086949976010301048",18]]', '[["e",4,null,null,140]]'];
    return `)]}'\n\n${[body, ...trailers].map((json) => `${json.length + 2}\n${json}`).join('\n')}`;
  };
  const accented = (label) => Array.from({ length: 5 }, (_, i) => review(`${label}${i}`, `Très bon accueil à Paris \u{1F44D} numéro ${i}`));
  const { response } = await opened([withTrailers([null, null, accented('a'), null, null, true]),
    withTrailers([null, null, accented('b'), null, null, true]), withTrailers([null, null, [], null, null, true]),
    withTrailers([null, null, [], null, null, true])]);
  const text = await response.text();
  const body = text.replace(/^\)\]\}'\n+/, '');
  const chunks = [];
  let at = 0;
  while (at < body.length) {
    const digits = body.slice(at).match(/^\d+/)?.[0];
    if (!digits) break;
    const declared = Number(digits);
    const segment = body.slice(at + digits.length, at + digits.length + declared);
    chunks.push({ declared, actual: segment.length, json: segment.replace(/^\n/, '').replace(/\n$/, '') });
    at += digits.length + declared;
    if (body[at] === '\n') at++;
  }
  t.check('framing: three chunks, each as long as it says in characters',
    chunks.length === 3 && chunks.every((c) => c.declared === c.json.length + 2) && chunks.slice(0, -1).every((c) => c.declared === c.actual));
  t.check('framing: the trailers survive unchanged', chunks[1].json.startsWith('[["di",37]') && chunks[2].json === '[["e",4,null,null,140]]');
  t.check('framing: the accents are in the merged list', text.includes('Très bon accueil') && !text.endsWith('\n'));
}

// Every extra request asks for the largest page size the server accepts.
{
  const { page } = await opened([s(0), s(5), s(10), s(15)]);
  t.check('size: extra requests ask for 20', extra(page).length === 3 && extra(page).every((c) => argsOf(c)[1][0] === 20));
}

// The priority order: rows, then chips, then words. Default has no fallback.
{
  const placeReply = (chips) => {
    const body = [];
    body[6] = [];
    body[6][10] = '0x1:0x2';
    body[6][153] = [chips.map(([id, word, count]) => [[id], word, null, [null, null, null, null, count]])];
    return `)]}'\n${JSON.stringify(body)}`;
  };
  // A server for a rating sort that ends at 10 rows, a chip that has 7 of its own,
  // and a word search that has 6.
  const world = (args) => {
    const offset = args[1][2] ?? 0;
    const topic = args[0][4]?.[0]?.[0];
    const word = args[0][2];
    const total = topic === 'T_A' ? 7 : word ? 6 : 10;
    const label = topic ? `t${topic}` : word ? `w${word}` : 'r';
    const rows = [];
    for (let i = offset; i < Math.min(offset + PAGE, total); i++) rows.push(review(`${label}${i}`, `review with plenty of ordinary words ${label}${i}`, 1));
    return reply(rows);
  };
  const live = async (sort, chips) => {
    const page = loadPage();
    page.win.postMessage({ source: 'gm-native-maps', type: 'gm-settings', features: { reviews: true, photos: false, hours: false } });
    if (chips) {
      page.win.fetchReplyText = placeReply(chips);
      await page.win.fetch('https://www.google.com/maps/preview/place?pb=x');
    }
    // Every request the script makes is answered from the world above, by
    // its own arguments, whatever order the requests are made in.
    const asked = [];
    page.win.fetchAnswer = (init) => {
      const args = JSON.parse(JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][1]);
      asked.push(args);
      return world(args);
    };
    const firstArgs = JSON.parse(JSON.parse(new URLSearchParams(asking({ sort })).get('f.req'))[0][0][1]);
    let p = await read(await page.receiveRpc(RPC, [world(firstArgs)], asking({ sort })));
    const rows = [...ids(p)];
    for (let i = 0; i < 30 && typeof p[1] === 'string'; i++) {
      p = await read(await page.receiveRpc(RPC, [reply([])], asking({ sort, cursor: p[1] })));
      rows.push(...ids(p));
    }
    return { rows, asked };
  };

  const rating = await live(4, [['T_A', 'macarons', 30], ['T_B', 'cakes', 5]]);
  t.check('priority: the list\'s own rows come first', rating.rows.slice(0, 10).join() === Array.from({ length: 10 }, (_, i) => `r${i}`).join());
  t.check('priority: then the most-mentioned chip', rating.rows.slice(10, 17).join() === Array.from({ length: 7 }, (_, i) => `tT_A${i}`).join());
  t.check('priority: chips keep the chosen sort', rating.asked.filter((a) => a[0][4]).every((a) => a[12][0] === 4));
  t.check('priority: then words from the reviews shown', rating.rows.some((r) => r.startsWith('w')));
  t.check('priority: nothing is shown twice', new Set(rating.rows).size === rating.rows.length);
  const order = rating.asked.map((a) => (a[0][4] ? 'chip' : a[0][2] ? 'word' : 'rows'));
  t.check('priority: rows, then chips, then words, never back',
    order.join().replace(/(\w+)(,\1)+/g, '$1') === 'rows,chip,word');

  const plain = await live(1, [['T_A', 'macarons', 30]]);
  t.check('default: no chip or word is ever asked for', plain.asked.every((a) => !a[0][4] && !a[0][2]));
  t.check('default: the list ends with its own rows', plain.rows.length === 10);

  const noChips = await live(4, null);
  t.check('no chips for the place: words follow the rows', noChips.rows.length > 10 && noChips.asked.every((a) => !a[0][4]));
}

process.exit(t.done());
