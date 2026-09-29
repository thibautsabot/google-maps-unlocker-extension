// Draws the toolbar and store icons with no dependencies: a map pin with the
// lock knocked out of it. Run: node tools/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), body.length + 4);
  return out;
};

function png(size) {
  const S = 4;                       // supersampling for smooth edges
  const N = size * S;
  const cx = N / 2, cy = N * 0.4, r = N * 0.3;
  const tipY = N * 0.92;

  const inPin = (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= r) return true;
    if (y < cy || y > tipY) return false;
    const t = (y - cy) / (tipY - cy);
    return Math.abs(x - cx) <= r * (1 - t) * Math.cos(t * 0.6);
  };
  const inHole = (x, y) => Math.hypot(x - cx, y - cy) <= r * 0.42;
  const inShackle = (x, y) => {
    const sy = cy - r * 0.05;
    const d = Math.hypot(x - cx, y - sy);
    return d <= r * 0.24 && d >= r * 0.13 && y <= sy;
  };

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let pin = 0, hole = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const x = px * S + sx + 0.5, y = py * S + sy + 0.5;
        if (inPin(x, y)) {
          pin++;
          if (inHole(x, y) || inShackle(x, y)) hole++;
        }
      }
      const total = S * S;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const a = pin / total;
      const white = pin ? hole / pin : 0;
      raw[o] = Math.round(26 + 229 * white);
      raw[o + 1] = Math.round(115 + 140 * white);
      raw[o + 2] = Math.round(232 + 23 * white);
      raw[o + 3] = Math.round(255 * a);
    }
  }

  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8; head[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

for (const size of [16, 32, 48, 128]) writeFileSync(`icons/icon-${size}.png`, png(size));
console.log('wrote icons/icon-{16,32,48,128}.png');
