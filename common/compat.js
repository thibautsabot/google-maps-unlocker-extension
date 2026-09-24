// Chrome defines only chrome.*, and its MV3 APIs return promises already,
// so the rest of the extension can go on saying browser.* everywhere.
globalThis.browser = globalThis.browser || globalThis.chrome;
