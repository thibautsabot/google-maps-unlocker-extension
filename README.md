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
Search the reviews, sort them, open the full list.

### Full photos and reviews
**Why you need it.** Every time you open Maps, Google gives your browser a
session, and the session decides how much you see. A **full session** shows
everything. A **limited session** shows only 10 photos, then stops.

**What it does, in order.**
1. **Fills the gallery in the page.** When the first photo page comes back
   capped, the extension asks Google for the next pages itself, using the
   token Google already sent, merges them, and hands Maps the longer list.
   Maps then keeps paging as you scroll. No reload, no cookie touched. The
   token and the "limited" flag are found by their shape in Google's reply
   rather than by fixed position, so small layout changes do not break it. Pages
   Maps asks for on its own are left alone.
2. **Falls back to a full session.** If the fill fails, or Maps does not
   page on after it, it borrows a full session from a private window and
   reloads the tab. It checks the gallery
   again and tries another session if needed, up to five times. A full
   session that works is remembered.

**What to expect.**
- Step 1 is silent. Step 2 reloads the tab, sometimes more than once.
- Some places stay limited whoever asks. It stops after five tries instead of
  reloading forever.

Only step 2 changes cookies. The toolbar asks you to agree first. It reads
and replaces Google cookies, and saves a working set locally for reuse. This
signs you out of Google in that browser. Turn the switch off to withdraw
consent; turning it on again asks again.

---

## Private by design

- **No server, no account, no analytics.** There is nothing to gather here.
- **It only runs on Google Maps pages.**
- **Permissions:** `cookies` and `storage`, plus host access to the 187 Google domains in the supported-domains list captured by this release. The build enumerates them because browser match patterns cannot wildcard TLDs; refreshing the list requires a new build and release.
  Cookies are only touched by *Full photos and reviews*, after you agree in
  the popup.
- **Nothing runs until you turn it on.** Each feature has its own switch in
  the toolbar. Use one, two or all three.

---

## Install

Works in **Firefox 142+** and **Chromium 111+** browsers (Chrome, Edge, Brave, Vivaldi, Opera).

Install from the [Firefox add-on page](https://addons.mozilla.org/en-US/firefox/addon/unlocker-for-google-maps/) or the [Chrome Web Store](https://chromewebstore.google.com/detail/unlocker-%E2%80%94-for-google-map/jekkpekmgniicmbhnpejageopllocbea). To run from source instead, build the packages once, from a checkout of this repository:

```
node tools/build.mjs
```

That writes `dist/gm-native-maps-firefox-<version>.zip` and `dist/gm-native-maps-chromium-<version>.zip`. Node is the only requirement.

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

### Private windows

"Full photos and reviews" borrows a session from a private window, so the browser has to let the extension run there. If access is off, the popup says so and offers **Open extension settings**.

- **Firefox:** opens the extension's page in `about:addons`. Click **Details**, then set **Run in Private Windows** to **Allow**.
- **Chrome and Edge:** opens the extension's page in `chrome://extensions` or `edge://extensions`. Switch on **Allow in Incognito** (**Allow in InPrivate** in Edge).

The browser requires you to enable this yourself.

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
