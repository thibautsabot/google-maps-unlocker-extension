(() => {
  'use strict';

  // Two jobs on the page, both visual.
  //
  //   hide the sign-in prompts around the photo grid
  //   show the short note the background sends after a swap that worked
  //
  // A block is hidden only when all of these hold:
  //   a real grid is on screen — five tiles or more, not the photo viewer's strip
  //   a single photo is not open
  //   the block sits inside the grid or just after it
  //   it has a control and a little text, and no photo of its own
  //   it is small — the place drawer also has buttons, and hiding that is worse

  const LOG = '[GM-GALLERY-UI]';

  // --- the note after a swap that worked -------------------------------------

  const TOAST_MS = 7000;
  let toastBox = null;

  // One stack, bottom-left, reused for every note. Recreated if Maps has
  // replaced the document underneath it.
  function toastArea() {
    if (toastBox?.isConnected) return toastBox;

    toastBox = document.createElement('div');
    toastBox.style.cssText = [
      'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483647',
      'display:flex', 'flex-direction:column', 'gap:8px',
      'max-width:360px', 'pointer-events:none',
      'font:13px/1.45 Roboto, Arial, sans-serif'
    ].join(';');

    document.body.appendChild(toastBox);
    return toastBox;
  }

  function toast(text) {
    const area = toastArea();

    const note = document.createElement('div');
    note.textContent = text;
    note.style.cssText = [
      'background:rgba(32,33,36,0.96)', 'color:#fff',
      'padding:10px 14px', 'border-radius:8px',
      'box-shadow:0 2px 10px rgba(0,0,0,0.3)',
      'opacity:0', 'transform:translateY(6px)',
      'transition:opacity .18s ease, transform .18s ease'
    ].join(';');

    area.appendChild(note);
    requestAnimationFrame(() => {
      note.style.opacity = '1';
      note.style.transform = 'translateY(0)';
    });

    while (area.children.length > 4) area.firstElementChild.remove();

    setTimeout(() => {
      note.style.opacity = '0';
      note.style.transform = 'translateY(6px)';
      setTimeout(() => note.remove(), 250);
    }, TOAST_MS);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.source === 'gm-native-maps' && data.type === 'gm-toast' && data.text) {
      try { toast(data.text); } catch (_) {}
    }
  }, false);

  window.GMGalleryToast = toast;

  // --- finding the photo grid ------------------------------------------------

  // Every host Maps serves grid imagery from. Matching only googleusercontent
  // made panorama tiles invisible here, which let the hiding rules treat a
  // block holding a panorama as a prompt.
  const PHOTO_HOSTS = /googleusercontent\.com|streetviewpixels|ggpht\.com|gstatic\.com/;
  const HIDDEN = 'data-gmnx-hidden';

  const lower = (text) => (text || '').toLowerCase();

  // The element that actually paints a photo, which may be the node itself
  // or a child. Maps uses a background image, not an img.
  function photoLayer(node) {
    if (PHOTO_HOSTS.test(lower(node.style?.backgroundImage))) return node;
    for (const child of node.querySelectorAll('*')) {
      if (PHOTO_HOSTS.test(lower(child.style?.backgroundImage))) return child;
    }
    return null;
  }

  // The masonry grid: the parent that holds the most absolutely placed
  // photo boxes. Fewer than two is not a grid. Returns null when there is
  // nothing that shape on the page.
  function findGrid() {
    const placed = [...document.querySelectorAll('[style*="top"][style*="left"]')]
      .filter((node) => {
        const style = node.style;
        return style.left && style.top && style.width && style.height && photoLayer(node);
      });
    if (placed.length < 2) return null;

    const groups = new Map();
    for (const node of placed) {
      const parent = node.parentElement;
      if (!parent) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(node);
    }

    const [container, nodes] = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)[0] || [];
    if (!container || nodes.length < 2) return null;

    return { container, tiles: nodes };
  }

  const hide = (node, why) => {
    node.setAttribute(HIDDEN, why);
    node.style.setProperty('display', 'none', 'important');
  };

  // --- the sign-in prompts ---------------------------------------------------

  // Hides the prompts and leaves everything else. The filters are what make
  // it safe to look both inside the grid and among the siblings after it:
  // Google has used both positions.
  function hideGateBlocks(container, tiles) {
    const siblings = [...(container.parentElement?.children || [])];
    const after = siblings.slice(siblings.indexOf(container) + 1);
    const candidates = [...container.children, ...after];

    for (const node of candidates) {
      if (node.hasAttribute(HIDDEN)) continue;
      if (tiles.some((tile) => node.contains(tile))) continue;
      if (PHOTO_HOSTS.test(node.innerHTML) || node.querySelector('img')) continue;
      if (!node.querySelector('button,[role="button"],a[href]')) continue;

      // One small block with one control. The place drawer has buttons and
      // little text too, and hiding it is far worse than leaving a prompt.
      if (node.querySelectorAll('button,[role="button"],a[href]').length > 3) continue;
      if (node.getBoundingClientRect().height > 260) continue;

      const text = node.textContent.trim();
      if (!text || text.length > 300) continue;

      hide(node, text.slice(0, 80));
    }
  }

  // One pass. Does nothing unless a real gallery is on screen: two tiles is
  // also what the single-photo viewer's thumbnail strip looks like, and
  // hiding that strip's neighbours takes the place drawer with it.
  function tidy() {
    const grid = findGrid();
    if (!grid || grid.tiles.length < 5) return;
    if (window.__GM_GALLERY__?.viewerOnly) return;

    hideGateBlocks(grid.container, grid.tiles);
  }

  // --- running ---------------------------------------------------------------

  let pending = 0;

  // Maps re-renders the grid as the pane scrolls, so this runs often. A
  // second call while one is already waiting does not schedule another.
  const schedule = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = 0;
      try { tidy(); } catch (error) { console.warn(LOG, 'tidy failed', error); }
    }, 200);
  };

  // Starts once the feature is on. The observer is what catches a prompt
  // that appears long after the gallery reply.
  function start() {
    window.addEventListener('GM_GALLERY_READY', schedule);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
  }

  // Puts back everything this file hid. Returns how many blocks that was.
  window.GMGalleryUI = {
    unhide() {
      const nodes = [...document.querySelectorAll(`[${HIDDEN}]`)];
      for (const node of nodes) {
        node.style.removeProperty('display');
        node.removeAttribute(HIDDEN);
      }
      return nodes.length;
    }
  };

  let running = false;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== 'gm-native-maps' || data.type !== 'gm-settings') return;
    if (!data.features?.photos || running) return;

    running = true;
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
})();
