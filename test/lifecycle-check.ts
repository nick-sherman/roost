import { app } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProcessManager } from '../src/main/process-manager';
import type { ProcessConfig } from '../src/shared/types';

const MARKER = `roost-orphan-${Date.now()}`;

function longRunner(name: string): ProcessConfig {
    return {
        name,
        kind: 'command',
        command: `sleep 600 # ${MARKER}`,
        workingDir: null,
        autoStart: false,
        autoRestart: false,
        env: {},
    };
}

function orphanCount(): number {
    try {
        const out = execFileSync('/bin/sh', ['-c', `pgrep -f "${MARKER}" | wc -l`]).toString().trim();

        return Number(out);
    } catch {
        return 0;
    }
}

const results: string[] = [];

function check(label: string, condition: boolean, detail = ''): void {
    results.push(`${condition ? 'PASS' : 'FAIL'} ${label}${detail ? `\n     ${detail}` : ''}`);
}

function waitFor(test: () => boolean, ms = 6000): Promise<boolean> {
    return new Promise((done) => {
        const started = Date.now();
        const poll = setInterval(() => {
            if (test()) {
                clearInterval(poll);
                done(true);
            } else if (Date.now() - started > ms) {
                clearInterval(poll);
                done(false);
            }
        }, 150);
    });
}

app.on('ready', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roost-life-'));
    const manager = new ProcessManager();

    manager.upsert('one', 'proj', dir, longRunner('one'));
    manager.start('one');

    const started = await waitFor(() => manager.state('one')?.status === 'running');

    check('command reports running', started, `status: ${manager.state('one')?.status}`);
    check('the sleep is actually alive', await waitFor(() => orphanCount() >= 1), `pgrep count: ${orphanCount()}`);

    manager.forget('one');

    check('forget removes it from the manager', manager.state('one') === null);
    check(
        'forget leaves no orphan process',
        await waitFor(() => orphanCount() === 0),
        `pgrep count after forget: ${orphanCount()}`,
    );

    manager.upsert('two', 'proj', dir, longRunner('two'));
    manager.start('two');
    await waitFor(() => manager.state('two')?.status === 'running');
    await waitFor(() => orphanCount() >= 1);

    manager.stop('two');

    const stopped = await waitFor(() => manager.state('two')?.status === 'stopped');

    check('stop marks it stopped, not crashed', stopped, `status: ${manager.state('two')?.status}`);
    check('stop leaves no orphan', await waitFor(() => orphanCount() === 0), `pgrep count: ${orphanCount()}`);

    manager.upsert('three', 'proj', dir, longRunner('three'));
    manager.start('three');
    await waitFor(() => orphanCount() >= 1);

    manager.killEverything();

    check(
        'quitting kills everything',
        await waitFor(() => orphanCount() === 0),
        `pgrep count after killEverything: ${orphanCount()}`,
    );

    console.log('---LIFECYCLE TEST---');
    results.forEach((line) => console.log(line));
    console.log(`---${results.filter((l) => l.startsWith('FAIL')).length} FAILURES---`);

    manager.killEverything();
    app.exit(results.some((l) => l.startsWith('FAIL')) ? 1 : 0);
});
