(() => {
  'use strict';

  // Sort and the magnifying glass ask one question before they do
  // anything: are we signed out of a session Maps has marked limited? Yes
  // means the sign-in dialog. One see-more control does not ask. Its click
  // calls the sign-in action outright, so answering the question is not
  // enough for it.
  //
  // Names are rewritten every time Maps ships. What stays is the shape.
  // The check is a one-line read of field 4, called as `name(session())`
  // next to field 259, and the else of that check is the action that opens
  // the list. The see-more control calls the sign-in action from that same
  // check. While the switch is on, the check answers no, and that sign-in
  // action opens the list instead.
  //
  // That sign-in action is one field on an object Maps builds while the
  // script is still running. Asking for the object afterwards is a
  // different lookup and the click never goes through it. The build is
  // caught as the script assigns it: it is the only constructor that
  // fills dozens of action slots.
  //
  // The limited-view notice is the sentence in that same script, not a
  // class and not a label. Classes on that node are generated and do not
  // survive a build. The sentence is whatever language the script was
  // served in.

  let reviewsOn = false;
  let notice = '';
  let seeMore = '';
  let reviewsTab = '';
  let redirect = null;
  let runsHooked = false;

  // Instances of the actions object, caught as Maps constructs them.
  const built = [];

  // Maps does `this._ = this._ || {}` and then assigns into that object.
  // Putting the watch here, before any page script, means the constructor
  // is wrapped before anything calls it.
  function watchBuild(Original) {
    function Built() {
      const instance = Reflect.construct(Original, arguments, Original);
      built.push(instance);
      return instance;
    }

    Built.prototype = Original.prototype;
    Built.__gmBuilt = true;
    return Built;
  }

  function installNamespace() {
    const current = window._;
    const root = current && typeof current === 'object' ? current : {};
    if (root.__gmArmed) return;

    root.__gmArmed = true;
    window._ = new Proxy(root, {
      set(target, prop, value) {
        try {
          if (typeof value === 'function' && !value.__gmBuilt && value.length === 0) {
            const src = Function.prototype.toString.call(value);
            if (src.split('=new _.').length - 1 >= 40) value = watchBuild(value);
          }
        } catch (_) {}

        // Set on the target. Passing the proxy back as the receiver
        // defines the property on the proxy and re-enters this trap.
        return Reflect.set(target, prop, value, target);
      }
    });
  }

  installNamespace();

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

  // The open list already pages itself when its scroller nears the bottom.
  // The see-more button sits in that list and only knows how to open the
  // sign-in dialog, so the click is dropped and the scroller is moved to
  // the end. That is the same request scrolling would send.
  //
  // Maps listens for scroll on one element of the list, and a scroll event
  // does not bubble. A short list may not scroll at all, so no real event
  // ever fires. The event is sent to every ancestor of the button, and the
  // ones that can scroll are moved to the end first.
  function pageList(button) {
    let sent = 0;
    const scrollers = [];
    for (let node = button.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      try {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
          node.scrollTop = node.scrollHeight;
          scrollers.push({
            top: Math.round(node.scrollTop),
            height: node.scrollHeight,
            client: node.clientHeight
          });
        }
      } catch (_) {}
      node.dispatchEvent(new Event('scroll'));
      sent += 1;
    }
    return { sent, scrollers };
  }

  // Says what came of the scroll, so nobody has to open the network tab.
  // A request is any batchexecute call in the next few seconds, named by
  // its rpc. A review is any node carrying the review's own id attribute.
  function watchPaging() {
    const count = () => document.querySelectorAll('[data-review-id]').length;
    const before = count();
    const calls = [];
    let observer = null;

    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.name.includes('batchexecute')) continue;
          let rpc = entry.name;
          try { rpc = new URL(entry.name).searchParams.get('rpcids') || rpc; } catch (_) {}
          calls.push(rpc);
        }
      });
      observer.observe({ type: 'resource' });
    } catch (_) {}

    setTimeout(() => {
      try { observer?.disconnect(); } catch (_) {}
      console.debug(LOG, 'reviews tab: after 4s', {
        requests: calls,
        reviewsBefore: before,
        reviewsAfter: count()
      });
    }, 4000);
  }

  // Both actions are fields of one object Maps builds once. The field
  // names are the ones from the check. The getter is the call that reads
  // that object back; the call that registers it is not.
  function actionHost(source, signIn, open) {
    const signAt = source.indexOf(`this.${signIn}=new _.`);
    const openAt = source.indexOf(`this.${open}=new _.`, signAt);
    if (signAt < 0 || openAt < 0 || openAt - signAt > 20000) return null;

    const made = /^[A-Za-z0-9$]+/.exec(source.slice(signAt + `this.${signIn}=new _.`.length));
    if (!made) return null;
    if (!source.startsWith(made[0], openAt + `this.${open}=new _.`.length)) return null;

    const fn = source.lastIndexOf('=function()', signAt);
    const ctor = /_\.([A-Za-z0-9$]+)$/.exec(source.slice(Math.max(0, fn - 40), fn));
    if (!ctor) return null;

    const calls = source.matchAll(new RegExp(String.raw`_\.([A-Za-z0-9$]+)\(_\.${escapeReg(ctor[1])}\)`, 'g'));
    let getter = '';
    for (const call of calls) {
      const def = new RegExp(String.raw`_\.${escapeReg(call[1])}=function\(([A-Za-z0-9$]+)(?:,[A-Za-z0-9$]+)?\)\{`);
      const bodyAt = def.exec(source);
      if (!bodyAt) continue;
      const body = source.slice(bodyAt.index, bodyAt.index + 400);
      if (body.includes('.register')) continue;
      if (!body.includes('return ')) continue;
      getter = call[1];
      break;
    }
    if (!getter) return null;

    return { ctor: ctor[1], getter, action: made[0] };
  }

  function hasPair(actions) {
    if (!redirect || !actions) return false;
    const sign = actions[redirect.signIn];
    const list = actions[redirect.open];
    return !!sign && !!list && typeof sign.run === 'function' && typeof list.run === 'function';
  }

  // The open action sitting next to this sign-in slot, if this object is
  // one Maps built for these controls.
  function listBeside(sign) {
    if (!redirect) return null;
    for (const actions of built) {
      if (actions[redirect.signIn] === sign && hasPair(actions)) return actions[redirect.open];
    }
    return null;
  }

  // Every action shares one run. The see-more click is the call that
  // passes a flow and a place key and nothing else. While the switch is
  // on, that call opens the list. Every other call is left alone.
  function hookRuns() {
    if (runsHooked || !redirect) return false;

    const proto = window._?.[redirect.action]?.prototype;
    const real = proto?.run;
    if (typeof real !== 'function' || real.__gmHook) {
      runsHooked = typeof real === 'function' && !!real.__gmHook;
      return runsHooked;
    }

    function hooked(payload) {
      const seeMore = payload && Object.keys(payload).length === 2
        && Object.prototype.hasOwnProperty.call(payload, 'flow')
        && Object.prototype.hasOwnProperty.call(payload, 'Kb');
      const list = reviewsOn && seeMore ? listBeside(this) : null;
      if (list) return real.call(list, { flow: payload.flow });
      return real.call(this, payload);
    }

    hooked.__gmHook = true;
    proto.run = hooked;
    runsHooked = true;
    console.debug(LOG, 'see-more opens the list');
    return true;
  }

  // Fallback for a build that was constructed before the watch was in
  // place. The same getter Maps uses to read the object back.
  function rememberBuilt() {
    if (!redirect || built.some(hasPair)) return;

    const root = window._;
    const ctor = root?.[redirect.ctor];
    const get = root?.[redirect.getter];
    if (typeof ctor !== 'function' || typeof get !== 'function') return;

    try {
      const actions = get(ctor);
      if (hasPair(actions)) built.push(actions);
    } catch (_) {}
  }

  function finishRedirect() {
    rememberBuilt();
    hookRuns();
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

    console.debug(LOG, 'sign-in check wrapped');
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

      const host = actionHost(source, actions.signIn, actions.open);
      if (host) {
        redirect = { signIn: actions.signIn, open: actions.open, ...host };
        finishRedirect();
      }
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

    // The place may finish building after the script has been read. A click
    // is late enough that the actions object exists, and it is early enough
    // that the handler has not run yet.
    //
    // On the place overview the see-more button's own action is the
    // sign-in dialog. The rating chart's action is a fixed name, and once
    // the check answers no it opens the list. The click is still the
    // user's. Only the action name on the button is changed, before Maps
    // reads it.
    //
    // On the reviews tab that same button is sitting in a list that is
    // already open. Pointing it at the chart asks to open the list again.
    // The click is stopped, and the list's own scroller is moved to the
    // end so it asks for the next page.
    document.addEventListener('click', (event) => {
      if (reviewsOn) finishRedirect();
      if (!reviewsOn || !seeMore || !event.target?.closest) {
        if (event.target?.closest?.('button, [role="button"]')) {
          console.debug(LOG, 'click ignored: not ready', { on: reviewsOn, seeMore });
        }
        return;
      }

      const button = event.target.closest('button, [role="button"]');
      if (!button) return;
      const label = norm(button.getAttribute('aria-label') || button.textContent);
      if (!label.startsWith(norm(seeMore))) {
        if (/\(\d+\)\s*$/.test(label)) {
          console.debug(LOG, 'click ignored: label does not match', { label, seeMore });
        }
        return;
      }

      const selected = reviewsTabSelected();
      console.debug(LOG, 'see-more clicked', {
        label,
        tab: reviewsTab,
        tabSelected: selected,
        tabs: [...document.querySelectorAll('[role="tab"]')].map((t) => ({
          text: norm(t.getAttribute('aria-label') || t.textContent),
          selected: t.getAttribute('aria-selected')
        }))
      });

      if (selected) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const paged = pageList(button);
        watchPaging();
        console.debug(LOG, 'reviews tab: asked the list for the next page', { tab: reviewsTab, ...paged });
        return;
      }

      console.debug(LOG, 'overview: sent to the list', { tab: reviewsTab });
      delete button.__jsaction;
      button.setAttribute('jsaction', 'pane.reviewChart.moreReviews');
    }, true);

    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  watch();

  // The server's sign of a limited session: the see-more button, or the
  // limited-view notice that this script hides. Either is enough.
  window.__GM_REVIEWS__ = {
    limited: () => !!document.querySelector(`[${MARK}]`) || (!!seeMore
      && [...document.querySelectorAll('button, [role="button"]')]
        .some((b) => norm(b.getAttribute('aria-label') || b.textContent).startsWith(norm(seeMore))))
  };

  const tell = (message) => {
    try { window.postMessage({ source: 'gm-native-maps', ...message }, location.origin); } catch (_) {}
  };

  // The server's sign of a limited session is the see-more button itself.
  // It is reported only when seen, and only once per load. A page that never
  // shows it stays silent, which the background reads as not limited.
  let stateSent = false;
  let rollOn = false;

  function reportState() {
    if (stateSent || !rollOn || !seeMore) return;
    if (!window.__GM_REVIEWS__.limited()) return;
    stateSent = true;

    console.debug(LOG, 'this session is limited');
    tell({ type: 'gm-reviews-state', limited: true, url: location.href });
  }

  setInterval(reportState, 1000);

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== 'gm-native-maps' || data.type !== 'gm-settings') return;

    reviewsOn = !!data.features?.reviews;
    rollOn = !!data.features?.reviewroll;
    if (reviewsOn) hideNotice();
    else showNotice();
  });
})();
