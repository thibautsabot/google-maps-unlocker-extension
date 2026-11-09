# Unlocker — for Google Maps™

<p align="center">
  <a href="https://addons.mozilla.org/en-US/firefox/addon/unlocker-for-google-maps/"><img alt="Download for Firefox" src="https://img.shields.io/badge/Download%20for-Firefox-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white"></a>
  <a href="https://chromewebstore.google.com/detail/unlocker-%E2%80%94-for-google-map/jekkpekmgniicmbhnpejageopllocbea"><img alt="Download for Chrome" src="https://img.shields.io/badge/Download%20for-Chrome-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white"></a>
</p>

**Google Maps, with the "sign in to see more" wall knocked down.**

You look up a restaurant. Half the photos are missing. The opening hours are not available. You tap *More reviews* and a sign-in box lands in your face.

Not anymore. Remove the blockers, right from the toolbar.

---

## What you get

### Full opening hours
Click the hours and the whole week opens. Google sometimes sends only today's
hours with the page. When that happens the extension asks for the place again
and hands Maps the full reply, so nothing reloads and no cookie is touched.

### Review search and filters
Search and sort reviews, and open the review list without the sign-in prompt. The *More reviews* button on the Reviews tab is hidden: the list loads as you scroll, like a signed-in session.
Signed out, Google sends five reviews and no way to continue. The extension gets as close to a signed-in list as the server allows, in this order:

1. **The list itself.** The review call accepts a row offset, so the following rows are asked for as you scroll, in the sort, search or topic you picked. Default and newest reach the whole list.
2. **A bigger page.** How deep *highest* and *lowest* go grows with the page size, and the server refuses more than 20, so 20 is asked for.
3. **Google's topic chips**, the words under the Sort button ("macarons", "chocolates"). Only when highest or lowest has run out, each chip is asked for under the same sort, which reaches reviews past where that sort stops.
4. **Words from the reviews on screen**, searched under the same sort, for whatever the chips did not reach.

A step only starts when the one before has nothing left, and a review is never shown twice. No cookie is read and nothing is signed in.

**What to expect.** On a test place with 949 reviews, the default list reached all 949, in the same order a signed-in session shows. *Highest* and *lowest* reach part of the list (324 of 949 with chips and words), in order for the first 163. Loading everything takes many requests, three at a time per scroll. Topic chips appear on only some place replies, so a place without them goes from the rows straight to words.

### Full photos
Without signing in, Google gives the first page of a gallery 10 photos and
marks the list as limited. It still serves the pages after it when asked, but
Maps stops asking.

The extension replays capped requests in batches of 10 and follows Google's
continuation tokens. Asking for 20 can advance past photos Google did not
return. It merges consecutive batches and clears the "limited" mark so Maps
keeps loading as you scroll. Nothing reloads, no cookie is touched, and requests
go only to Google.

**What to expect.**
- A signed-out test recovered 108 distinct photos where size-20 requests
  recovered 58, matching the signed-in gallery count. Google's announced total
  can differ from the number of pageable photos.
- The token and the "limited" mark are found by their shape in Google's reply
  rather than by fixed position, so small layout changes do not break it.
- Google redesigns Maps now and then. A big change can break this until the
  extension is updated.

**Why not fake a signed-in session?** Google validates SID-family login cookies
server-side. In our tests, a valid Google-issued `__Secure-3PSID` enabled larger
batches; copying it replayed an existing session, not a new one. Pagination-token
edits did not lift that limit, and no way to forge valid login cookies was found.
The extension instead uses size-10 pagination and handles no login credentials.

---

## Private by design

- **No server, no account, no analytics.** There is nothing to gather here.
- **It only runs on Google Maps pages.**
- **Permissions:** `storage`, to remember your switches, plus host access to the 187 Google domains in the supported-domains list captured by this release. The build enumerates them because browser match patterns cannot wildcard TLDs; refreshing the list requires a new build and release.
  The extension reads and writes no cookie and needs no access to private windows.
- **Feature changes are off by default.** Each has its own toolbar switch.
  Payload inspection and Maps-script discovery can still run while switches
  are off; disabled features do not unlock or hide content.

---

## Install

Works in **Firefox 142+** and **Chromium 111+** browsers (Chrome, Edge, Brave, Vivaldi, Opera).

Install from the [Firefox add-on page](https://addons.mozilla.org/en-US/firefox/addon/unlocker-for-google-maps/) or the [Chrome Web Store](https://chromewebstore.google.com/detail/unlocker-%E2%80%94-for-google-map/jekkpekmgniicmbhnpejageopllocbea). To run from source instead, build the packages once, from a checkout of this repository:

```
node tools/build.mjs
```

That writes `dist/gm-native-maps-firefox-<version>.zip` and `dist/gm-native-maps-chromium-<version>.zip`. Requires Node and the `zip` command.

### Firefox

1. Open `about:debugging` and choose **This Firefox**.
2. Click **Load Temporary Add-on** and pick `dist/gm-native-maps-firefox-<version>.zip` (or `manifest.json` from a checkout).
3. Click the toolbar icon, flip the switches you want, and reload Maps.

Firefox forgets temporary add-ons on restart, so load it again next time.

### Chrome, Edge, Brave, Vivaldi, Opera

1. Unzip `dist/gm-native-maps-chromium-<version>.zip` into a folder you will keep.
2. Open `chrome://extensions` (`edge://extensions` in Edge), switch on **Developer mode**, and click **Load unpacked**.
3. Pick the unzipped folder.
4. Click the toolbar icon, flip the switches you want, and reload Maps.

Loaded this way there are no automatic updates. Rebuild and load the new folder to update.

---

## Good to know

- **Found a bug?** [Open an issue on GitHub](https://github.com/thibautsabot/google-maps-unlocker-extension/issues). Please report problems there, not in store reviews.
- It shows what Google already sends anonymous visitors, nothing more.
- Google redesigns Maps now and then. A big change can break a feature
  until the extension is updated.
- Not affiliated with or endorsed by Google.
- Google Maps is a trademark of Google LLC. Use of this trademark is subject to Google Permissions.

---

* [Privacy policy](PRIVACY.md) · Technical notes and tests: `node tests/run.mjs`.
* Locale coverage uses [Google's supported domains](https://www.google.com/supported_domains). Match patterns enumerate them explicitly because browser extensions cannot wildcard top-level domains.
