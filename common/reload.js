// Tabs waiting for a reload after a switch was changed. Clear on page hello
// or tab removal. Keep the map schema for popups and existing installations.
const RELOAD_PENDING_KEY = 'reloadPending';
let reloadCleanup = Promise.resolve();

function forgetReloadPending(tabId) {
  // Avoid lost deletions from overlapping events in this background context.
  // Storage read/modify/write is not atomic across separate popup contexts.
  reloadCleanup = reloadCleanup.then(async () => {
    const stored = await browser.storage.local.get(RELOAD_PENDING_KEY);
    const all = stored[RELOAD_PENDING_KEY];
    if (!all || !(tabId in all)) return;

    delete all[tabId];
    await browser.storage.local.set({ [RELOAD_PENDING_KEY]: all });
  }).catch(() => {});
  return reloadCleanup;
}
