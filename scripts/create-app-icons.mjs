// Deterministic app resource icons; no image tools or build-time downloads needed.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const size = 32;
const pixels = Buffer.alloc(size * size * 4);
const glyph = ["11111", "10000", "10000", "11111", "00001", "00001", "11111"];
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const gx = Math.floor((x - 6) / 4), gy = Math.floor((y - 2) / 4);
  const ink = gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && glyph[gy][gx] === "1";
  pixels.set(ink ? [245, 247, 255, 255] : [38, 38, 70, 255], (y * size + x) * 4);
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
const rows = Buffer.alloc(size * (1 + size * 4));
for (let y = 0; y < size; y++) pixels.copy(rows, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
const directory = new URL("../src-tauri/icons/", import.meta.url);
mkdirSync(directory, { recursive: true });
writeFileSync(new URL("icon.png", directory), png);
const ico = Buffer.alloc(22); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico[6] = size; ico[7] = size;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync(new URL("icon.ico", directory), Buffer.concat([ico, png]));
