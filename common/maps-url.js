// Google Maps page URL recognition shared by popup UI and tests.
function isGoogleMapsUrl(value) {
  try {
    const url = new URL(value);
    const googleHost = /^(?:[a-z0-9-]+\.)*google\.(?:[a-z]{2,3}|[a-z]{2,3}\.[a-z]{2,3}|cat)$/i;
    return url.protocol === 'https:' && googleHost.test(url.hostname)
      // Content scripts match /maps/*, not bare /maps or /Maps/.
      && url.pathname.startsWith('/maps/');
  } catch (_) {
    return false;
  }
}
