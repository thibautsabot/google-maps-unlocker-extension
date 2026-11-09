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
  let detectorFound = '';

  const LOG = '[GM-REVIEWS]';
  const MARK = 'data-gm-reviews-hidden';
  const SEEN = new Set();
  let reads = 0;
  let discoveryStatus = '';
  let discoveryReason = '';
  let discoveryReported = false;

  function reportDiscovery() {
    if (!reviewsOn || !discoveryStatus || discoveryReported) return;
    discoveryReported = true;
    const detail = discoveryStatus === 'ok' ? `detector=${detectorFound}` : `reason=${discoveryReason}`;
    console.log(LOG, `discovery ${discoveryStatus} ${detail}`);
  }

  function discovered(status, reason = '') {
    if (status !== discoveryStatus || reason !== discoveryReason) discoveryReported = false;
    discoveryStatus = status;
    discoveryReason = reason;
    reportDiscovery();
  }

  const FIELD4 = /_\.([A-Za-z0-9$]+)=function\(([A-Za-z0-9$]+)\)\{return _\.[A-Za-z0-9$]+\(\2,4\);?\}/g;
  const escapeReg = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // The review controls are the calls that pass a session in and then read
  // field 259. One of those, in two builds, and no other field-4 function.
  const beside259 = (name) =>
    new RegExp(String.raw`_\.${escapeReg(name)}\(_\.[A-Za-z0-9$]+\(\)\)[^;]{0,200},259\)`, 'g');

  // Preserve the regex detector above as the primary path. This tokenizer is
  // a fallback for Maps builds that inline the gate call and rename the field
  // reader. It ignores comments and literals, then matches a narrow control
  // flow shape: a condition containing field 259 and a gate call, with
  // different review-action handlers in the true/false branches.
  const lex = (source) => [...source.matchAll(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|===|!==|=>|&&|\|\||==|!=|<=|>=|\?\.|[^\s]/g
  )].map((m) => m[0]).filter((t) => !t.startsWith('//') && !t.startsWith('/*')
    && !t.startsWith('"') && !t.startsWith("'") && !t.startsWith('`'));

  function matching(tokens, start, open = '(', close = ')') {
    if (tokens[start] !== open) return -1;
    let depth = 0;
    for (let i = start; i < tokens.length; i++) {
      if (tokens[i] === open) depth++;
      else if (tokens[i] === close && --depth === 0) return i;
    }
    return -1;
  }

  function hasReviewAction(tokens) {
    for (let i = 0; i + 4 < tokens.length; i++) {
      if (tokens[i] === 'actions' && tokens[i + 1] === '.'
        && /^[A-Za-z_$][\w$]*$/.test(tokens[i + 2])
        && tokens[i + 3] === '.' && tokens[i + 4] === 'run') return tokens[i + 2];
    }
    return '';
  }

  function splitAnd(tokens) {
    const parts = [];
    let start = 0, depth = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === '(' || tokens[i] === '[' || tokens[i] === '{') depth++;
      else if (tokens[i] === ')' || tokens[i] === ']' || tokens[i] === '}') depth--;
      else if (tokens[i] === '&&' && depth === 0) {
        parts.push(tokens.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(tokens.slice(start));
    return parts;
  }

  function inlineGate(source) {
    const tokens = lex(source);
    for (let i = 0; i + 1 < tokens.length; i++) {
      if (tokens[i] !== 'if' || tokens[i + 1] !== '(') continue;
      const condEnd = matching(tokens, i + 1);
      if (condEnd < 0) continue;

      const clauses = splitAnd(tokens.slice(i + 2, condEnd));
      const fieldClause = clauses.findIndex((c) => c.includes('259'));
      if (fieldClause < 1 || !clauses.slice(fieldClause + 1).some((c) => c.includes('actions'))) continue;

      const call = clauses.slice(0, fieldClause).map((clause) => {
        for (let j = 0; j + 2 < clause.length; j++) {
          if (clause[j] === '.' && /^[A-Za-z_$][\w$]*$/.test(clause[j + 1])
            && clause[j + 2] === '(') return clause[j + 1];
        }
        return '';
      }).find(Boolean);
      if (!call) continue;

      let bodyStart = condEnd + 1;
      if (tokens[bodyStart] !== '{') continue;
      const bodyEnd = matching(tokens, bodyStart, '{', '}');
      if (bodyEnd < 0 || tokens[bodyEnd + 1] !== 'else') continue;
      const signIn = hasReviewAction(tokens.slice(bodyStart, bodyEnd + 1));
      const tail = tokens.slice(bodyEnd + 2, bodyEnd + 100);
      const open = hasReviewAction(tail);
      if (!signIn || !open || signIn === open || !tail.includes('flow')) continue;

      return { check: call, actions: { open } };
    }
    return null;
  }

  const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();

  // text + nbsp + "(" then a count, as a concatenation or a template.
  const SEE_MORE = /"((?:\\.|[^"\\])*)\\u00a0\("\+|`((?:\\.|[^`\\$])*)\\u00a0\(\$\{|`((?:\\.|[^`\\$])*)\u00a0\(\$\{/;

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
    if (found) {
      detectorFound = 'field4-regex';
      return found;
    }

    const inline = inlineGate(source);
    if (inline) detectorFound = 'structural-fallback';
    return inline?.check || '';
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
    return { open: match[3] };
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

  const wrappers = new WeakMap();
  const installs = new Map();

  function wrap(name) {
    const root = window._;
    if (!root || typeof root !== 'object') return false;

    const described = Object.getOwnPropertyDescriptor(root, name);
    if (described?.get && wrappers.get(root)?.get(name) === described.get) return true;
    if (described && (!described.configurable || described.get || described.set)) return false;

    let real = typeof root[name] === 'function' ? root[name] : null;

    const wrapped = function (value) {
      if (reviewsOn) return false;
      return typeof real === 'function' ? real.call(this, value) : false;
    };

    const get = () => wrapped;
    try {
      Object.defineProperty(root, name, {
        configurable: true,
        enumerable: described?.enumerable ?? true,
        get,
        set(fn) { if (typeof fn === 'function') real = fn; }
      });
    } catch (_) { return false; }
    if (!wrappers.has(root)) wrappers.set(root, new Map());
    wrappers.get(root).set(name, get);
    return true;
  }

  function wrapSoon(name) {
    if (installs.has(name)) return;
    const done = () => {
      if (!wrap(name)) return false;
      discovered('ok');
      return true;
    };
    if (done()) return;

    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (done() || tries >= 50) {
        clearInterval(timer);
        installs.delete(name);
        if (discoveryStatus !== 'ok') discovered('failed', 'wrap-failed');
      }
    }, 100);
    installs.set(name, timer);
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
      const text = label[1] ?? label[2] ?? label[3];
      try { seeMore = JSON.parse('"' + text.replace(/\\`/g, '`').replace(/"/g, '\\"') + '"'); } catch (_) {}
    }
    wrapSoon(name);

    const actions = listActions(source, name) || inlineGate(source)?.actions;
    if (actions) {
      const tab = tabLabel(source, actions.open);
      if (tab) reviewsTab = tab;
    }

    if (reviewsOn) hideNotice();
  }

  // Whether a node paints a photo anywhere inside it, by background image
  // or by img. Maps draws its grid tiles as background images.
  const PHOTO_HOSTS = /googleusercontent\.com|ggpht\.com|streetviewpixels/i;

  function holdsPhotos(node) {
    for (const child of node.querySelectorAll('[style*="background-image"], img')) {
      const style = child.getAttribute('style') || '';
      const src = child.getAttribute('src') || '';
      if (PHOTO_HOSTS.test(style) || PHOTO_HOSTS.test(src)) return true;
    }
    return false;
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

      // The gallery drawer can hold the notice beside its photo grid. Hiding
      // that wrapper hides the photos with it, which shows as images for an
      // instant and then a white block. A box with photos in it is never the
      // notice box.
      if (holdsPhotos(node)) continue;

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
    reads++;

    try {
      const response = await fetch(url);
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      learn(await response.text());
    } catch (error) {
      SEEN.delete(url);
      discoveryReason = error?.message || String(error);
    } finally {
      reads--;
      if (!reads && !checkFound) discovered('failed', discoveryReason || 'gate-not-found');
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
        try { hideNotice(); } catch (error) { console.warn(LOG, `notice failed reason=${error?.message || String(error)}`); }
      }, 200);
    };

    const start = () => {
      scanScripts();
      new MutationObserver(() => {
        scanScripts();
        if (checkFound && discoveryStatus !== 'ok') wrapSoon(checkFound);
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
    // is stopped. Only the sign-in prompt is removed; the reviews Google
    // does not send are not there to show.
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

  window.__GM_REVIEWS__ = {
    // What discovery found in the Maps script. Read by the tests, and handy
    // in the console when a Maps update leaves a feature doing nothing.
    learned: () => ({ check: checkFound, detector: detectorFound, notice, seeMore, reviewsTab })
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== 'gm-native-maps' || data.type !== 'gm-settings') return;

    const enabled = !!data.features?.reviews;
    if (enabled && !reviewsOn) discoveryReported = false;
    reviewsOn = enabled;
    if (reviewsOn && checkFound && discoveryStatus !== 'ok') wrapSoon(checkFound);
    reportDiscovery();
    if (reviewsOn) hideNotice();
    else showNotice();
  });
})();
