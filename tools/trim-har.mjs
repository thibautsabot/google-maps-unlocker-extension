// Trims a HAR down to what is needed to study the photo gallery, and removes
// anything that identifies an account. Usage:
//
//   node tools/trim-har.mjs capture.har trimmed.har
//
// Kept: batchexecute hspqX (the gallery) and /maps/preview/place calls.
// Dropped: every other entry, all cookies, every header except content-type,
// and the secrets inside the request: the `at` token, `f.sid` and `bl`.
// Reply bodies are kept whole: they hold photo URLs, which are public.

import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node tools/trim-har.mjs <in.har> <out.har>');
  process.exit(1);
}

const har = JSON.parse(readFileSync(input, 'utf8'));
const entries = har.log?.entries || [];

const wanted = (url) => /batchexecute\?[^#]*rpcids=hspqX/.test(url) || url.includes('/maps/preview/place?');

const SECRET_PARAMS = ['at', 'f.sid', 'bl'];

// Replaces the value of each secret parameter in a query string or form body.
const scrub = (text) => String(text ?? '').replace(
  new RegExp(`(^|[?&])(${SECRET_PARAMS.map((p) => p.replace('.', '\\.')).join('|')})=[^&]*`, 'g'),
  '$1$2=REDACTED'
);

const contentType = (headers) => (headers || []).filter((h) => h.name.toLowerCase() === 'content-type');

const kept = entries.filter((e) => wanted(e.request?.url || '')).map((e) => ({
  startedDateTime: e.startedDateTime,
  time: e.time,
  request: {
    method: e.request.method,
    url: scrub(e.request.url),
    httpVersion: e.request.httpVersion,
    headers: contentType(e.request.headers),
    cookies: [],
    queryString: [],
    headersSize: -1,
    bodySize: e.request.bodySize,
    ...(e.request.postData ? {
      postData: { mimeType: e.request.postData.mimeType, text: scrub(e.request.postData.text) }
    } : {})
  },
  response: {
    status: e.response.status,
    statusText: e.response.statusText,
    httpVersion: e.response.httpVersion,
    headers: contentType(e.response.headers),
    cookies: [],
    content: e.response.content,
    redirectURL: '',
    headersSize: -1,
    bodySize: e.response.bodySize
  },
  cache: {},
  timings: e.timings
}));

const trimmed = { log: { version: '1.2', creator: har.log?.creator, entries: kept } };
writeFileSync(output, JSON.stringify(trimmed, null, 2));

// Anything that still looks like a credential stops the script from calling
// the result clean. Checked on the output, not assumed.
const text = JSON.stringify(trimmed);
const leaks = [
  /SAPISID|APISID|__Secure-[13]P?SID|SSID=|HSID/i,
  /authorization/i,
  /[?&]at=(?!REDACTED)/,
  /set-cookie/i
].filter((re) => re.test(text));

console.log(`kept ${kept.length} of ${entries.length} entries`);
if (leaks.length) {
  console.error('WARNING: output may still hold credentials:', leaks.map(String).join(', '));
  process.exit(2);
}
console.log('no credential markers found in the output');
