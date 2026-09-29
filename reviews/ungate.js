(() => {
  'use strict';

  // Sort and the magnifying glass ask one question before they do
  // anything: are we signed out of a session Maps has marked limited? Yes
  // means the sign-in dialog. The see-more control does not ask, so on the
  // overview its click is pointed at an action that opens the list.
  //
  // Names are rewritten every time Maps ships. What stays is the shape.
  // The check is a one-line read of field 4, called as `name(session())`
  // next to field 259. While the switch is on it answers as a signed-in
  // session would. Everything else, the button's words, the tab's name and
  // the limited-view sentence, is read out of the same script, so it follows
  // the language the page was served in. No class names are used.

  let reviewsOn = false;
  let notice = '';
  let seeMore = '';
  let reviewsTab = '';
  let checkFound = '';

  const LOG = '[GM-REVIEWS]';
  const MARK = 'data-gm-reviews-hidden';
  const SEEN = new Set();

  const FIELD4 = /_\.([A-Za-z0-9$]+)=function\(([A-Za-z0-9$]+)\)\{return _\.[A-Za-z0-9$]+\(\2,4\);?\}/g;
  const escapeReg = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // The review controls are the calls that pass a session in and then read
  // field 259. One of those, in two builds, and no other field-4 function.
  const beside259 = (name) =>
    new RegExp(String.raw`_\.${escapeReg(name)}\(_\.[A-Za-z0-9$]+\(\)\)[^;]{0,200},259\)`, 'g');

  const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();

  // text + nbsp + "(" then a count, as a concatenation or a template.
  const SEE_MORE = /"((?:\\.|[^"\\])*)\\u00a0\("\+|`((?:\\.|[^`\\$])*)\\u00a0\(\$\{/;

  function checkName(source) {
    const names = new Map();
    FIELD4.lastIndex = 0;

    for (const match of source.matchAll(FIELD4)) {
      const name = match[1];
      const hits = source.match(beside259(name));
      if (hits) names.set(name, hits.length);
    }

    let found = '';
    let most = 0;
    for (const [name, count] of names) {
      if (count > most) {
        found = name;
        most = count;
      }
    }
    return found;
  }

  // The notice is the long .text("...") just before the check picks the
  // button label. Button labels are short and sit after that call.
  function noticeIn(source, name) {
    const mark = new RegExp(String.raw`_\.${escapeReg(name)}\([A-Za-z0-9$]+\)\?`, 'g');
    const textCall = /\.text\(_\.\w+\("((?:\\.|[^"\\])*)"\)\)/g;
    let longest = '';

    for (const match of source.matchAll(mark)) {
      const slice = source.slice(Math.max(0, match.index - 1500), match.index);
      for (const call of slice.matchAll(textCall)) {
        let decoded = '';
        try { decoded = JSON.parse('"' + call[1] + '"'); } catch (_) { continue; }
        if (decoded.length > longest.length) longest = decoded;
      }
    }
    return longest.length > 40 ? longest : '';
  }

  // Sort and search fall through to the list when the check says no. The
  // see-more control never falls through: it calls the sign-in action
  // named in that check. The list action is the else branch beside it.
  function listActions(source, check) {
    const pair = new RegExp(
      String.raw`_\.${escapeReg(check)}\(_\.[A-Za-z0-9$]+\(\)\)&&_\.[A-Za-z0-9$]+\((?:[A-Za-z0-9$]+\.)+[A-Za-z0-9$]+,259\)&&([A-Za-z0-9$]+)\.actions\.([A-Za-z0-9$]+)\)[\s\S]{0,300}?else \1\.actions\.([A-Za-z0-9$]+)\.run\(\{flow:`,
      'g'
    );
    const match = pair.exec(source);
    if (!match) return null;
    return { signIn: match[2], open: match[3] };
  }

  // The reviews tab is the control whose action opens the list and nothing
  // else. The label is whatever language this script was served in.
  function tabLabel(source, open) {
    const found = new RegExp(
      String.raw`label:"((?:\\.|[^"\\])*)",ariaLabel:[^}]{0,200}?actions\.${escapeReg(open)}\.run\(\{flow:[A-Za-z0-9$]+,[A-Za-z0-9$]+:!1\}\)`,
    ).exec(source);
    if (!found) return '';
    try { return JSON.parse('"' + found[1] + '"'); } catch (_) { return ''; }
  }

  function reviewsTabSelected() {
    const needle = norm(reviewsTab);
    if (!needle) return false;

    for (const tab of document.querySelectorAll('[role="tab"][aria-selected="true"]')) {
      const name = norm(tab.getAttribute('aria-label') || tab.textContent);
      if (name === needle) return true;
      const at = name.length - needle.length;
      if (at > 0 && name.endsWith(needle) && /[\s-]/.test(name[at - 1])) return true;
    }
    return false;
  }

  function wrap(name) {
    const root = window._;
    if (!root || typeof root !== 'object') return false;

    const described = Object.getOwnPropertyDescriptor(root, name);
    if (described && !described.configurable) return false;
    if (described?.get) return true;

    let real = typeof root[name] === 'function' ? root[name] : null;

    const wrapped = function (value) {
      if (reviewsOn) return false;
      return typeof real === 'function' ? real.call(this, value) : false;
    };

    Object.defineProperty(root, name, {
      configurable: true,
      enumerable: true,
      get() { return wrapped; },
      set(fn) { if (typeof fn === 'function') real = fn; }
    });

    return true;
  }

  function wrapSoon(name) {
    if (wrap(name)) return;

    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (wrap(name) || tries > 50) clearInterval(timer);
    }, 100);
  }

  function learn(source) {
    const name = checkName(source);
    if (!name) return;
    checkFound = name;

    const sentence = noticeIn(source, name);
    if (sentence) notice = sentence;

    // The see-more label is the one string in that script built as
    // text + nbsp + "(" + count. It is whatever language the script was
    // served in. Maps compiles that either as a concatenation or as a
    // template literal, and the build alternates between the two.
    const label = SEE_MORE.exec(source);
    if (label) {
      const text = label[1] ?? label[2];
      try { seeMore = JSON.parse('"' + text.replace(/\\`/g, '`').replace(/"/g, '\\"') + '"'); } catch (_) {}
    }
    wrapSoon(name);

    const actions = listActions(source, name);
    if (actions) {
      const tab = tabLabel(source, actions.open);
      if (tab) reviewsTab = tab;
    }

    if (reviewsOn) hideNotice();
  }

  // The sentence sits in its own span. Hiding that span leaves the box,
  // and the box is the popup: the same sentence plus its button. The box is
  // the smallest node that has both, and it stays small. The review list
  // that contains it does not.
  function hideNotice() {
    if (!reviewsOn || !notice || !document.body) return;

    const needle = norm(notice);
    let best = null;
    let bestLen = Infinity;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.getAttribute(MARK)) continue;

      const text = norm(node.textContent);
      if (!text.includes(needle) || text.length >= bestLen) continue;
      if (text.length > needle.length + 200) continue;
      if (!node.querySelector('button, [role="button"]')) continue;

      best = node;
      bestLen = text.length;
    }

    if (!best) return;
    best.setAttribute(MARK, '1');
    best.style.setProperty('display', 'none', 'important');
  }

  function showNotice() {
    for (const node of document.querySelectorAll(`[${MARK}]`)) {
      node.style.removeProperty('display');
      node.removeAttribute(MARK);
    }
  }

  async function readScript(url) {
    if (SEEN.has(url)) return;
    SEEN.add(url);

    try {
      const response = await fetch(url);
      learn(await response.text());
    } catch (error) {
      console.warn(LOG, 'could not read the Maps script', error);
    }
  }

  function scanScripts() {
    for (const node of document.querySelectorAll('script[src]')) {
      const url = node.src || '';
      if (url.includes('/maps/_/js/')) readScript(url);
    }
  }

  let pending = 0;
  let watching = false;

  function watch() {
    if (watching) return;
    watching = true;

    const schedule = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = 0;
        try { hideNotice(); } catch (error) { console.warn(LOG, 'hide failed', error); }
      }, 200);
    };

    const start = () => {
      scanScripts();
      new MutationObserver(() => {
        scanScripts();
        schedule();
      }).observe(document.documentElement, { childList: true, subtree: true });
      schedule();
    };

    // On the place overview the see-more button's own action is the
    // sign-in dialog. The rating chart's action is a fixed name, and once
    // the check answers no it opens the list. The click is still the
    // user's. Only the action name on the button is changed, before Maps
    // reads it.
    //
    // On the reviews tab the list is already open, and the button stands for
    // the reviews the server refused to page. Opening the list again does
    // nothing, and the sign-in dialog would only get in the way, so the click
    // is stopped. Getting those reviews is the session swap's job.
    document.addEventListener('click', (event) => {
      if (!reviewsOn || !seeMore || !event.target?.closest) return;

      const button = event.target.closest('button, [role="button"]');
      if (!button) return;

      const label = norm(button.getAttribute('aria-label') || button.textContent);
      if (!label.startsWith(norm(seeMore))) return;

      if (reviewsTabSelected()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      delete button.__jsaction;
      button.setAttribute('jsaction', 'pane.reviewChart.moreReviews');
    }, true);

    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  watch();

  // What this load's review section says about the session. Limited: Maps
  // drew its see-more button, or the notice this script hides. Clear: the
  // rating chart is up and neither is. The chart is found by its action
  // name, which the bundle spells the same way in every build. A page that
  // shows neither has said nothing, and is not taken as clear.
  const seeMoreShown = () => !!seeMore
    && [...document.querySelectorAll('button, [role="button"]')]
      .some((b) => norm(b.getAttribute('aria-label') || b.textContent).startsWith(norm(seeMore)));

  const chartShown = () => !!document.querySelector('[jsaction*="reviewChart.moreReviews"]');

  window.__GM_REVIEWS__ = {
    // What discovery found in the Maps script. Read by the tests, and handy
    // in the console when a Maps update leaves a feature doing nothing.
    learned: () => ({ check: checkFound, notice, seeMore, reviewsTab }),
    limited: () => !!document.querySelector(`[${MARK}]`) || seeMoreShown(),
    clear: () => chartShown() && !seeMoreShown() && !document.querySelector(`[${MARK}]`)
  };

  const tell = (message) => {
    try { window.postMessage({ source: 'gm-native-maps', ...message }, location.origin); } catch (_) {}
  };

  // Reported at most once each per load, and a limited report can follow a
  // clear one. A clear needs two looks in a row, so a page still drawing
  // its chart before its button is not read as clear.
  let sent = '';
  let clearLooks = 0;
  let photosOn = false;

  function reportState() {
    if (!photosOn || !seeMore || sent === 'limited') return;

    if (window.__GM_REVIEWS__.limited()) {
      sent = 'limited';
      console.debug(LOG, 'this session is limited');
      tell({ type: 'gm-reviews-state', limited: true, url: location.href });
      return;
    }

    clearLooks = window.__GM_REVIEWS__.clear() ? clearLooks + 1 : 0;
    if (clearLooks >= 2 && !sent) {
      sent = 'clear';
      console.debug(LOG, 'this session shows the whole review section');
      tell({ type: 'gm-reviews-state', limited: false, url: location.href });
    }
  }

  setInterval(reportState, 1000);

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== 'gm-native-maps' || data.type !== 'gm-settings') return;

    reviewsOn = !!data.features?.reviews;
    photosOn = !!data.features?.photos;
    if (reviewsOn) hideNotice();
    else showNotice();
  });
})();
