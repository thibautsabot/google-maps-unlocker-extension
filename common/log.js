const LOG = '[GM-ROLL]';

async function tell(tabId, text, quiet) {
  console.log(LOG, text);
  if (tabId == null) {
    console.warn(LOG, 'no tab to send toast to; message not delivered to page');
    return;
  }

  try {
    await browser.tabs.sendMessage(tabId, { type: 'gm-roll-log', text, quiet });
  } catch (error) {
    console.warn(LOG, `tab ${tabId} did not accept toast "${text}":`, error?.message || error);
  }
}

// Console only. Used for the running account of what was decided and why.
const say = (tabId, text) => tell(tabId, text, true);

// Console and the note on the page. Used once a swap has turned out to be
// worth announcing, and not before.
const toast = (tabId, text) => tell(tabId, text, false);
