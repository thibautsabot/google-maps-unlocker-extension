// The background only clears manual reload prompts and obsolete storage.
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'gm-hello' && sender?.tab?.id != null) {
    void forgetReloadPending(sender.tab.id);
  }
  return undefined;
});

browser.tabs.onRemoved.addListener((tabId) => { void forgetReloadPending(tabId); });

async function clearLegacyStorage() {
  // Remove records left by private-session borrowing without touching cookies.
  try {
    await browser.storage.local.remove(['goodRoll', 'cookieConsentGoogleSessionSwap']);
  } catch (error) {
    console.warn('[GM]', `storage cleanup failed: ${error?.message || String(error)}`);
  }
}

browser.runtime.onInstalled.addListener(clearLegacyStorage);
browser.runtime.onStartup.addListener(clearLegacyStorage);
