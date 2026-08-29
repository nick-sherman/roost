import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const SIZE = 32;

const COLORS = {
    green: [52, 199, 89],
    red: [255, 69, 58],
    amber: [255, 159, 10],
    grey: [142, 142, 147],
};

const CRC_TABLE = (() => {
    const table = new Int32Array(256);

    for (let n = 0; n < 256; n += 1) {
        let c = n;

        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }

        table[n] = c;
    }

    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;

    for (const byte of buf) {
        c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    }

    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);

    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));

    return Buffer.concat([length, body, crc]);
}

function circlePng([r, g, b]) {
    const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
    const center = (SIZE - 1) / 2;
    const radius = SIZE / 2 - 3;

    for (let y = 0; y < SIZE; y += 1) {
        const rowStart = y * (SIZE * 4 + 1);
        raw[rowStart] = 0;

        for (let x = 0; x < SIZE; x += 1) {
            const distance = Math.hypot(x - center, y - center);
            const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance));
            const offset = rowStart + 1 + x * 4;

            raw[offset] = r;
            raw[offset + 1] = g;
            raw[offset + 2] = b;
            raw[offset + 3] = Math.round(coverage * 255);
        }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(SIZE, 0);
    ihdr.writeUInt32BE(SIZE, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

mkdirSync(OUT, { recursive: true });

for (const [name, color] of Object.entries(COLORS)) {
    writeFileSync(join(OUT, `tray-${name}.png`), circlePng(color));
}

console.log(`wrote ${Object.keys(COLORS).length} tray icons to ${OUT}`);
