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
    if (!hoursOn) restorePreload();
    while (waiting.length) {
      try { waiting.shift()(); } catch (error) { console.warn(LOG, `reply failed reason=${error?.message || String(error)}`); }
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

  // One to six dates is an incomplete week. No dates means no listed hours.
  const isShort = (text) => { const count = days(text); return count > 0 && count < 7; };

  const isPlace = (url) => String(url).includes('/maps/preview/place?');

  // Asks again until the reply is whole, or the tries run out. Returns the
  // best text it got, which is the original when nothing better came back.
  async function fuller(url, first, ask, result = {}) {
    let best = first;
    result.tries = 0;

    for (let i = 1; i <= TRIES; i++) {
      result.tries = i;
      try {
        const text = await ask(url);
        if (days(text) > days(best)) best = text;
        if (!isShort(best)) break;
      } catch (error) {
        result.reason = error?.message || String(error);
        break;
      }
    }

    return best;
  }

  window.__GM_HOURS_REPLY__ = { days, isShort, isPlace, fuller };

  // Maps asks for the place by XHR and reads the reply straight away, so the
  // reply cannot be swapped afterwards. The request is made here instead,
  // checked, and Maps is pointed at a copy of the text it would have got.
  const proto = XMLHttpRequest.prototype;
  const nativeOpen = proto.open;
  const nativeSend = proto.send;
  const nativeAbort = proto.abort;
  const requests = new WeakMap();
  const fetching = new Set();

  const cancel = (xhr) => {
    const request = requests.get(xhr);
    if (!request) return;
    request.cancelled = true;
    request.controller?.abort();
    requests.delete(xhr);
  };

  proto.open = function hoursOpen(method, url, async = true) {
    cancel(this);
    this.__gmHours = '';
    const opened = nativeOpen.apply(this, arguments);
    // Synchronous and authenticated requests retain native XHR semantics.
    if (async !== false && arguments.length < 4 && String(method).toUpperCase() === 'GET') {
      this.__gmHours = String(url);
    }
    return opened;
  };

  if (nativeAbort) proto.abort = function hoursAbort() {
    cancel(this);
    return nativeAbort.apply(this, arguments);
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
      const request = { cancelled: false };
      requests.set(xhr, request);
      waiting.push(() => {
        if (request.cancelled) return;
        requests.delete(xhr);
        hoursSend.apply(xhr, args);
      });
      setTimeout(release, HOLD_MS);
      return undefined;
    }

    if (!hoursOn) return nativeSend.apply(this, arguments);

    const xhr = this;
    const args = arguments;
    const request = { cancelled: false, controller: new AbortController() };
    requests.set(xhr, request);
    fetching.add(request);
    request.resume = () => {
      if (!active()) return;
      cancel(xhr);
      nativeSend.apply(xhr, args);
    };
    const active = () => !request.cancelled && requests.get(xhr) === request;
    const ask = async (u) => {
      if (!active() || !hoursOn) throw new Error('cancelled');
      const response = await fetch(u, { credentials: 'include', signal: request.controller.signal });
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      return response.text();
    };

    const started = Date.now();
    const result = { tries: 0 };
    let firstDays = 0;

    ask(url)
      .then(async (first) => {
        firstDays = days(first);
        if (!isShort(first)) return first;
        return fuller(url, first, ask, result);
      })
      .then((text) => {
        if (!active()) return;
        if (!hoursOn) {
          requests.delete(xhr);
          return nativeSend.apply(xhr, args);
        }
        const copy = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const seen = xhr.__gm;
        nativeOpen.call(xhr, 'GET', copy, true);
        if (seen) xhr.__gm = seen;
        nativeSend.call(xhr);
        requests.delete(xhr);
        const status = result.reason || isShort(text) ? 'failed' : days(text) > firstDays ? 'ok' : 'unchanged';
        const reason = result.reason || (isShort(text) ? (days(text) === 1 ? 'today-only' : 'incomplete-week') : firstDays === 0 ? 'no-hours' : '');
        console.log(LOG, `reply ${status} days=${firstDays}->${days(text)} tries=${result.tries} ms=${Date.now() - started}${reason ? ` reason=${reason}` : ''}`);
        setTimeout(() => URL.revokeObjectURL(copy), 10000);
      })
      .catch((error) => {
        if (!active()) return;
        requests.delete(xhr);
        if (!hoursOn) return nativeSend.apply(xhr, args);
        console.warn(LOG, `reply failed tries=${result.tries} ms=${Date.now() - started} reason=${error?.message || String(error)}`);
        nativeSend.apply(xhr, args);
      })
      .finally(() => fetching.delete(request));
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== 'gm-native-maps' || data.type !== 'gm-settings') return;

    hoursOn = !!data.features?.hours;
    if (!hoursOn) {
      restorePreload();
      for (const request of fetching) request.resume();
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
    if ((known && !hoursOn) || setAside || !isPlacePreload(node)) return;
    const parent = node.parentNode;
    const next = node.nextSibling;

    // Takes effect before the browser starts the fetch only if this runs
    // before the tag is handled.
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
