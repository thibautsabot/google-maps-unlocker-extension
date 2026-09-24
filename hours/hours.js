(() => {
  'use strict';

  // Opens the full week of opening hours without asking Maps to do it.
  //
  // Maps renders the whole week but keeps it collapsed, and its own expand
  // handler is what raises the sign-in dialog. The click is intercepted and
  // the collapsing styles are undone here instead.
  //
  //   find the hours table
  //   find the control beside it that would expand it
  //   on that click, reveal or re-hide the rows ourselves

  let hoursOn = false;

  const LOG = '[GM-NATIVE]';
  const REVEALED = 'data-gmnx-hours';

  // Times as Maps writes them across locales: 10:00 and 10h00 and 10.00, but
  // also 12-hour forms with no separator at all (10 am–8 pm), and bare ranges.
  const TIME = /\d{1,2}\s*[:h.]\s*\d{2}|\d{1,2}\s*[ap]\.?\s?m\.?|\d{1,2}\s*[–—-]\s*\d{1,2}/i;

  // The week's table: five to nine rows, each with at least two cells, and
  // most of those rows containing a time.
  function findHoursTable() {
    for (const table of document.querySelectorAll('table')) {
      const rows = [...table.rows];
      if (rows.length < 5 || rows.length > 9) continue;
      if (!rows.every((row) => row.cells.length >= 2)) continue;

      const timed = rows.filter((row) => TIME.test(row.textContent || '')).length;
      if (timed >= Math.max(3, rows.length - 2)) return table;
    }
    return null;
  }

  // The summary that expands the hours, searched a few levels out from the
  // table rather than across the whole page.
  function findHoursToggle(table) {
    let scope = table.parentElement;

    for (let level = 0; scope && level < 4; scope = scope.parentElement, level++) {
      const found = [...scope.querySelectorAll('[aria-expanded]')]
        .find((node) => !node.contains(table) && TIME.test(node.textContent || ''));
      if (found) return found;
    }
    return null;
  }

  // Forcing "block" onto a table or a row group destroys table layout and the
  // rows stop rendering, so each element gets the display its own tag needs.
  const DISPLAY = {
    TABLE: 'table', THEAD: 'table-header-group', TBODY: 'table-row-group',
    TFOOT: 'table-footer-group', TR: 'table-row', TD: 'table-cell', TH: 'table-cell'
  };

  // Which of the three ways Maps hides a node apply to this one. A collapsed
  // wrapper uses display, but the animated one is simply transparent.
  // Checking only display left a correctly sized, fully invisible block.
  const hidden = (node) => {
    const style = getComputedStyle(node);
    return {
      display: style.display === 'none',
      visibility: style.visibility === 'hidden',
      opacity: parseFloat(style.opacity) < 0.05
    };
  };

  function unhide(node, name, fallback) {
    const previous = [node.style.getPropertyValue(name), node.style.getPropertyPriority(name)];
    node.style.removeProperty(name);

    if (hidden(node)[name]) node.style.setProperty(name, fallback, 'important');
    return previous;
  }

  function setHoursOpen(table, open) {
    let changed = 0;

    for (let node = table; node && node !== document.body; node = node.parentElement) {
      if (open) {
        const problems = hidden(node);
        const previous = {};

        if (problems.display) {
          previous.display = unhide(node, 'display', DISPLAY[node.tagName] || 'block');
        }
        if (problems.visibility) previous.visibility = unhide(node, 'visibility', 'visible');
        if (problems.opacity) previous.opacity = unhide(node, 'opacity', '1');

        if (!Object.keys(previous).length) continue;

        const style = getComputedStyle(node);
        const tucked = {};
        if (parseFloat(style.marginTop) < 0) tucked['margin-top'] = '0px';
        if (parseFloat(style.marginLeft) > 0) tucked['margin-left'] = '0px';

        for (const [name, value] of Object.entries(tucked)) {
          previous[name] = [
            node.style.getPropertyValue(name),
            node.style.getPropertyPriority(name)
          ];
          node.style.setProperty(name, value, 'important');
        }
        node.setAttribute(REVEALED, JSON.stringify(previous));
        changed++;
      } else if (node.hasAttribute(REVEALED)) {
        let previous = {};
        try { previous = JSON.parse(node.getAttribute(REVEALED)) || {}; } catch (_) {}

        for (const [name, [value, priority]] of Object.entries(previous)) {
          node.style.removeProperty(name);
          if (value) node.style.setProperty(name, value, priority || '');
        }

        node.removeAttribute(REVEALED);
        changed++;
      }
    }
    return changed;
  }

  // True once this file has revealed the hours. Maps' own aria-expanded is
  // not the source of truth: we set it ourselves after the styles change.
  const hoursAreOpen = () => !!document.querySelector(`[${REVEALED}]`);

  // Captures the click in the capture phase, before Maps' handler, and only
  // when it lands on the hours control. Every other click is left alone.
  function interceptHoursToggle() {
    window.addEventListener('click', (event) => {
      if (!hoursOn) return;

      const table = findHoursTable();
      if (!table) return;

      const toggle = findHoursToggle(table);
      if (!toggle || !event.target?.closest) return;
      if (!toggle.contains(event.target) && event.target.closest('[aria-expanded]') !== toggle) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const open = !hoursAreOpen();
      setHoursOpen(table, open);
      toggle.setAttribute('aria-expanded', String(open));
      console.debug(LOG, open ? 'opened hours' : 'closed hours');
    }, true);
  }

  // The listener is installed once. hoursOn stays live, so switching the
  // feature off takes effect on the next click instead of waiting for a reload.
  let installed = false;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== 'gm-native-maps' || data.type !== 'gm-settings') return;

    hoursOn = !!data.features?.hours;
    if (!hoursOn || installed) return;

    installed = true;
    if (document.body) interceptHoursToggle();
    else document.addEventListener('DOMContentLoaded', interceptHoursToggle, { once: true });
  });
})();
