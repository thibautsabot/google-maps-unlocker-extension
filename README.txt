GM Native Maps — Photos & Opening Hours 11.2.0

Firefox WebExtension for Google Maps.


Switching it on
---------------
Both features are off when installed. The toolbar button opens a panel with
a switch for each.

Opening hours applies at once, in both directions: it is a click handler,
and it starts or stops the moment it is told. The photo side cannot, because
it works out what to do from the answer to a request the page has already
made — so it has nothing to act on until the page asks again. The panel
offers a button to reload the tab when that is what is needed.

Off means off: with neither switched on, no cookie is read or written, no
window is opened, no tab is reloaded, and nothing is logged. The photo
feature in particular replaces your Google cookies and reloads your tab,
which is not a thing to start doing to somebody who has merely installed an
extension.


What it does
------------
Two unrelated things, both about content Google already serves to anonymous
visitors but does not show you.

Opening hours: Maps renders the whole week but keeps it collapsed, and its own
expand handler is what raises the sign-in dialog. The extension intercepts the
click and undoes the collapsing styles itself. This just works, no commands.

Photos: Maps caps the gallery for some sessions. The extension notices and
lifts the cap by putting a session in place that is not capped, reloading the
page once, and telling you it did so.


The photo cap
-------------
Some sessions are capped and some are not, and it is decided when Google
issues the session — before any script on the page runs.

A capped session on Animalis Paris 3 (45 photos):

  the place page arrives carrying   15 photo URLs
  the gallery request asks for      20
  the server serves                 10
  the continuation token            returns nothing

The same place, same minute, in a private window:

  the place page arrives carrying   27 photo URLs
  no gallery request is made at all — Maps has what it needs

Two things follow from those numbers, and they shape the whole design.

The page itself already differs. The cap is not applied to the gallery request
when it is answered; it is settled when the document is requested. So nothing
done after the page starts loading can lift it. The session has to be right
before you navigate, and if it was not, the only remedy is to fix it and
reload.

Silence is the signature of success. An uncapped session is served its photos
with the page and never makes a gallery request at all, so "it worked" looks
like nothing happening. Everything below about verdicts exists because of
that: the extension has to prove a negative.


Why a private session
---------------------
Because it is the only reliable source of a session Google has not capped.

The cap travels with the cookies. Copy a private window's Google cookies into
the normal jar and the cap lifts there too — measured: the same place, in the
same minute, going from 15 photo URLs in the page to 25.

What does not work is asking Google for a new ordinary session. Deleting
cookies, clearing site data, using a fresh container: all of them get you a
replacement session, and the replacement is capped about as often as the one
you threw away. Whose cookies they are is what counts, not whether you have
any. Private browsing is the one context that reliably comes back uncapped.

So the extension opens a private window minimised, waits for Google to issue
cookies there, copies them into the normal jar, saves them, and closes the
window again. The window exists only to be issued an identity.

One consequence worth knowing: all private windows share a single cookie jar,
and Firefox only mints a new private session once the last one closes. If you
have a private window open, every borrow hands back the same identity — which,
if it was capped, means rolling again changes nothing. The extension
recognises a session it has already seen capped, empties the private jar
itself so Google issues a new one, and says so if it still comes back the
same.


Three states, not two
---------------------
A page can come back capped, uncapped, or so thin it cannot open the gallery
at all — three or four photos and no request. That third state is what you
get after clearing cookies, and it is silent, which is also what success
looks like. Only the photo count separates them:

  uncapped     25 or more photo URLs in the page, no gallery request
  capped       15 in the page, a gallery request answered with 10 of 45
  thin         2 to 4, no gallery request, no gallery to open

A photo view is a fourth thing and is not judged at all. When Maps has a
photo open the address carries the camera — ",3a," beside the coordinates —
and the page holds about two photo URLs however good the session is. Counting
there measures the viewer, so the extension says "cannot tell yet" and leaves
the session alone rather than blaming it.


