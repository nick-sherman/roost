import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'assets', 'icon.svg');
const ICONSET = join(ROOT, 'assets', 'Roost.iconset');

const VARIANTS = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
];

// QuickLook rasterises the SVG. A headless browser would work too, but Electron
// needs a window server session and hangs without one, and Chrome ignores
// --force-device-scale-factor in headless mode and renders at 2x.
function rasterise(size) {
    const scratch = mkdtempSync(join(tmpdir(), 'roost-icon-'));

    execFileSync('qlmanage', ['-t', '-s', String(size), '-o', scratch, SOURCE], { stdio: 'ignore' });

    const produced = readdirSync(scratch).find((name) => name.endsWith('.png'));

    if (! produced) {
        throw new Error(`QuickLook produced no PNG at ${size}px`);
    }

    return join(scratch, produced);
}

rmSync(ICONSET, { recursive: true, force: true });
mkdirSync(ICONSET, { recursive: true });

const cache = new Map();

for (const [size, name] of VARIANTS) {
    if (! cache.has(size)) {
        cache.set(size, rasterise(size));
    }

    execFileSync('cp', [cache.get(size), join(ICONSET, name)]);
}

execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', join(ROOT, 'assets', 'Roost.icns')]);
rmSync(ICONSET, { recursive: true, force: true });

for (const path of new Set(cache.values())) {
    rmSync(dirname(path), { recursive: true, force: true });
}

console.log('wrote assets/Roost.icns');
