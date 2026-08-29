import { app } from 'electron';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ProcessManager } from '../src/main/process-manager';
import type { ProcessConfig } from '../src/shared/types';

const results: string[] = [];

function command(name: string, workingDir: string | null): ProcessConfig {
    return {
        name,
        kind: 'command',
        command: 'pwd',
        workingDir,
        autoStart: false,
        autoRestart: false,
        env: {},
    };
}

app.on('ready', async () => {
    const root = mkdtempSync(join(tmpdir(), 'roost-cwd-'));
    const projectA = join(root, 'project-a');
    const projectB = join(root, 'project-b');
    const nested = join(projectA, 'apps', 'web');
    const elsewhere = join(root, 'elsewhere');

    [projectA, projectB, nested, elsewhere].forEach((dir) => mkdirSync(dir, { recursive: true }));

    const manager = new ProcessManager();
    const output = new Map<string, string>();

    manager.on('data', ({ id, data }: { id: string; data: string }) => {
        output.set(id, (output.get(id) ?? '') + data);
    });

    const run = (id: string, projectPath: string, config: ProcessConfig, whole = false): Promise<string> =>
        new Promise((done) => {
            manager.upsert(id, 'proj', projectPath, config);

            const listener = (changed: string): void => {
                if (changed !== id) {
                    return;
                }

                const state = manager.state(id);

                if (state && (state.status === 'stopped' || state.status === 'crashed')) {
                    manager.off('changed', listener);

                    const raw = output.get(id) ?? '';

                    done(whole ? raw.trim() : raw.split('\n')[0].trim());
                }
            };

            manager.on('changed', listener);
            manager.start(id);
        });

    const a = await run('a', projectA, command('a', null));
    const b = await run('b', projectB, command('b', null));
    const c = await run('c', projectA, command('c', 'apps/web'));
    const d = await run('d', projectA, command('d', elsewhere));
    const e = await run('e', projectA, command('e', 'does-not-exist'), true);

    const check = (label: string, actual: string, expected: string): void => {
        results.push(`${actual === expected ? 'PASS' : 'FAIL'} ${label}\n     got: ${actual}\n     want: ${expected}`);
    };

    check('no working_dir runs in project A', a, resolve(projectA));
    check('no working_dir runs in project B', b, resolve(projectB));
    check('relative working_dir resolves under the project', c, resolve(nested));
    check('absolute working_dir wins', d, resolve(elsewhere));

    results.push(
        `${e.includes('working directory not found') ? 'PASS' : 'FAIL'} missing working_dir fails loudly\n     got: ${e}`,
    );

    console.log('---CWD TEST---');
    results.forEach((line) => console.log(line));
    console.log(`---${results.filter((l) => l.startsWith('FAIL')).length} FAILURES---`);

    manager.killEverything();
    app.exit(results.some((l) => l.startsWith('FAIL')) ? 1 : 0);
});
