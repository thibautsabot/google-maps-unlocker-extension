(() => {
  'use strict';

  // A place reply sometimes comes back short: today's hours only, no reviews,
  // a handful of photos. The same URL asked again a moment later returns the
  // whole week (measured: 10 refetches of a short page, all full). Nothing
  // the request carries tells the two apart, so the reply is checked and, if
  // short, asked for again before Maps reads it.

  let hoursOn = false;

  // Whether the switch state has arrived, and the place requests held until
  // it does. HOLD_MS is the longest a request waits for it.
  let known = false;
  const waiting = [];
  const HOLD_MS = 400;

  function release() {
    known = true;
    while (waiting.length) {
      try { waiting.shift()(); } catch (error) { console.warn(LOG, "held request failed", error); }
    }
  }

  const LOG = '[GM-HOURS]';
  const TRIES = 3;

  // Each day of the week is written ["Name",n,[y,m,d],[[...]]...]. Counting
  // distinct dates does not depend on the language the names are in.
  const DAY = /\["[^"]+",[1-7],\[(\d{4}),(\d{1,2}),(\d{1,2})\],\[\[/g;

  const days = (text) => {
    const seen = new Set();
    for (const m of String(text).matchAll(DAY)) seen.add(`${m[1]}-${m[2]}-${m[3]}`);
    return seen.size;
  };

  // One date means Maps was given today alone. None means the place lists no
  // hours, which asking again will not change.
  const isShort = (text) => days(text) === 1;

  const isPlace = (url) => String(url).includes('/maps/preview/place?');

  // Asks again until the reply is whole, or the tries run out. Returns the
  // best text it got, which is the original when nothing better came back.
  async function fuller(url, first, ask) {
    let best = first;

    for (let i = 1; i <= TRIES; i++) {
      try {
        console.log(LOG, `refetching (try ${i}/${TRIES})`);
        const text = await ask(url);
        console.log(LOG, `refetch ${i} returned ${days(text)} day(s), ${text.length} bytes`);
        if (days(text) > days(best)) best = text;
        if (!isShort(best)) break;
      } catch (error) {
        console.warn(LOG, `refetch ${i} failed`, error?.message || error);
        break;
      }
    }

    console.log(LOG, isShort(best)
      ? `still only today after ${TRIES} tries, keeping the original reply`
      : `fixed: ${days(first)} day(s) -> ${days(best)} day(s)`);
    return best;
  }

  window.__GM_HOURS_REPLY__ = { days, isShort, isPlace, fuller, on: () => hoursOn };

  // Maps asks for the place by XHR and reads the reply straight away, so the
  // reply cannot be swapped afterwards. The request is made here instead,
  // checked, and Maps is pointed at a copy of the text it would have got.
  const proto = XMLHttpRequest.prototype;
  const nativeOpen = proto.open;
  const nativeSend = proto.send;

  proto.open = function hoursOpen(method, url) {
    try { this.__gmHours = String(method).toUpperCase() === 'GET' ? String(url) : ''; } catch (_) {}
    return nativeOpen.apply(this, arguments);
  };

  proto.send = function hoursSend(body) {
    const url = this.__gmHours;
    if (!url || !isPlace(url)) return nativeSend.apply(this, arguments);

    // The first place request leaves before the switch state has reached the
    // page. Hold it until the state is known, but only briefly: a page that
    // never hears the switch must still get its place.
    if (!known) {
      const xhr = this;
      const args = arguments;
      waiting.push(() => hoursSend.apply(xhr, args));
      setTimeout(release, HOLD_MS);
      return undefined;
    }

    if (!hoursOn) return nativeSend.apply(this, arguments);

    const xhr = this;
    const args = arguments;
    const ask = async (u) => (await fetch(u, { credentials: 'include' })).text();

    console.log(LOG, 'place request intercepted, checking the reply');

    ask(url)
      .then(async (first) => {
        console.log(LOG, `reply has ${days(first)} day(s), ${first.length} bytes`);
        if (days(first) === 0) {
          console.log(LOG, 'no opening hours found in the reply, leaving it as it is');
          return first;
        }
        if (!isShort(first)) {
          console.log(LOG, 'full week already, nothing to do');
          return first;
        }
        console.log(LOG, 'only today in the reply, asking again');
        return fuller(url, first, ask);
      })
      .then((text) => {
        const copy = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const seen = xhr.__gm;
        nativeOpen.call(xhr, 'GET', copy, true);
        if (seen) xhr.__gm = seen;
        nativeSend.call(xhr);
        console.log(LOG, `handed Maps a reply with ${days(text)} day(s)`);
        setTimeout(() => URL.revokeObjectURL(copy), 10000);
      })
      .catch((error) => {
        console.warn(LOG, 'could not swap the reply, sending the original request', error?.message || error);
        nativeSend.apply(xhr, args);
      });
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== 'gm-native-maps' || data.type !== 'gm-settings') return;

    hoursOn = !!data.features?.hours;
    if (hoursOn) {
      console.log(LOG, 'hours switch is on, place replies will be checked');
      if (setAside) console.log(LOG, 'the place preload was set aside, so Maps asks for the place itself');
    } else {
      restorePreload();
    }
    release();
  });

  // The place reply is first asked for by a preload tag in the page's own
  // <head>, which the browser acts on before any script can. Maps then reads
  // that preload. A tag that is set aside before the browser fetches it
  // sends Maps to ask for the place itself, by XHR, where the reply can be
  // checked. If the switch turns out to be off, the tag is put back.
  let setAside = null;

  const isPlacePreload = (node) =>
    node?.nodeType === 1 && node.localName === 'link'
      && /preload|prefetch/i.test(node.getAttribute('rel') || '')
      && isPlace(node.getAttribute('href') || '');

  function restorePreload() {
    if (!setAside) return;
    const { node, parent, next } = setAside;
    setAside = null;
    try {
      node.setAttribute('rel', node.getAttribute('data-gm-rel') || 'preload');
      node.removeAttribute('data-gm-rel');
      (parent || document.head).insertBefore(node, next && next.parentNode === parent ? next : null);
    } catch (_) {}
  }

  function setPreloadAside(node) {
    if (setAside || !isPlacePreload(node)) return;
    const parent = node.parentNode;
    const next = node.nextSibling;

    // Takes effect before the browser starts the fetch only if this runs
    // before the tag is handled, which the log below reports either way.
    node.setAttribute('data-gm-rel', node.getAttribute('rel'));
    node.setAttribute('rel', 'gm-held');
    node.remove();
    setAside = { node, parent, next };
  }

  const watchHead = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) setPreloadAside(node);
    }
  });

  watchHead.observe(document, { childList: true, subtree: true });
  for (const node of document.querySelectorAll?.('link') || []) setPreloadAside(node);

  // Once Maps is running the preload is no longer in play.
  document.addEventListener('DOMContentLoaded', () => watchHead.disconnect(), { once: true });
})();
