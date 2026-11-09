# Publishing checklist

Build the packages first:

    node tools/build.mjs

That writes `dist/gm-native-maps-firefox-<version>.zip` and
`dist/gm-native-maps-chromium-<version>.zip`. Use the Firefox one for Firefox,
the Chromium one for Chrome, Edge, Brave, Vivaldi and Opera.

Paste `store/REVIEWER-NOTES.md` into each store's reviewer-notes field.

## Before any store

- [ ] Put this line in every store description: `Google Maps is a trademark of Google LLC. Use of this trademark is subject to Google Permissions. This extension is not affiliated with or endorsed by Google.` Chrome's branding rules require the attribution when the name mentions Google Maps. The README includes the same attribution.
- [ ] Read `PRIVACY.md` and `store/REVIEWER-NOTES.md` against current store forms. No feature touches cookies. The photo and opening-hours features make normal requests to Google.

- [x] Use provided logo at `icons/icon-128.png`, with generated 16, 32 and 48 px toolbar variants.
- [ ] Take 1-5 screenshots at 1280x800: opening hours open, review search working, the toolbar panel. Capture actual browser UI; no mockups.
- [ ] Publish `PRIVACY.md` at a public URL (the GitHub file URL works) and paste it in the store forms.
- [ ] Set the support URL to the GitHub issues page.

## Firefox (AMO), free

1. Create an account at addons.mozilla.org/developers.
2. Submit a new add-on, choose **On this site** (listed) and upload the Firefox zip.
3. Extension ID in the manifest is `@gm-native-maps`. It cannot be changed after the first release.
4. Data collection is declared as `none` in the manifest. Minimum Firefox version is 142 because Firefox for Android added support for `data_collection_permissions` in that release.
5. Category: Travel. Add the reviewer notes. Expect a review of a few days.

## Chrome Web Store, $5 once

1. Register at chrome.google.com/webstore/devconsole and pay the one-time fee.
2. Upload the Chromium zip.
3. In the Privacy tab, disclose that the extension reads Google Maps page content to show it, and that nothing is sent to the developer or other third parties. There is no cookie or authentication handling to disclose. Match the dashboard choices to the feature's actual behavior.
4. Permissions are `storage` and host access to the Google domains. A change from the earlier version is that `cookies` and `incognito` are gone, so the listing and the permission justifications need updating.

## Edge Add-ons, free

1. Register at partner.microsoft.com/dashboard/microsoftedge.
2. Upload the same Chromium zip and reuse the Chrome store text.

## Brave, Vivaldi, Opera

Brave and Vivaldi install from the Chrome Web Store, so there is nothing to do.
Opera has its own store at addons.opera.com, which also takes the Chromium zip.

## Safari, $99 per year

Needs a Mac with Xcode. Run `xcrun safari-web-extension-converter dist/<unzipped chromium folder>`
and follow the Xcode steps. Not tested. Do it last, if at all.

## Every release

1. Bump the version in `manifest.json`. README install instructions use `<version>` placeholders and need no version edit.
2. `node tests/run.mjs`
3. `node tools/build.mjs`
4. Upload the new zips.
