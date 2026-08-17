import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

// Minimal PNG writer: no dependency, real RGBA output.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// The console accent on a dark ground, with three ascending bars — the same
// "factory throughput" idea the dashboard uses, drawn geometrically so the icon
// is a real mark rather than a placeholder square.
const ACCENT = [124, 92, 255];
const INK = [255, 255, 255];

function render(size, maskable) {
  const p = Buffer.alloc(size * size * 4);
  // Maskable icons are cropped to a circle by the platform, so the mark is
  // drawn smaller inside the safe zone rather than filling the canvas.
  const pad = maskable ? Math.round(size * 0.22) : Math.round(size * 0.14);
  const radius = maskable ? 0 : Math.round(size * 0.22);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let inside = true;
      if (radius > 0) {
        const cx = Math.min(Math.max(x, radius), size - radius - 1);
        const cy = Math.min(Math.max(y, radius), size - radius - 1);
        inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
      }
      if (!inside) { p[i + 3] = 0; continue; }
      p[i] = ACCENT[0]; p[i + 1] = ACCENT[1]; p[i + 2] = ACCENT[2]; p[i + 3] = 255;
    }
  }

  const inner = size - pad * 2;
  const barW = Math.round(inner / 5);
  const gap = Math.round(barW / 2);
  const heights = [0.42, 0.68, 1.0];
  for (let b = 0; b < 3; b++) {
    const bx = pad + b * (barW + gap);
    const bh = Math.round(inner * heights[b]);
    const by = pad + inner - bh;
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + barW && x < size; x++) {
        const i = (y * size + x) * 4;
        if (p[i + 3] === 0) continue;
        p[i] = INK[0]; p[i + 1] = INK[1]; p[i + 2] = INK[2]; p[i + 3] = 255;
      }
    }
  }
  return p;
}

for (const [size, maskable, name] of [
  [192, false, "icon-192.png"], [512, false, "icon-512.png"],
  [512, true, "icon-maskable-512.png"], [180, false, "apple-touch-icon.png"],
]) {
  writeFileSync(`public/${name}`, png(size, render(size, maskable)));
  console.log(`public/${name}`);
}
