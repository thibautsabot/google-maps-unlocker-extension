# Unlocker — for Google Maps™

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
everything: all the photos, every review, page after page. A **limited
session** shows only few photos and reviews, then stops.

**What it does.** It notices when you got a limited session, borrows a full
one from a private window, and reloads the tab. Then it checks that the
gallery and reviews are complete. If they aren't, it tries another, up to
five times. A full session that works is remembered, so the next place you
open is already fine.

**What to expect.**
- The tab reloads by itself, sometimes more than once. That's expected.
- A short message tells you when it succeeded.
- Some places stay limited whoever asks. It stops after five tries instead of
  reloading forever.

Before it runs, the toolbar asks you to agree to the cookie change. It reads
and replaces Google cookies, and saves a working set locally for reuse. This
signs you out of Google in that browser. Turn the switch off to withdraw
consent; turning it on again asks again.

---

## Private by design

- **No server, no account, no analytics.** There is nothing to gather here.
- **It only runs on Google Maps pages.**
- **Permissions:** `cookies` and `storage`, plus access to `google.com`.
  Cookies are only touched by *Full photos and reviews*, after you agree in
  the popup.
- **Nothing runs until you turn it on.** Each feature has its own switch in
  the toolbar. Use one, two or all three.

---

## Install

Works in **Firefox 140+** and in Chromium browsers (Chrome, Edge, Brave, Vivaldi, Opera).

Build the packages once, from a checkout of this repository:

```
node tools/build.mjs
```

That writes `dist/gm-native-maps-firefox-1.0.3.zip` and `dist/gm-native-maps-chromium-1.0.3.zip`. Node is the only requirement.

### Firefox

1. Open `about:debugging` and choose **This Firefox**.
2. Click **Load Temporary Add-on** and pick the Firefox zip (or `manifest.json` from a checkout).
3. Click the toolbar icon, flip the switches you want, and reload Maps.

Firefox forgets temporary add-ons on restart, so load it again next time.

### Chrome, Edge, Brave, Vivaldi, Opera

1. Unzip `dist/gm-native-maps-chromium-1.0.3.zip` into a folder you will keep.
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

- It shows what Google already sends anonymous visitors, nothing more.
- Google redesigns Maps now and then. A big change can break a feature
  until the extension is updated.
- Not affiliated with or endorsed by Google (obviously).

---

*[Privacy policy](PRIVACY.md) · Developers: technical notes and tests are in [`README.txt`](README.txt).*
