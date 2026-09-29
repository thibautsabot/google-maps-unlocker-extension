# Unlocker — for Google Maps™

**Google Maps, with the "sign in to see more" wall knocked down.**

You look up a restaurant. Half the photos are missing. The opening hours are
folded shut. You tap *More reviews* and a sign-in box lands in your face.

Not anymore. Pick the blockers you want gone, right from the toolbar.

---

## What you get

### Full opening hours
Click the hours and the whole week opens. No sign-in.

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
- The tab reloads by itself, sometimes more than once. That's it working.
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

For **Firefox 140+**.

1. Download or clone this repository.
2. Open `about:debugging` in Firefox, then **This Firefox**.
3. Click **Load Temporary Add-on** and pick `manifest.json`.
4. Click the toolbar icon, flip the switches you want, and reload Maps.
5. If private-window access is off, the popup detects it and offers **Open extension settings**. The browser requires you to enable it there yourself.

Firefox forgets temporary add-ons on restart, so load it again next time.

---

## Good to know

- It shows what Google already sends anonymous visitors, nothing more.
- Google redesigns Maps now and then. A big change can break a feature
  until the extension is updated.
- Not affiliated with or endorsed by Google (obviously).

---

*[Privacy policy](PRIVACY.md) · Developers: technical notes and tests are in [`README.txt`](README.txt).*
