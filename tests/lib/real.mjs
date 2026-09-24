// Two pages of the hspqX photo call, captured from Maps on 23 September 2026
// with GMGallery.capture() on an uncapped session: a place with 45 photos,
// asked for 20 at a time.
//
// The requests are exactly as sent. The replies keep the top-level layout,
// every photo entry and the category block, but each entry is cut down to
// its id and image: the fields after those do not bear on anything read.

const PLACE = ['0x47e66f5f398004f7:0x9f8a81b53edd5873', null, null, null, null, null, null, null, 0,
  null, null, null, null, null, [[null, null, null, '/g/11lcdt6pqk']]];

// Handed back in page 1's reply at [5], and sent again in page 2's request
// in the paging message.
export const TOKEN_1 = 'EvgDKYQi49-NlUMIDwAAAAEAAAMAAAAAQAAAAAAABAAAAAEAAAAABAAAAAAgAAAAAAAAAAAAAAAAAAAAAgAAAAAQACAAAAAAAAAAAAIAAAIAAAAAAAAAAAAABCAAAAAAAAAAAAAAAAAAiAAAAAAAAAAAIAAAAAAAAAEAAAAAAAAAACAAAAAAAIAAABAAAAAAAAAAAACAAgAAAEAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAQAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAgACAAAAAEIAEAAAAAAQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAIAAAAAAAAAAAQAAIAAAAAAAAAQAACAAAAAAAAAAgAAAAAAAAAAAAAAAAAAQAAAAAACAAAAACAAAAAAABAEAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAEAAAAAAAACAACAAAAAAACAAgAAAAAAAAAAAAACAAAAAAAAAgAAAAAAAAgAAAAAAAAIAAAAQAAAAAAAAAGBRCVCmEIuPfjZVD6AEAACAAAAADAAAAASABACiAASIAAAAgAAAAAKUgALACoQgEAAAAACIABGAAACQAACAAAJQYQASAAkGQCoAAgQBCAACACAQAJAAAAA';

export const args = (token, size = 20, session = 'JOuzatvrHbHo7M8P1on_kAQ') => [2, null, PLACE, null,
  [null, [203, 100], [null, size, token, null, 1], null, null, null,
    [[[1, 0, 3], [2, 1, 2], [2, 0, 3], [8, 0, 3], [10, 0, 3], [10, 1, 2], [10, 0, 4], [9, 1, 2]], 1],
    null, 0, null, null, null, null, null, [[[[[[2]]], [195, 195], 20]]]],
  [session, null, null, null, null, null, 81, null, null, null, null, null, null, null, 16698],
  null, null, null, null, null, null, null, null, null, [null, 1, null, 1]];

const body = (token) => new URLSearchParams({
  'f.req': JSON.stringify([[['hspqX', JSON.stringify(args(token)), null, 'generic']]])
}).toString();

export const REQUEST_1 = body(null);
export const REQUEST_2 = body(TOKEN_1);

export const photo = (id) => [id, 10, 12, null, null, null,
  [`https://lh3.googleusercontent.com/gps-cs-s/${id}=w203-h270-k-no`, '', [3000, 4000], [203, 100]]];

const streetView = (id) => [id, 0, 1, null, null, null,
  [`https://streetviewpixels-pa.googleapis.com/v1/thumbnail?panoid=${id}&w=203&h=100`, '', null, [203, 100]]];

// The tabs above the grid — Tout, Intérieur, and so on — each carrying its
// cover photo. One array holding one list, full of photo URLs: exactly the
// shape the single-photo viewer's reply was assumed to have.
const categories = [[
  ['CgIgAQ==', '0ahU-tout', 'Tout', [photo('CIABIhCQXXPaSt2BV5EyKWT9a08x')], null, null, null, null, null, null, false, 1, null, false],
  ['CgIYEg==', '0ahU-int', 'Intérieur', [photo('CIABIhA0ARrWFjtdC0J8eB_nt9pq')], null, null, null, null, 6, null, false, 1, null, true],
  ['CgwKCC9tLzAxeXJ4MAE=', '0ahU-chat', 'Chat', [photo('CIHM0ogKEICAgICdn_PLUw')], null, null, null, null, null, null, false, 1, null, true],
  ['CgIgARICEAE=', '0ahU-own', 'Photos du propriétaire', [photo('CIABIhCr6Arrh-AyaxsGLq1EpM1z')], null, null, null, null, null, null, false, 1, 2, false],
  ['CgIgARICCAI=', '0ahU-sv', 'Street View et 360°', [streetView('7LGtagnXG8p26Kw60Lk05A')], null, null, null, null, null, null, false, 1, null, false]
]];

export const page = (list, total, session, token, more) =>
  [list, total, null, session, null, token, null, null, null, null, more, null, categories, ['CgIgAQ==']];

const PAGE_1_IDS = ['CIABIhCQXXPaSt2BV5EyKWT9a08x', 'CIABIhA0ARrWFjtdC0J8eB_nt9pq', 'CIABIhBg_NjJO7Qfiar3t4rjB-B-',
  'CIABIhBpHlViPHEPAETDVqclrtWQ', 'CIHM0ogKEICAgICdn_PLUw', 'CIABIhDC0D0rb81eo3AbjRzhDjXF',
  'CIABIhC7lNFpBgSRypqnFvu189_O', 'CIABIhAJwMcJcfKarq0M9jwCgllN', 'CIHM0ogKEICAgICzxIir3AE',
  'CIABIhDWk1UGoRdc2lyHpSSq8AqW', 'CIABIhD4DVuPexCySTdC9QPx6uED', 'CIABIhCUyDXNDleXwlZ9XGJxCgN-',
  'CIABIhA5xQOx48TVTs0FndKvHSqV', 'CIHM0ogKEICAgMDw3JL_hgE', 'CIABIhB8sa7alZyHEuHMEc2YpLnZ',
  'CIABIhDpjswr6Ia9wAjYRlBASAz2', 'CIABIhB3DeIs3eP2RTSfvBiCH9xS', 'CIABIhCYK4ssrt-4n745exCl3Dtn',
  'CIABIhDM2O0MdSnQ0L6dg-xFg9PX', 'CIHM0ogKEICAgICtyNvC_QE'];

