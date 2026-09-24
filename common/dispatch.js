// Looks the message up, checks the switch, and runs the handler. An unknown
// type and a switched-off feature are both silence.
async function handle(msg, tabId) {
  const entry = HANDLERS.get(msg.type);
  if (!entry) return;

  if (entry.feature && !await featureOn(entry.feature)) return;

  await entry.fn(msg, tabId);
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type) void handle(msg, sender.tab?.id);
  return undefined;
});

// Logs which switches are on, then lets each feature say whatever it wants
// said at startup. Runs when the extension is installed and when the
// browser starts.
async function announceReady() {
  const features = { ...FEATURES_OFF, ...(await browser.storage.local.get(FEATURES_KEY))[FEATURES_KEY] };
  const on = FEATURES.filter((f) => features[f.id]).map((f) => f.id);

  console.log(LOG, on.length
    ? `ready — ${on.join(' and ')} switched on`
    : 'ready — everything switched off, doing nothing until the toolbar says otherwise');

  for (const report of READY) await report(features);
}

browser.tabs.onRemoved.addListener((tabId) => {
  for (const forget of TAB_GONE) forget(tabId);
});

browser.runtime.onInstalled.addListener(announceReady);
browser.runtime.onStartup.addListener(announceReady);
