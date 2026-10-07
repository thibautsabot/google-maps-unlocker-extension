// Tabs waiting for a reload after a switch was changed.
//
// The panel closes when the user goes off to another tab, and starts again
// when it reopens, so what is waiting is kept in storage, not in the panel.
// A tab is cleared when its page says hello again, which it does on every
// load, and when the tab closes.

const RELOAD_PENDING_KEY = 'reloadPending';

async function forgetReloadPending(tabId) {
  try {
    const stored = await browser.storage.local.get(RELOAD_PENDING_KEY);
    const all = stored[RELOAD_PENDING_KEY];
    if (!all || !(tabId in all)) return;

    delete all[tabId];
    await browser.storage.local.set({ [RELOAD_PENDING_KEY]: all });
  } catch (_) {}
}

onTabGone((tabId) => { forgetReloadPending(tabId); });