const PAGE_2_IDS = ['CIABIhBvE61vD2Xq14LSEsOXclW-', 'CIABIhCdqqWiUdfkuoEkdcwi85yM', 'CIABIhDRRUGm5TMnLNRKMYK-lbeP',
  'CIABIhCyrApgmeIQTGkISXLowTim', 'CIABIhCJy4YmQ6zcwp1POjLzW-27', 'CIHM0ogKEICAgMCwv9HL2AE',
  'CIABIhDEsBhctQNf83TLA-wE-DT-', 'CIABIhANyLl675jHc3obcjjco6p6', 'CIABIhAabGRXTRHu2EEpXZ9W3nz-',
  'CIHM0ogKEICAgICzxIirXA', 'CIABIhDRk2_rPvaMowDNpBM-KAt8', 'CIABIhBLqpBkWLQ1mGHnCdLSC6MR',
  'CIABIhAHK-X_axfhqCIbtypEK20R', 'CIHM0ogKEICAgICD9qb2eg', 'CIHM0ogKEICAgIC9oPOkZQ',
  'CIABIhBS4Q6tjjVqk-JQiZ4jWnzm'];

export const REPLY_1 = page(PAGE_1_IDS.map(photo), 45, 'JOuzapGqOJqU7NMPvNuoWQ', TOKEN_1, false);

// Nineteen of the twenty asked for, the Street View panorama among them, and
// a total that moved from 45 to 46: an uncapped page is not always a full one.
export const REPLY_2 = page([...PAGE_2_IDS.map(photo), streetView('7LGtagnXG8p26Kw60Lk05A'),
  photo('CIHM0ogKEICAgICdn_PL0wE'), photo('CIHM0ogKEICAgIC9oPOI0wE')],
  46, 'K-uzaqWFEbTj7NMPleL4iAg', 'EvgDKYQi49-page-2-token', true);

// The same place on a capped session, captured the same day. The request is
// the page-1 request above, word for word bar the session id: it asks for
// 20. The reply is the first ten photos of the uncapped page 1, in the same
// order, the same total of 45, and a continuation token — and Maps never
// sent a second request, refused or otherwise. No category tabs, and three
// trailing fields the uncapped reply does not have.
export const TOKEN_CAPPED = 'EvgDKYQi49-NlUMIDwAAAAEAAAMAAAAAQAAAAAAABAAAAAEAAAAABAAAAAAgAAAAAAAAAAAAAAAAAAAAAgAAAAAQACAAAAAAAAAAAAIAAAIAAAAAAAAAAAAABCAAAAAAAAAAAAAAAAAAiAAAAAAAAAAAIAAAAAAAAAEAAAAAAAAAACAAAAAAAIAAABAAAAAAAAAAAACAAgAAAEAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAQAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAgACAAAAAEIAEAAAAAAQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAIAAAAAAAAAAAQAAIAAAAAAAAAQAACAAAAAAAAAAgAAAAAAAAAAAAAAAAAAQAAAAAACAAAAACAAAAAAABAEAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAEAAAAAAAACAACAAAAAAACAAgAAAAAAAAAAAAACAAAAAAAAAgAAAAAAAAgAAAAAAAAIAAAAQAAAAAAAAAGBRCVCmEIuPfjZVD6AEAACAAAAADAAAAASABACiAASIAAAAgAAAAAKUgALACoQgEAAAAACIABGAAACQAACAAAJQYQASAAkGQCoAAgQBCAACACAQAJAAAAA';

export const REQUEST_CAPPED = new URLSearchParams({
  'f.req': JSON.stringify([[['hspqX', JSON.stringify(args(null, 20, 'Du2zav2uFqmrkdUP1cKd6A0')), null, 'generic']]])
}).toString();

export const REPLY_CAPPED = [PAGE_1_IDS.slice(0, 10).map(photo), 45, null, 'Du2zaoDHMZqU7NMPvNuoWQ', null,
  TOKEN_CAPPED, null, null, null, null, false, null, null, ['CgIgAQ=='], null, true];

// A captured request as it would look after Google added a field ahead of
// the paging message: everything from [4][1] on moves along by one. The
// default layout then points at a thumbnail's [203, 100].
export const shifted = (body) => {
  const outer = JSON.parse(new URLSearchParams(body).get('f.req'));
  for (const envelope of outer[0]) {
    const a = JSON.parse(envelope[1]);
    a[4].splice(1, 0, 'a field Google added');
    envelope[1] = JSON.stringify(a);
  }
  return new URLSearchParams({ 'f.req': JSON.stringify(outer) }).toString();
};

// Framed the way batchexecute frames it.
export const frame = (rpc, payload) => {
  const text = JSON.stringify(payload);
  return `)]}'\n\n${text.length}\n[["wrb.fr","${rpc}",${JSON.stringify(text)},null,null,null,"generic"]]`;
};
