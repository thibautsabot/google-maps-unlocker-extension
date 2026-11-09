(() => {
  'use strict';

  // Signed out, the review call (qv9Egd) answers one page of 5 reviews and no
  // token for the next. Google does not stop there for signed-in sessions, so
  // this gets as close to that as the server allows. Priority, in order:
  //
  //  1. The list itself. The call takes a row offset (args[1][2]), so the next
  //     rows of the same list (same sort, search or topic) are asked for as
  //     the user scrolls: same order a signed-in session shows. Default and
  //     newest reach the whole list; a search or a topic chip reaches all of
  //     its matches.
  //  2. A bigger page. The depth of the rating sorts grows with the page size
  //     asked for (66 rows at 5, 113 at 10, 163 at 20), and the server refuses
  //     21 and up, so 20 is asked for. The default sort is the same at any size.
  //  3. Only when a rating sort (highest, lowest) has run out: Google's own
  //     topic chips ("macarons", "chocolates"), read from the place reply,
  //     most-mentioned first, each asked for under the same sort. They reach
  //     reviews past the rating sort's end.
  //  4. Last, words taken from the reviews already shown, searched under the
  //     same sort, for whatever the chips did not reach.
  //
  // Each step only starts when the one before has nothing left, and reviews
  // already shown are never shown twice. Nothing is faked: no cookie, no
  // token, no sign-in. Each extra request is the page's own request with the
  // paging, size, topic or search slot changed.

  const RPC = 'qv9Egd';
  const LOG = '[GM-MORE]';
  const PAGE = 5;       // what the server answers signed out, whatever is asked
  const AHEAD = 3;      // pages fetched together: the first load and each scroll
  const SIZE = 20;      // the largest page size the server accepts
  const BUDGET = 15;    // requests at most for one scroll
  const MAX_WORDS = 30;
  const TOKEN = 'gm-more:';
  const OFFSET_SLOT = [1, 2];
  const SIZE_SLOT = [1, 0];
  const QUERY_SLOT = [0, 2];
  const TOPIC_SLOT = [0, 4];
  const SORT_SLOT = [12, 0];
  // The two sorts that stop early. Measured on one place: highest and lowest
  // stop at 66 to 163 rows of 949, where default and newest reach all 949.
  const RATING_SORTS = [3, 4];
  const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'was', 'have', 'très',
    'les', 'des', 'une', 'est', 'pas', 'que', 'qui', 'dans', 'pour', 'mais', 'avec', 'sur', 'but', 'not']);

  let reviewsOn = false;
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== 'gm-native-maps' || data.type !== 'gm-settings') return;
    reviewsOn = !!data.features?.reviews;
  });

  const at = (node, path) => path.reduce((n, i) => (Array.isArray(n) ? n[i] : undefined), node);
  function put(node, path, value) {
    let n = node;
    for (let i = 0; i < path.length - 1; i++) {
      if (!Array.isArray(n[path[i]])) n[path[i]] = [];
      n = n[path[i]];
    }
    n[path.at(-1)] = value;
  }

  const recordsOf = (payload) => (Array.isArray(payload?.[2]) ? payload[2] : []);
  const idOf = (record) => (typeof record?.[0]?.[0] === 'string' ? record[0][0] : null);
  const endOf = (payload) => payload?.[5] === true || !payload?.[2]?.length;

  function eachCall(text, visit) {
    for (const match of String(text).matchAll(/"wrb\.fr","([A-Za-z0-9]+)","((?:[^"\\]|\\.)*)"/g)) {
      let payload = null;
      try { payload = JSON.parse(JSON.parse(`"${match[2]}"`)); } catch (_) { continue; }
      if (Array.isArray(payload) && visit(match[1], payload)) return;
    }
  }

  function requestOf(body) {
    let outer = null;
    try { outer = JSON.parse(new URLSearchParams(body).get('f.req') ?? ''); } catch (_) { return null; }
    const call = outer?.[0]?.find((entry) => entry?.[0] === RPC);
    if (!call || typeof call[1] !== 'string') return null;
    let args = null;
    try { args = JSON.parse(call[1]); } catch (_) { return null; }
    return Array.isArray(args) ? { call, args } : null;
  }

  const nativeFetch = window.fetch;

  // The page's own request with the cursor emptied, the largest page size the
  // server takes, and whatever slots the stage changes.
  async function ask(url, request, change) {
    const args = JSON.parse(JSON.stringify(request.args));
    put(args, [1, 1], '');
    put(args, SIZE_SLOT, SIZE);
    change(args);
    const call = request.call.slice();
    call[1] = JSON.stringify(args);
    const params = new URLSearchParams();
    params.set('f.req', JSON.stringify([[call]]));
    const response = await nativeFetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: params.toString()
    });
    if (response.status !== 200) return null;
    let payload = null;
    eachCall(await response.text(), (rpc, value) => {
      if (rpc !== RPC) return false;
      payload = value;
      return true;
    });
    return payload;
  }

  // Google's JSON escapes these five characters and nothing else.
  const googleJson = (value) => JSON.stringify(value)
    .replace(/[<>&=\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

  // Each chunk is "<n>\n<json>\n" and n is the json's length in UTF-16
  // characters plus two, measured on real replies with accents and emoji
  // (a byte count overshoots, and Maps then misreads the chunk). The last
  // chunk has no newline after it. Every chunk but ours is kept as it came.
  function frame(payload, original = null) {
    const chunk = googleJson([['wrb.fr', RPC, googleJson(payload), null, null, null, 'generic']]);
    const mine = () => `${chunk.length + 2}\n${chunk}`;
    const prefix = typeof original === 'string' ? original.match(/^\)\]\}'\n+/)?.[0] : null;
    if (!prefix) return `)]}'\n\n${mine()}\n`;

    const out = [];
    let replaced = false;
    let at = prefix.length;
    while (at < original.length) {
      const digits = original.slice(at).match(/^\d+/)?.[0];
      if (!digits) { out.push(original.slice(at)); break; }
      const declared = Number(digits);
      const start = at + digits.length;
      const json = original.slice(start, start + declared).replace(/^\n/, '').replace(/\n$/, '');
      at = start + declared;
      if (!replaced && json.includes(`"wrb.fr","${RPC}"`)) { out.push(mine()); replaced = true; }
      else out.push(`${declared}\n${json}`);
    }
    if (!replaced) return `)]}'\n\n${mine()}\n`;
    return `${prefix}${out.join('\n')}${original.endsWith('\n') ? '\n' : ''}`;
  }

  function shaped(template, records, more, offset) {
    const payload = JSON.parse(JSON.stringify(template));
    payload[2] = records;
    payload[1] = more ? `${TOKEN}${offset}` : null;
    payload[5] = more ? null : true;
    return payload;
  }

  const sameText = (response, text) => {
    const copy = new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
    for (const key of ['url', 'type', 'redirected']) {
      try { Object.defineProperty(copy, key, { value: response[key], configurable: true }); } catch (_) {}
    }
    return copy;
  };

  async function bodyOf(input, init) {
    if (typeof init?.body === 'string') return init.body;
    if (init?.body != null) return null;
    if (typeof Request === 'undefined' || !(input instanceof Request) || input.method === 'GET') return null;
    try { return await input.clone().text(); } catch (_) { return null; }
  }

  // --- Google's topic chips, from the place reply Maps already fetched ----------
  //
  // The place reply lists them at [6][153][0]: [[id], word, null, [..., mentions
  // at 4], ...]. Only some place replies carry them, so a place without
  // chips goes straight to words.
  const chipsByPlace = new Map();

  function learnChips(text) {
    let json = null;
    try { json = JSON.parse(String(text).replace(/^\)\]\}'\s*/, '').replace(/\/\*""\*\/\s*$/, '')); } catch (_) { return; }
    const place = json?.[6]?.[10];
    const found = json?.[6]?.[153]?.[0];
    if (typeof place !== 'string' || !Array.isArray(found)) return;

    const chips = found.map((chip) => ({ id: chip?.[0]?.[0], word: chip?.[1], count: Number(chip?.[3]?.[4]) || 0 }))
      .filter((chip) => typeof chip.id === 'string' && chip.id && typeof chip.word === 'string')
      .sort((a, b) => b.count - a.count);
    if (chips.length) chipsByPlace.set(place, chips);
  }

  const isPlaceUrl = (url) => String(url).includes('/maps/preview/place?');

  const xhr = XMLHttpRequest.prototype;
  const xhrOpen = xhr.open;
  const xhrSend = xhr.send;
  xhr.open = function moreOpen(method, url) {
    try { this.__gmMore = isPlaceUrl(url); } catch (_) {}
    return xhrOpen.apply(this, arguments);
  };
  xhr.send = function moreSend() {
    if (this.__gmMore) {
      const request = this;
      request.addEventListener('loadend', () => {
        try {
          if (request.status === 200 && (!request.responseType || request.responseType === 'text')) learnChips(request.responseText);
        } catch (_) {}
      });
    }
    return xhrSend.apply(this, arguments);
  };

  // --- state for the list being read ------------------------------------------
  //
  // One list is one place under one sort, search or topic. Its key is the
  // request without the paging slots, so changing any of them starts again.
  // The list moves through stages: its own rows, then chips, then words.

  let list = null;

  const keyOf = (args) => {
    const copy = JSON.parse(JSON.stringify(args));
    put(copy, [1, 1], '');
    put(copy, [1, 0], null);
    put(copy, OFFSET_SLOT, null);
    return JSON.stringify(copy);
  };

  const isProse = (v) => typeof v === 'string' && v.length > 25 && /\S+\s+\S+\s+\S+\s+\S+/.test(v)
    && !/[/=?]|^[A-Za-z0-9_-]{30,}$/.test(v);

  function learnWords(records) {
    for (const record of records) {
      (function walk(v) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (isProse(v)) {
          for (const w of v.toLowerCase().match(/\p{L}{4,}/gu) || []) {
            if (!STOP.has(w) && !list.wordsTried.has(w)) list.words.set(w, (list.words.get(w) || 0) + 1);
          }
        }
      })(record);
    }
  }

  // New rows only, in the order they came.
  function fresh(payload) {
    const out = [];
    for (const record of recordsOf(payload)) {
      const id = idOf(record);
      if (id && !list.seen.has(id)) { list.seen.add(id); out.push(record); }
    }
    learnWords(out);
    return out;
  }

  // One stage's next requests. Each returns the change to make to the page's
  // request, or null when the stage has nothing left to ask.
  function nextRequest() {
    // 1 and 2: the list's own rows at the next offset, at the largest size.
    if (list.stage === 'rows') {
      const offset = list.offset;
      list.offset += PAGE;
      return { offset, change: (args) => put(args, OFFSET_SLOT, offset) };
    }

    // 3: the place's chips, most-mentioned first. Only rating sorts run out
    // early, and only the plain list has a chip to add.
    if (list.stage === 'chips') {
      const chip = list.chips.shift();
      if (!chip) { list.stage = 'words'; return nextRequest(); }
      list.chipOffset = 0;
      list.chip = chip;
      list.stage = 'chip';
      return nextRequest();
    }
    if (list.stage === 'chip') {
      const chip = list.chip;
      const offset = list.chipOffset;
      list.chipOffset += PAGE;
      return { offset, chip, change: (args) => { put(args, TOPIC_SLOT, [[chip.id]]); put(args, OFFSET_SLOT, offset); } };
    }

    // 4: words from the reviews shown, most frequent first.
    if (list.stage === 'words') {
      if (list.wordsAsked >= MAX_WORDS) return null;
      let best = null;
      for (const [word, count] of list.words) if (!list.wordsTried.has(word) && (!best || count > best[1])) best = [word, count];
      if (!best) return null;
      list.wordsTried.add(best[0]);
      list.wordsAsked++;
      list.wordOffset = 0;
      list.word = best[0];
      list.stage = 'word';
      return nextRequest();
    }
    if (list.stage === 'word') {
      const word = list.word;
      const offset = list.wordOffset;
      list.wordOffset += PAGE;
      return { offset, word, change: (args) => { put(args, QUERY_SLOT, word); put(args, OFFSET_SLOT, offset); } };
    }
    return null;
  }

  // A stage ends on a short page. The next stage is the one the priority says.
  function endStage() {
    if (list.stage === 'rows') list.stage = list.useFallbacks ? 'chips' : 'done';
    else if (list.stage === 'chip') list.stage = 'chips';
    else if (list.stage === 'word') list.stage = 'words';
  }

  // Up to AHEAD pages for a scroll, in order, at most BUDGET requests. Pages of
  // one stage are asked for together; the server answers each on its own.
  async function gather(url, request) {
    const rows = [];
    let spent = 0;
    let stages = 0;
    while (list.stage !== 'done' && rows.length < AHEAD * PAGE && spent < BUDGET && stages++ < 40) {
      const wanted = [];
      const stage = list.stage;
      for (let i = 0; i < AHEAD && spent + wanted.length < BUDGET; i++) {
        const next = nextRequest();
        if (!next) break;
        wanted.push(next);
        if (list.stage !== stage) break;
      }
      if (!wanted.length) { list.stage = 'done'; break; }

      const answers = await Promise.all(wanted.map((w) => ask(url, request, w.change).catch(() => null)));
      spent += wanted.length;
      let short = false;
      answers.forEach((payload) => {
        const got = payload ? recordsOf(payload) : [];
        rows.push(...fresh(payload || []));
        if (got.length < PAGE) short = true;
      });
      if (short) endStage();
    }
    return { rows, more: list.stage !== 'done' };
  }

  const before = window.fetch;
  window.fetch = async function reviewsFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (isPlaceUrl(url)) {
      const placed = before.apply(this, arguments);
      placed.then((res) => res.clone().text().then(learnChips)).catch(() => {});
      return placed;
    }
    if (!reviewsOn || !String(url).includes('batchexecute')) return before.apply(this, arguments);

    const body = await bodyOf(input, init);
    const request = typeof body === 'string' && body.includes(RPC) ? requestOf(body) : null;
    if (!request) return before.apply(this, arguments);

    try {
      const key = keyOf(request.args);
      const cursor = at(request.args, [1, 1]);
      const following = typeof cursor === 'string' && cursor.startsWith(TOKEN);

      // The marker is ours and never leaves the page. Without the list it
      // belongs to, the list simply ends.
      if (following) {
        const live = list && list.key === key;
        const next = live ? await gather(url, request) : { rows: [], more: false };
        const more = !!live && next.more && next.rows.length > 0;
        console.log(LOG, `page ok: reviews=${next.rows.length} shown=${list?.seen.size ?? 0} stage=${list?.stage ?? 'none'} more=${more}`);
        const text = frame(shaped(list?.template || [null, null, [], null, null, true], next.rows, more, list?.offset ?? 0));
        return list?.response ? sameText(list.response, text) : new Response(text, { status: 200 });
      }

      const res = await before.apply(this, arguments);
      if (res.status !== 200 || cursor) return res;

      const text = await res.clone().text();
      let payload = null;
      eachCall(text, (rpc, value) => { if (rpc !== RPC) return false; payload = value; return true; });
      if (!payload || !endOf(payload) || payload[1]) return res;

      // The page's own first page was asked at its own size, so the list's own
      // rows are read again from the start at the largest size: the order is
      // the same, and the page's rows are the first ones.
      const sort = at(request.args, SORT_SLOT);
      const plain = !at(request.args, QUERY_SLOT) && !at(request.args, TOPIC_SLOT);
      const place = at(request.args, [0, 0, 0]);
      list = {
        key, args: request.args, template: payload, response: res, seen: new Set(), stage: 'rows', offset: 0,
        // Chips only help a plain rating-sorted list; words help a rating sort, a search or a topic.
        useFallbacks: RATING_SORTS.includes(sort) || !plain,
        chips: plain && RATING_SORTS.includes(sort) ? [...(chipsByPlace.get(place) || [])] : [],
        words: new Map(), wordsTried: new Set(), wordsAsked: 0
      };
      for (const record of recordsOf(payload)) { const id = idOf(record); if (id) list.seen.add(id); }
      learnWords(recordsOf(payload));
      list.offset = PAGE;

      const next = await gather(url, request);
      if (!next.rows.length) return res;
      const records = [...recordsOf(payload), ...next.rows];
      console.log(LOG, `first ok: own=${recordsOf(payload).length} merged=${records.length} stage=${list.stage}`);
      return sameText(res, frame(shaped(payload, records, next.more, list.offset), text));
    } catch (error) {
      console.warn(LOG, `failed reason=${error?.message || String(error)}`);
      return before.apply(this, arguments);
    }
  };

})();