What happens when a page is capped
----------------------------------
No command needed. In order:

  1. The page reports what it was served, and the background script says
     whether that counts as capped. Capped means the server sent fewer photos
     than Maps asked for while saying more exist, so the request is read as
     well as the reply. When the page size is not where it belongs in the
     request — Google's to move whenever it likes — nothing is guessed from
     the size of the first page. The verdict waits instead for Maps to ask
     for a second page: one that arrives means the session can page. A capped
     session never asks for one — it is served the first 10 of the 20 it
     asked for, with a continuation token, and Maps stops there — so in that
     case, as when the grid is never scrolled, the extension says it cannot
     tell.
  2. If a session was saved earlier, it goes back into the jar and the tab
     reloads once. If the tab is sitting on a photo, the place it came from
     is reopened instead, because a photo page cannot be judged.
  3. If that does not lift the cap, the saved session is dropped — it is not
     worth keeping something now known to be capped — and a fresh private
     session is borrowed instead.
  4. Rolling continues until a session comes back uncapped, or five rolls have
     been spent. Some places may be capped whoever asks, and reloading your
     tab for ever is worse than stopping. GMGallery.borrowPrivate() resets the
     count and rolls again.

Every step is logged to the page console as [GM-ROLL], including what the
verdict is waiting for and why it landed where it did:

  capped at 10 of 45
  the saved session was not in the jar any more (__Secure-ENID changed)
  borrowing a fresh session from a private window (roll 1 of 5)
  waiting 1.5s before calling it lifted (the page is up and has asked
  for nothing)
  verdict: lifted — the page carried 25 photos

The first line of every page load names the build, because several rounds of
debugging went into symptoms that turned out to be an older copy still
running:

  relay ready, extension 11.2.0

One thing, and only one, is shown on the page itself, after the reload, and
only if the reload turned out to be worth it:

  Reused the session saved earlier to lift Google's photo cap.
  Borrowed a session from a private window to lift Google's photo cap.

Nothing is announced at the moment of the swap. It would be claiming a result
that is not in yet, and the reload destroys the message anyway.


Sessions do not last
--------------------
Google rotates its cookies as you browse, so a session borrowed an hour ago
is usually gone by the time you open the next place, and the first load is
capped again. The extension notices and rolls, which costs one reload.

An earlier version tried to hold the saved cookies in place by writing them
back whenever Google replaced them. It was about 125 lines and its value was
never demonstrated, so it was removed. If the reload becomes annoying enough
to be worth it, the idea is sound and the history is in the git-less
snapshots beside this file.


Console API
-----------
Two commands, in the Maps tab's own console. Both need the photo feature on;
with it off they say so rather than acting.

GMGallery.borrowPrivate()  roll a fresh private session now
GMGallery.forget()         drop the saved session
GMGalleryUI.unhide()       put back anything the hiding rules hid

Everything else is in the [GM-ROLL] lines, which come from the background
script and are mirrored into the page console deliberately. Its own console
is at about:debugging -> This Firefox -> Inspect, but the background is an
event page: Firefox unloads it when idle, and the inspector then has no
context to evaluate in — which is why forget() is a command rather than an
instruction to run a storage call there.


If you see only 10 photos
-------------------------
Usually you will not have to do anything.

If it says every session it was offered is capped, close every private window
so Firefox issues a new one, then reload. That is the most common cause: an
open private window pinning the borrow to an identity that already failed.

If it says the private window produced no cookies, allow the extension in
private windows: about:addons -> this extension -> Details -> Run in Private
Windows -> Allow.

If it says it cannot tell because a single photo is open, press Escape to
reach the grid, or reload the place.

Do not clear your cookies. It feels like it should help and it does not: the
replacements are issued to an ordinary session, which is capped just the same,
and often thin enough that the gallery will not open at all. Use
GMGallery.forget() if you want to start over.


Permissions
-----------
cookies              read the private window's cookies, and write them here
storage              remember the set that worked
*://*.google.com/*   the above, scoped to Google


Files
-----
By feature, because adding one should not mean touching the others.

