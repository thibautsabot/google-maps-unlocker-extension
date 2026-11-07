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

  // One gallery reply made from several. The first page's reply is kept as it
  // is, and the photo lists of the later pages are appended to its list, so
  // everything else in it (categories, session, flags) is untouched. The
  // announced total and the continuation token are left alone as well: Maps
  // reads the list it is given and decides about paging from those.
  //
  // payloads are the parsed gallery payloads, first page first. Photos already
  // present are skipped, by id, so a page that repeats another adds nothing.
  // Returns { payload, added } or null when the first page has no list.
  function mergePages(payloads) {
    const [first, ...later] = payloads;
    const found = first ? describe(first) : null;
    if (!found) return null;

    const listIndex = first.findIndex((value) => Array.isArray(value) && value.length === found.size
      && value.some(isPhotoEntry));
    if (listIndex < 0) return null;

    const idOf = (entry) => (Array.isArray(entry) && typeof entry[0] === 'string' ? entry[0] : null);
    const merged = first.slice();
    const list = first[listIndex].slice();
    const seen = new Set(list.map(idOf).filter(Boolean));
    let added = 0;

    for (const payload of later) {
      const more = payload ? describe(payload) : null;
      if (!more) continue;

      const source = payload.find((value) => Array.isArray(value) && value.length === more.size
        && value.some(isPhotoEntry));
      for (const entry of source || []) {
        const id = idOf(entry);
        if (!isPhotoEntry(entry) || !id || seen.has(id)) continue;
        seen.add(id);
        list.push(entry);
        added++;
      }
    }

    merged[listIndex] = list;
    return { payload: merged, added };
  }

  // JSON the way Google writes it. Inside the inner string of a reply, the
  // server writes "=" as \u003d where JSON.stringify writes it plain, and
  // leaves "/" alone. Measured on a real gallery reply: 10566 characters from
  // the server, 10495 from JSON.stringify, a gap of 71, and 12 "=" signs in
  // it at six extra characters each is 72. Escaping "/" as well, as a first
  // attempt did, made the rebuild 361 characters too long. "&", "<" and ">"
  // are escaped the same way as "=" in Google's other payloads and do not
  // occur in a gallery reply, so they are escaped too. A reply that differs
  // from the server's by even one character is not the same reply.
  function googleJson(value) {
    return JSON.stringify(value).replace(/[<>&=\u2028\u2029]/g, (char) => {
      return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
    });
  }

  // A payload put back into the framing batchexecute replies use. When the
  // server's own reply is given, it is edited in place: the gallery chunk is
  // rewritten and every other chunk (the "di", "af.httprm" and "e" trailers
  // that come after it) is kept, with the length line recounted. Maps reads
  // those trailers, so a reply without them is not the same reply.
  // How the server frames a reply, measured on real gallery replies: each
  // chunk is "<n>\n<json>\n", and n counts the bytes from the newline that
  // ends the length line through the newline after the json, so n is the
  // json's UTF-8 length plus two. Seen as 1872 for a 1870 character body,
  // 54 for a 52 character trailer and 25 for a 23 character one. The server
  // also leaves no newline after its last chunk, so the end of the original
  // is kept as it was.
  const byteLength = (text) => new TextEncoder().encode(text).length;
  const chunkLength = (json) => byteLength(json) + 2;

  function frameReply(rpc, payload, original = null) {
    const inner = googleJson(payload);
    const chunkBody = googleJson([['wrb.fr', rpc, inner, null, null, null, 'generic']]);
    const plain = () => `)]}'\n\n${chunkLength(chunkBody)}\n${chunkBody}\n`;

    if (typeof original !== 'string') return plain();

    const prefix = original.match(/^\)\]\}'\n+/)?.[0];
    if (!prefix) return plain();

    const bytes = new TextEncoder().encode(original.slice(prefix.length));
    const decoder = new TextDecoder();
    const out = [];
    let replaced = false;
    let at = 0;

    while (at < bytes.length) {
      let digits = at;
      while (digits < bytes.length && bytes[digits] >= 48 && bytes[digits] <= 57) digits++;
      if (digits === at) { out.push(decoder.decode(bytes.slice(at))); break; }

      const declared = Number(decoder.decode(bytes.slice(at, digits)));
      // n runs from the newline after the digits, so the json sits between
      // that newline and the one that ends the chunk.
      const segment = bytes.slice(digits, digits + declared);
      let json = decoder.decode(segment);
      if (json.startsWith('\n')) json = json.slice(1);
      if (json.endsWith('\n')) json = json.slice(0, -1);
      at = digits + declared;

      if (!replaced && json.includes(`"wrb.fr","${rpc}"`)) {
        out.push(`${chunkLength(chunkBody)}\n${chunkBody}`);
        replaced = true;
      } else {
        out.push(`${declared}\n${json}`);
      }
    }

    if (!replaced) return plain();
    return `${prefix}${out.join('\n')}${original.endsWith('\n') ? '\n' : ''}`;
  }

  window.__GMX = {
    describe, askedFor, single, photoUrls, envelopes, learnLayout, DEFAULT_LAYOUT, mergePages, frameReply,
    googleJson, at
  };
})();
