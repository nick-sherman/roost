import { app } from 'electron';
import { execFileSync } from 'node:child_process';

import { ProcessManager } from '../src/main/process-manager';
import type { ProcessConfig } from '../src/shared/types';

// Commands are supposed to see the same PATH an interactive login shell sees.
// Set ROOST_TEST_PROJECT to run this against a particular project folder.
const PROJECT = process.env.ROOST_TEST_PROJECT ?? process.cwd();
const SHELL = process.env.SHELL || '/bin/zsh';

const TOOLS = ['node', 'npx', 'git'];

function probe(name: string, command: string): ProcessConfig {
    return {
        name,
        kind: 'command',
        command,
        workingDir: null,
        autoStart: false,
        autoRestart: false,
        env: {},
    };
}

function inLoginShell(command: string): string {
    try {
        // An interactive shell blocks on an inherited stdin, so hand it nothing.
        return execFileSync(SHELL, ['-l', '-i', '-c', command], {
            cwd: PROJECT,
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 20_000,
        })
            .toString()
            .trim()
            .split('\n')
            .pop() ?? '';
    } catch {
        return '';
    }
}

const results: string[] = [];

function check(label: string, condition: boolean, detail: string): void {
    results.push(`${condition ? 'PASS' : 'FAIL'} ${label}\n     ${detail.replace(/\s+/g, ' ').trim().slice(0, 180)}`);
}

app.on('ready', async () => {
    const manager = new ProcessManager();
    const output = new Map<string, string>();

    manager.on('data', ({ id, data }: { id: string; data: string }) => {
        output.set(id, (output.get(id) ?? '') + data);
    });

    const run = (id: string, command: string): Promise<string> =>
        new Promise((done) => {
            manager.upsert(id, 'proj', PROJECT, probe(id, command));

            const listener = (changed: string): void => {
                if (changed !== id) {
                    return;
                }

                const state = manager.state(id);

                if (state && (state.status === 'stopped' || state.status === 'crashed')) {
                    manager.off('changed', listener);
                    done(output.get(id) ?? '');
                }
            };

            manager.on('changed', listener);
            manager.start(id);
        });

    for (const tool of TOOLS) {
        const expected = inLoginShell(`command -v ${tool}`);

        if (! expected) {
            results.push(`SKIP ${tool} is not on this machine`);

            continue;
        }

        const raw = await run(tool, `command -v ${tool}`);
        const seen = raw.includes(expected);

        check(`${tool} resolves the same as an interactive login shell`, seen, `expected ${expected}, got ${raw}`);
    }

    const broken = await run('dyld', 'node -e "process.stdout.write(process.version)"');

    check('node actually runs', ! broken.includes('dyld') && broken.includes('v'), broken);

    console.log('---PATH TEST---');
    console.log(`project: ${PROJECT}`);
    results.forEach((line) => console.log(line));
    console.log(`---${results.filter((l) => l.startsWith('FAIL')).length} FAILURES---`);

    manager.killEverything();
    app.exit(results.some((l) => l.startsWith('FAIL')) ? 1 : 0);
});