common/    compat.js     makes browser.* work in Chrome; nothing in Firefox
           features.js   the catalogue: one entry per feature, which the
                         popup and the gating both read
           log.js        saying things: the console line, and the toast
           registry.js   the three registries a feature hooks into: which
                         messages it answers, what it forgets when a tab
                         closes, what it says at startup
           bridge.js     relays between the page world and the background
           dispatch.js   the listener. Names no feature of its own, which a
                         test enforces

photos/    read.js       reading Google's payloads: how many photos, how
                         many were asked for, is this the single-photo
                         viewer. No state, no messages, no hooks
           watch.js      watches the gallery reply and the page's own
                         photos, and reports. Collects nothing, changes
                         nothing; remembers only where the page size lives
                         in the request, learned from a session that pages
           ui.js         hides the sign-in prompts, draws the toast
           cookies.js    the jar: reading a private session, writing it
                         here, remembering the one that worked
           verdict.js    deciding whether a swap was worth doing
           roll.js       borrowing sessions and rolling until one is not
                         capped

hours/     hours.js      the opening hours. Touches nothing else

popup/     popup.html    the toolbar panel
           popup.js      one switch per catalogue entry, by name of none

service-worker.js        how Chrome loads the background: the manifest's
                         list, in the manifest's order. Unused in Firefox


Adding a third feature
----------------------
Nothing shared should need editing.

  1. An entry in common/features.js: an id, a label, a note for the panel,
     and whether a tab already open will obey the switch without reloading.
  2. A folder named after the id, with its scripts.
  3. Those scripts in the manifest — content_scripts for the page,
     background.scripts and service-worker.js for the background.
  4. In the background, handles(id, 'gm-something', fn) for each message it
     answers, onTabGone(fn) for whatever it remembers per tab, onReady(fn)
     for anything worth saying at startup.
  5. In the page, wait for the gm-settings message before doing anything.

The tests check steps 1 to 3 agree with each other: a catalogue entry with
no folder, a folder not in the catalogue, a handler registered against a
feature that does not exist, or a file the manifest names and does not
exist, all fail.


Installation
------------
One folder, both browser families.

Firefox    about:debugging -> This Firefox -> Load Temporary Add-on ->
           manifest.json. Needs Firefox 128 or later, for content_scripts
           world "MAIN".

Chromium   chrome://extensions (or edge://, vivaldi://, opera://) ->
           Developer mode -> Load unpacked -> this folder, then Details ->
           Allow in Incognito, without which the photo feature cannot see
           the private cookie store at all. Needs Chromium 111 or later,
           again for world "MAIN".

The manifest carries both background forms: Chrome uses service-worker.js
and ignores the script list, Firefox has no service worker for extensions
and uses the list. compat.js aliases browser.* onto chrome.* and is a no-op
in Firefox. Both were tested loaded in each browser with no warnings.

Chrome, Chrome Canary and Brave refuse the extension on a machine whose
policy blocks the cookies permission, which is not something the manifest
can work around — cookies is the mechanism. Edge, Vivaldi and plain
Chromium were unaffected on the machine this was written on.

Safari can run the opening hours but not the photos: it gives extensions no
access to private cookies at all.

There are no imports, and that is deliberate. Firefox cannot load content
scripts as ES modules (bug 1451545), and the dynamic import() workaround is
asynchronous — gallery.js has to hook XMLHttpRequest before Maps sends its
first request, and an awaited import would lose that race.


What did not work, so it need not be tried again
------------------------------------------------
All of these were measured, most of them more than once.

Getting a new ordinary session. Deleting __Secure-ENID. Deleting every Google
cookie. Blocking the Set-Cookie so none is ever stored. Clearing site data.
Clearing the HTTP cache. Fresh containers — 40 of them, none uncapped.
Corrupting the cookie so Google mints a replacement. Waiting for a better
moment. Every one of them replaces a capped session with another capped
session, or acts after the decision has already been made.

Having no identity at all. Blocking cookies entirely gave a capped session
three times out of three, so it is not that Google caps sessions it
recognises — it caps whichever ones it decides to.

Changing the request. Page size from 10 to 200, the empty slots beside the
continuation token treated as offsets, the first-page flag, and every query
parameter including the 394-character source-path. All returned exactly the
same photos. The response contains only what it admits to; there is nothing
hidden client-side to reveal.

