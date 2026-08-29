import { chmodSync, copyFileSync, cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'node_modules', 'node-pty');
const TARGET = join(ROOT, '.pty-dist', 'node-pty');

// node-pty needs a real executable (build/Release/spawn-helper) beside its native
// module, and nothing executable survives inside an asar. Everything here is
// copied to Contents/Resources instead, via extraResource in forge.config.ts.
const BINARIES = ['pty.node', 'spawn-helper'];

rmSync(join(ROOT, '.pty-dist'), { recursive: true, force: true });
mkdirSync(join(TARGET, 'build', 'Release'), { recursive: true });

copyFileSync(join(SOURCE, 'package.json'), join(TARGET, 'package.json'));
cpSync(join(SOURCE, 'lib'), join(TARGET, 'lib'), { recursive: true });

for (const name of BINARIES) {
    const from = join(SOURCE, 'build', 'Release', name);
    const to = join(TARGET, 'build', 'Release', name);

    copyFileSync(from, to);
    chmodSync(to, statSync(from).mode);
}

console.log(`staged node-pty for packaging at ${TARGET}`);
