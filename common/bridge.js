// Hands the page its settings, and tells the background a page has loaded.
//
// The scripts that change Maps run in the page's own world, where extension
// APIs are unreachable. Storage is read here, in the extension's world.

const LOG = '[GM-RELAY]';

// Chrome stops the background when idle and starts it again on demand. A
// message sent at document_start can land in the gap before it is running —
// "Receiving end does not exist", with nothing delivered. Sending again
// shortly after is what gets through, and since nothing arrived the first
// time there is nothing to deliver twice. Firefox's event page does not
// have the gap, so the retries cost it nothing.
const ASLEEP = /receiving end does not exist|could not establish connection/i;
const RETRIES = [150, 400, 1000];

// Forwards one message to the background, and retries while the background
// is still waking up. Any other failure is logged and dropped.
function send(message, attempt = 0) {
  try {
    const sending = browser.runtime.sendMessage(message);
    if (!sending?.catch) return;

    sending.catch((error) => {
      const reason = error?.message || String(error);

      if (ASLEEP.test(reason) && attempt < RETRIES.length) {
        setTimeout(() => send(message, attempt + 1), RETRIES[attempt]);
        return;
      }

      console.warn(LOG, `the background script did not take ${message.type}:`, reason);
    });
  } catch (error) {
    console.warn(LOG, `could not reach the background script with ${message.type}:`, error);
  }
}

try {
  console.log(LOG, `relay ready, extension ${browser.runtime.getManifest().version}`);
} catch (_) {}

// Hands the page the feature switches. The page world cannot read extension
// storage, so it is read here — and handed over again when the popup changes
// it, so a tab already open is not left acting on a setting that has since
// been turned off.
function publishFeatures(features) {
  try {
    window.postMessage({ source: 'gm-native-maps', type: 'gm-settings', features }, location.origin);
  } catch (_) {}
}

async function publishStoredFeatures() {
  const stored = await browser.storage.local.get(FEATURES_KEY);
  publishFeatures({ ...FEATURES_OFF, ...stored[FEATURES_KEY] });
}

publishStoredFeatures()
  .catch((error) => console.warn(LOG, 'could not read which switches are on', error));

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[FEATURES_KEY]) return;
  publishStoredFeatures()
    .catch((error) => console.warn(LOG, 'could not update which switches are on', error));
});

// Tells the background this tab has loaded, which clears the popup's reload
// prompt for it.
send({ type: 'gm-hello', url: location.href });
