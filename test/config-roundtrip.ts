import { app } from 'electron';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    deleteProcess,
    ensureConfig,
    readProjectConfig,
    saveProcess,
} from '../src/main/config';

const checks: string[] = [];

function check(label: string, condition: boolean, detail = ''): void {
    checks.push(`${condition ? 'PASS' : 'FAIL'} ${label}${detail && ! condition ? ` -> ${detail}` : ''}`);
}

app.on('ready', () => {
    const dir = mkdtempSync(join(tmpdir(), 'roost-test-'));

    check('no roost.yml means no config', readProjectConfig(dir).hasConfig === false);
    check('no commands before a config exists', readProjectConfig(dir).config.processes.length === 0);

    check('ensureConfig creates the file', ensureConfig(dir) === true);
    check('ensureConfig is a no-op second time', ensureConfig(dir) === false);

    check('add the first command', saveProcess(dir, null, {
        name: 'Dev Server',
        kind: 'command',
        command: 'composer dev',
        workingDir: null,
        autoStart: true,
        autoRestart: true,
        env: {},
    }) === null);

    check('add a second command', saveProcess(dir, null, {
        name: 'Logs',
        kind: 'command',
        command: 'tail -f storage/logs/laravel.log',
        workingDir: null,
        autoStart: true,
        autoRestart: false,
        env: {},
    }) === null);

    const seeded = readProjectConfig(dir).config;

    check('both commands are on disk', seeded.processes.length === 2);
    check(
        'command text survived',
        seeded.processes.find((p) => p.name === 'Dev Server')?.command === 'composer dev',
    );
    check(
        'auto_restart true survived',
        seeded.processes.find((p) => p.name === 'Dev Server')?.autoRestart === true,
    );
    check(
        'auto_restart false survived',
        seeded.processes.find((p) => p.name === 'Logs')?.autoRestart === false,
    );

    check('add a new command', saveProcess(dir, null, {
        name: 'Queue',
        kind: 'command',
        command: 'php artisan queue:work',
        workingDir: null,
        autoStart: false,
        autoRestart: true,
        env: { QUEUE_TRIES: '3' },
    }) === null);

    check('three commands now', readProjectConfig(dir).config.processes.length === 3);
    check(
        'env survived the write',
        readProjectConfig(dir).config.processes.find((p) => p.name === 'Queue')?.env.QUEUE_TRIES === '3',
    );

    const duplicate = saveProcess(dir, null, {
        name: 'Queue',
        kind: 'command',
        command: 'echo nope',
        workingDir: null,
        autoStart: false,
        autoRestart: false,
        env: {},
    });

    check('duplicate name is rejected', typeof duplicate === 'string', String(duplicate));
    check('still three commands', readProjectConfig(dir).config.processes.length === 3);

    check('rename and edit in place', saveProcess(dir, 'Queue', {
        name: 'Worker',
        kind: 'command',
        command: 'php artisan queue:work --tries=5',
        workingDir: 'app',
        autoStart: true,
        autoRestart: true,
        env: {},
    }) === null);

    const renamed = readProjectConfig(dir).config;

    check('old name is gone', renamed.processes.every((p) => p.name !== 'Queue'));
    check('new name is there', renamed.processes.some((p) => p.name === 'Worker'));
    check(
        'working_dir survived',
        renamed.processes.find((p) => p.name === 'Worker')?.workingDir === 'app',
    );
    check('order is stable', renamed.processes.map((p) => p.name).join(',') === 'Dev Server,Logs,Worker');

    check('empty name is rejected', typeof saveProcess(dir, null, {
        name: '   ',
        kind: 'command',
        command: 'echo hi',
        workingDir: null,
        autoStart: false,
        autoRestart: false,
        env: {},
    }) === 'string');

    check('empty command is rejected', typeof saveProcess(dir, null, {
        name: 'Blank',
        kind: 'command',
        command: '',
        workingDir: null,
        autoStart: false,
        autoRestart: false,
        env: {},
    }) === 'string');

    check('add a terminal', saveProcess(dir, null, {
        name: 'Terminal',
        kind: 'terminal',
        command: '/bin/zsh',
        workingDir: null,
        autoStart: false,
        autoRestart: false,
        env: {},
    }) === null);

    const withTerminal = readProjectConfig(dir).config;

    check(
        'terminal kind survived the write',
        withTerminal.processes.find((p) => p.name === 'Terminal')?.kind === 'terminal',
        JSON.stringify(withTerminal.processes.find((p) => p.name === 'Terminal')),
    );
    check(
        'commands stay commands',
        withTerminal.processes.find((p) => p.name === 'Dev Server')?.kind === 'command',
    );

    deleteProcess(dir, 'Terminal');

    check('terminal can be deleted', readProjectConfig(dir).config.processes.every((p) => p.name !== 'Terminal'));

    deleteProcess(dir, 'Logs');

    check('delete removed it', readProjectConfig(dir).config.processes.every((p) => p.name !== 'Logs'));
    check('two commands left', readProjectConfig(dir).config.processes.length === 2);

    console.log('---ROOST TEST---');
    checks.forEach((line) => console.log(line));
    console.log(`---${checks.filter((l) => l.startsWith('FAIL')).length} FAILURES---`);
    console.log('final roost.yml:\n' + readFileSync(join(dir, 'roost.yml'), 'utf8'));

    app.exit(checks.some((l) => l.startsWith('FAIL')) ? 1 : 0);
});
