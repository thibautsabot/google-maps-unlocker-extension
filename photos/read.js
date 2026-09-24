// Reads Google's payloads. No state, no messages, no decisions about the cap.
// Given a reply or a blob of page text, it answers:
//
//   how many photos are in it, and the total beside that list
//   how many the request asked for
//   whether this reply is the single-photo viewer
//   where the page size sits, once a second page shows the field moving
//
// The arguments are a protobuf flattened into nested arrays, so a field is
// a position, and positions are Google's to move.

(() => {
  'use strict';

  // Place photos come from googleusercontent. Street View panoramas and
  // other entry types are served from different Google image hosts.
  const PHOTO_HOSTS = /googleusercontent\.com|ggpht\.com|streetviewpixels|gstatic\.com\/streetview/;

  // A count Google would put beside a photo list: a safe integer, never negative.
  const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

  function hasPhotoUrl(node, depth = 0, max = 7) {
    if (depth > max || node == null) return false;
    if (typeof node === 'string') return PHOTO_HOSTS.test(node);
    if (typeof node !== 'object') return false;

    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      if (hasPhotoUrl(child, depth + 1, max)) return true;
    }
    return false;
  }

  // One photo: an array that holds its own image within two levels. A list
  // of photos fails this, because the image is further down.
  const isPhotoEntry = (node) => Array.isArray(node) && hasPhotoUrl(node, 0, 2);

  // How many photos this reply holds, and the place's total beside that list.
  // The list is the array with the most photo entries; its length is the page
  // size, which can be larger than the entries that carry a URL
  function describe(payload) {
    let photos = -1;
    let count = 0;

    for (let i = 0; i < payload.length; i++) {
      const value = payload[i];
      if (!Array.isArray(value) || !value.length) continue;

      const withUrl = value.filter(isPhotoEntry).length;
      if (withUrl > count) { count = withUrl; photos = i; }
    }
    if (photos < 0) return null;

    const size = payload[photos].length;
    const total = payload.find((v) => isCount(v) && v >= size);
    return { size, total: total ?? null };
  }

  // One photo alongside a much larger total is the single-photo viewer, not
  // a gallery that came back nearly empty. The category tabs above a real
  // grid are a list of lists, and that shape used to be mistaken for this.
  function single(payload) {
    const list = payload.find((v) => Array.isArray(v) && v.length === 1 && isPhotoEntry(v[0]));
    if (!list) return false;
    return payload.some((v) => isCount(v) && v > 1);
  }

  // Maps puts several unrelated calls in one POST. Each call is
  // [rpc name, arguments as a JSON string, ...]. Returns { rpc, args } for
  // every call that parses, and drops the rest.
  //
  // args is a nested array with no field names, so a slot like [4][2][1]
  // only means "page size" inside the call that served the gallery. The same
  // slot in another call is a different field, which is why the calls are
  // split before anything is read.
  function envelopes(body) {
    let outer = null;
    try { outer = JSON.parse(new URLSearchParams(body).get('f.req') ?? ''); } catch (_) { return []; }
    if (!Array.isArray(outer) || !Array.isArray(outer[0])) return [];

    const found = [];
    for (const envelope of outer[0]) {
      if (!Array.isArray(envelope)) continue;

      const [rpc, argsJson] = envelope;
      if (typeof rpc !== 'string' || typeof argsJson !== 'string') continue;

      let args = null;
      try { args = JSON.parse(argsJson); } catch (_) { continue; }
      if (Array.isArray(args)) found.push({ rpc, args });
    }
    return found;
  }

  // Where the page size and the continuation token sit, until a session
  // that pages teaches a new place. [4][2][1] is the size; the slot beside
  // it is the token.
  const DEFAULT_LAYOUT = { size: [4, 2, 1], token: [4, 2, 2] };

  // The value at a path of indexes, or undefined when any step is missing.
  const at = (node, path) => path.reduce((n, i) => (Array.isArray(n) ? n[i] : undefined), node);

  // The page size at the layout's position, or null when that position is
  // not a page size. The token slot has to exist, empty or holding a string.
  // A slot that is not there at all means the size slot is in some shorter
  // array — shift the message by one and [4][2][1] lands on a thumbnail's 100.
  const pageSizeIn = (args, layout) => {
    const token = at(args, layout.token);
    if (token !== null && typeof token !== 'string') return null;

    const size = at(args, layout.size);
    return isCount(size) && size > 0 ? size : null;
  };

  // How many photos the request asked for. rpc limits the search to the call
  // that served the gallery. served rejects a candidate smaller than the page
  // that already arrived, which a real page size cannot be. Null when the
  // field is not where the layout says — unknown, not a guess.
  function askedFor(body, { rpc = null, served = null, layoutFor = () => DEFAULT_LAYOUT } = {}) {
    for (const envelope of envelopes(body)) {
      if (rpc && envelope.rpc !== rpc) continue;

      const size = pageSizeIn(envelope.args, layoutFor(envelope.rpc));
      if (size === null) continue;
      if (Number.isInteger(served) && size < served) continue;

      return size;
    }
    return null;
  }

  // Every string in a nested array, with the path of indexes that reached it.
  // Stops at depth 12: these payloads nest, and a cycle is not the worry so
  // much as walking a payload that is mostly noise.
  function strings(node, visit, path = [], depth = 0) {
    if (depth > 12) return;
    if (typeof node === 'string') { visit(node, path); return; }
    if (!Array.isArray(node)) return;
    node.forEach((child, i) => strings(child, visit, [...path, i], depth + 1));
  }

  // Where the page size and the continuation token sit, learned from one
  // round trip. Returns null unless exactly one place fits, so two plausible
  // fields teach nothing rather than whichever was found first.
  //
  // The token is the string in the next request that came from the previous
  // reply and was not in the previous request. The page size is the integer
  // beside it that held the same value in both requests, and no less than
  // the first page served.
  function learnLayout(before, reply, served, after) {
    if (!Array.isArray(before) || !Array.isArray(after) || !(served > 0)) return null;

    const sent = new Set();
    strings(before, (s) => sent.add(s));
    const handed = new Set();
    strings(reply, (s) => { if (s && !sent.has(s)) handed.add(s); });

    const found = [];
    strings(after, (s, path) => {
      if (!handed.has(s)) return;

      const box = path.slice(0, -1);
      const now = at(after, box);
      const then = at(before, box);
      if (!Array.isArray(now) || !Array.isArray(then)) return;

      const sizes = now.map((_, i) => i).filter((i) => isCount(now[i])
        && now[i] === then[i] && now[i] >= served);
      if (sizes.length === 1) found.push({ size: [...box, sizes[0]], token: path });
    });

    return found.length === 1 ? found[0] : null;
  }

  // Distinct photo URLs in a blob of page text. Inside a script the URLs are
  // escaped — \/ for slashes, \u003d for "=" — so the text is unescaped before
  // matching. The size suffix is dropped so one photo offered at several
  // sizes is not counted repeatedly.
  const photoUrls = (text) => {
    const readable = String(text)
      .replace(/\\u003d/gi, '=')
      .replace(/\\u0026/gi, '&')
      .replace(/\\\//g, '/');

    const found = readable.match(
      /https:\/\/[^"\\\s]*?(?:googleusercontent\.com|ggpht\.com|streetviewpixels[^"/\\\s]*)\/[^"\\\s]+/g) || [];
    return new Set(found.map((url) => url.split('=')[0]));
  };

  window.__GMX = {
    describe, askedFor, single, photoUrls, envelopes, learnLayout, DEFAULT_LAYOUT
  };
})();