Collecting and merging the pages ourselves. Maps does follow its own
continuation token: scrolling a 45-photo place with this extension disabled
gives 8, then 20, then 40. That was 900 lines to gain exactly zero photos, and
they were deleted.

Rewriting the place URL before the page loads. It lifted nothing and sometimes
left the information drawer closed.

Borrowing again without clearing the private jar. All private windows share
one session, so the second borrow returns the first one — including when the
first was capped. This looked like "rolling does not work" for some time.


Things that turned out to be reporting bugs, not mechanism bugs
---------------------------------------------------------------
Recorded because each one cost real time and looked like the cap coming back.

A count read from the page said 2 or 3 photos on a page showing far more. Maps
writes its embedded state while the document is still parsing, so an early
read catches a fraction of it, and the first read had been latched as final.
It is now read repeatedly and across every inline script and rendered image.

A toast claimed success four seconds before the gallery replied that it was
still capped, then a second lift produced a second toast. Silence was being
treated as proof, with no way to tell a session with nothing to ask from one
whose answer was merely slow. The page now says when a request goes out.

The single-photo viewer makes its own photo request, which held up the verdict
and then sank it. It is now recognised, and a page with a photo open is not
judged at all.

Log lines vanished because they were sent to the tab and the tab was reloaded
in the same breath. They are awaited now. Delivery failures used to be
swallowed by an empty catch, which made a page that heard nothing look exactly
like a background script that did nothing.

Pinning undid its own borrow. Clearing the jar before writing the borrowed
cookies looks exactly like Google taking the session away, so the repair it
scheduled landed on top of them. Deliberate swaps now suspend pinning.

The relay dropped a field. It copied named fields into the message it
forwarded, so a newly added one arrived undefined and the background threw the
message away as malformed — a working feature that never received its input.
It forwards the payload whole now.

Escalation only ran when the gallery replied, so a page that never replies
recorded its failure and stopped. And when that was fixed, the same wrong
conclusion came through the other door: the page's own count, arriving with
nobody waiting on it, rolled on a photo view that proves nothing.

How many photos Maps asked for was guessed rather than read. The request was
searched for any integer between 5 and 200 sitting near a null, and the first
one found was taken as the page size — a coin toss with a bounds check on it,
in a payload full of counts, offsets and enums. It is read from the paging
message and nowhere else now, and when the field is not there it says so
instead of answering. Two numbers were load-bearing folklore: the 200, which
was only headroom over the page sizes Google happened to be serving, and a
fallback that called any session capped when exactly ten photos arrived. Ten
is also what ordinary pagination looks like, and the 8-photo session recorded
in watch.js was never caught by it at all. When the page size cannot be read,
nothing is decided until a second page arrives.

The first capture of real traffic showed two things the tests could not,
because their fixtures had been written to match the code. The page size is
[1] of the paging message, not [0], which is always empty — so it was never
read at all. And every real gallery reply was taken for the single-photo
viewer: the category tabs above the grid arrive as one array holding one list
full of photo URLs, which is the shape the viewer check looked for. So the
gallery was never reported, and the cap was only ever caught by the page's
photo count. A photo is now something holding its own image two levels down,
and the tests replay the captured pages.

A second capture, of the same place on a capped session, showed what the cap
is. The request is the same, asking for 20. The reply is the first 10 of the
generous session's 20, in the same order, with the same total and the very
same continuation token — and Maps never asks for page 2. So a capped session
is not refused anything; it is served half a page and stops. Served against
asked, read off the first reply, is the whole test.

That left one position known rather than found — where the page size sits in
the request — and positions are Google's to move. It is now learned. When a
session pages, the continuation token is the string the next request sends
back from the previous reply; wherever it sits is the paging message, and
the page size is the integer beside it that did not change between requests.
The location is kept in localStorage, so a capped load, which never pages,
is judged by what a generous one taught. The captured position is only the
starting point, and a move is logged as a warning when it is learned. Until
then a moved field reads as unknown, not as whatever now occupies the old
slot: shifted by one, that slot holds a thumbnail's 100.
