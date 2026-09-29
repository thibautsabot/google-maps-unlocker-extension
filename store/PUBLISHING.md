# Publishing checklist

Build the packages first:

    node tools/build.mjs

That writes `dist/gm-native-maps-firefox-<version>.zip` and
`dist/gm-native-maps-chromium-<version>.zip`. Use the Firefox one for Firefox,
the Chromium one for Chrome, Edge, Brave, Vivaldi and Opera.

Paste `store/REVIEWER-NOTES.md` into each store's reviewer-notes field.

## Before any store

- [ ] Put this line in every store description: `Google Maps is a trademark of Google LLC. Use of this trademark is subject to Google Permissions. This extension is not affiliated with or endorsed by Google.` Chrome's branding rules require the attribution when the name mentions Google Maps.
- [ ] Read `PRIVACY.md` and `store/REVIEWER-NOTES.md` against current store forms. This extension handles authentication cookies locally. The popup asks for explicit consent before enabling the feature; store disclosures do not replace that consent.

- [x] Use provided logo at `icons/icon-128.png`, with generated 16, 32 and 48 px toolbar variants.
- [ ] Take 1-5 screenshots at 1280x800: opening hours open, review search working, the toolbar panel.
- [ ] Publish `PRIVACY.md` at a public URL (the GitHub file URL works) and paste it in the store forms.
- [ ] Set the support URL to the GitHub issues page.

## Firefox (AMO), free

1. Create an account at addons.mozilla.org/developers.
2. Submit a new add-on, choose **On this site** (listed) and upload the Firefox zip.
3. Extension ID in the manifest is `@gm-native-maps`. It cannot be changed after the first release.
4. Data collection is already declared as `none` in the manifest.
5. Category: Travel. Add the reviewer notes. Expect a review of a few days, and source review since it reads cookies.

## Chrome Web Store, $5 once

1. Register at chrome.google.com/webstore/devconsole and pay the one-time fee.
2. Upload the Chromium zip.
3. In the Privacy tab, disclose local handling of Google authentication cookies, Maps page content and browsing activity. Explain that cookie handling is necessary for the full-gallery feature, happens only after an in-product consent action, and is not sent to the developer or other third parties. Maps receives its ordinary requests. Match the dashboard choices to the feature's actual behavior; don't claim "no user data handled" merely because it stays local.
4. The popup detects whether private-window access is enabled and shows an **Open extension settings** shortcut if it is not. The user must grant this browser-controlled permission manually.
5. Expect a manual review because of the `cookies` permission. It may be refused. If so, see the fallback below.

## Edge Add-ons, free

1. Register at partner.microsoft.com/dashboard/microsoftedge.
2. Upload the same Chromium zip and reuse the Chrome store text.

## Brave, Vivaldi, Opera

Brave and Vivaldi install from the Chrome Web Store, so there is nothing to do.
Opera has its own store at addons.opera.com, which also takes the Chromium zip.

## Safari, $99 per year

Needs a Mac with Xcode. Run `xcrun safari-web-extension-converter dist/<unzipped chromium folder>`
and follow the Xcode steps. Not tested. Do it last, if at all.

## If Chrome refuses it

Ship it from GitHub instead:

- **Chrome/Edge/Brave:** attach the Chromium zip to a GitHub release. Users unzip it, open `chrome://extensions`, switch on Developer mode and use **Load unpacked**. There are no automatic updates.
- **Firefox:** on AMO choose **On your own** (unlisted). Mozilla signs the file and you attach the `.xpi` to a release. Signed unlisted add-ons update only if you host an update manifest.

## Every release

1. Bump the version in `manifest.json` and the first line of `README.txt`.
2. `node tests/run.mjs`
3. `node tools/build.mjs`
4. Upload the new zips.
