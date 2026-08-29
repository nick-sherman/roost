import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import type { IPty, spawn as ptySpawn } from 'node-pty';

import type { AttachResult, ProcessConfig, ProcessState, ProcessStatus } from '../shared/types';

const load = createRequire(__filename);

let spawn: typeof ptySpawn | null = null;

// In development node-pty resolves from node_modules. A packaged Roost ships it
// under Contents/Resources instead: it needs an executable spawn-helper beside
// its native module, and nothing keeps its executable bit inside an asar.
function ptySpawner(): typeof ptySpawn {
    if (spawn) {
        return spawn;
    }

    try {
        spawn = (load('node-pty') as typeof import('node-pty')).spawn;
    } catch {
        spawn = (load(join(process.resourcesPath, 'node-pty')) as typeof import('node-pty')).spawn;
    }

    return spawn;
}

const BUFFER_LIMIT = 400_000;
const RESTART_DELAY = 1_000;
const MAX_RAPID_RESTARTS = 5;
const RAPID_WINDOW = 10_000;

interface Session {
    id: string;
    projectId: string;
    projectPath: string;
    config: ProcessConfig;
    pty: IPty | null;
    status: ProcessStatus;
    pid: number | null;
    startedAt: number | null;
    exitCode: number | null;
    exitSignal: number | null;
    restartCount: number;
    recentRestarts: number[];
    stopping: boolean;
    restartTimer: NodeJS.Timeout | null;
    buffer: string;
    lastSeq: number;
}

export class ProcessManager extends EventEmitter {
    private sessions = new Map<string, Session>();

    private seq = 0;

    upsert(id: string, projectId: string, projectPath: string, config: ProcessConfig): void {
        const existing = this.sessions.get(id);

        if (existing) {
            existing.config = config;
            existing.projectPath = projectPath;

            return;
        }

        this.sessions.set(id, {
            id,
            projectId,
            projectPath,
            config,
            pty: null,
            status: 'stopped',
            pid: null,
            startedAt: null,
            exitCode: null,
            exitSignal: null,
            restartCount: 0,
            recentRestarts: [],
            stopping: false,
            restartTimer: null,
            buffer: '',
            lastSeq: 0,
        });
    }

    forget(id: string): void {
        const session = this.sessions.get(id);

        if (! session) {
            return;
        }

        this.stop(id);
        this.sessions.delete(id);
    }

    idsForProject(projectId: string): string[] {
        return [...this.sessions.values()]
            .filter((session) => session.projectId === projectId)
            .map((session) => session.id);
    }

    state(id: string): ProcessState | null {
        const session = this.sessions.get(id);

        if (! session) {
            return null;
        }

        return {
            ...session.config,
            id: session.id,
            projectId: session.projectId,
            status: session.status,
            pid: session.pid,
            startedAt: session.startedAt,
            exitCode: session.exitCode,
            exitSignal: session.exitSignal,
            restartCount: session.restartCount,
        };
    }

    attach(id: string): AttachResult {
        const session = this.sessions.get(id);

        if (! session) {
            return { text: '', lastSeq: 0 };
        }

        return { text: session.buffer, lastSeq: session.lastSeq };
    }

    clear(id: string): void {
        const session = this.sessions.get(id);

        if (! session) {
            return;
        }

        session.buffer = '';
    }

    write(id: string, data: string): void {
        this.sessions.get(id)?.pty?.write(data);
    }

    resize(id: string, cols: number, rows: number): void {
        const session = this.sessions.get(id);

        if (! session?.pty) {
            return;
        }

        try {
            session.pty.resize(Math.max(cols, 2), Math.max(rows, 1));
        } catch {
            // The pty went away between the resize request and this call.
        }
    }

    start(id: string): void {
        const session = this.sessions.get(id);

        if (! session || session.pty) {
            return;
        }

        this.clearRestartTimer(session);

        session.stopping = false;
        session.exitCode = null;
        session.exitSignal = null;
        session.status = 'starting';

        const cwd = this.resolveCwd(session);

        if (! existsSync(cwd)) {
            session.status = 'crashed';
            this.push(session, `\r\n\x1b[31mroost: working directory not found: ${cwd}\x1b[0m\r\n`);
            this.emit('changed', session.id);

            return;
        }

        const shell = process.env.SHELL || '/bin/zsh';

        // -i as well as -l, so .zshrc runs and version managers like nvm are on PATH.
        const args = session.config.kind === 'terminal'
            ? ['-l', '-i']
            : ['-l', '-i', '-c', session.config.command];

        let pty: IPty;

        try {
            pty = ptySpawner()(shell, args, {
                name: 'xterm-256color',
                cols: 100,
                rows: 30,
                cwd,
                env: {
                    ...process.env,
                    ...session.config.env,
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor',
                    FORCE_COLOR: '1',
                } as Record<string, string>,
            });
        } catch (error) {
            session.status = 'crashed';
            this.push(session, `\r\n\x1b[31mroost: failed to start: ${(error as Error).message}\x1b[0m\r\n`);
            this.emit('changed', session.id);

            return;
        }

        session.pty = pty;
        session.pid = pty.pid;
        session.startedAt = Date.now();
        session.status = 'running';

        pty.onData((data) => this.push(session, data));

        pty.onExit(({ exitCode, signal }) => {
            session.pty = null;
            session.pid = null;
            session.exitCode = exitCode;
            session.exitSignal = signal ?? null;

            if (session.stopping) {
                session.status = 'stopped';
                session.stopping = false;
                this.push(session, `\r\n\x1b[90mroost: stopped\x1b[0m\r\n`);
                this.emit('changed', session.id);

                return;
            }

            const clean = exitCode === 0 && ! signal;

            session.status = clean ? 'stopped' : 'crashed';
            this.push(session, `\r\n\x1b[90mroost: exited with code ${exitCode}${signal ? ` (signal ${signal})` : ''}\x1b[0m\r\n`);

            if (session.config.autoRestart && this.mayRestart(session)) {
                this.scheduleRestart(session);
            }

            this.emit('changed', session.id);
        });

        this.emit('changed', session.id);
    }

    stop(id: string): void {
        const session = this.sessions.get(id);

        if (! session) {
            return;
        }

        this.clearRestartTimer(session);

        if (! session.pty) {
            session.status = 'stopped';
            this.emit('changed', session.id);

            return;
        }

        session.stopping = true;

        const pid = session.pty.pid;

        try {
            process.kill(-pid, 'SIGTERM');
        } catch {
            try {
                session.pty.kill();
            } catch {
                // Already gone.
            }
        }

        setTimeout(() => {
            if (session.pty && session.pty.pid === pid) {
                try {
                    process.kill(-pid, 'SIGKILL');
                } catch {
                    // Already gone.
                }
            }
        }, 3_000);
    }

    restart(id: string): void {
        const session = this.sessions.get(id);

        if (! session) {
            return;
        }

        session.recentRestarts = [];

        if (! session.pty) {
            this.start(id);

            return;
        }

        const resume = (): void => {
            this.off('changed', listener);
            this.start(id);
        };

        const listener = (changed: string): void => {
            if (changed === id && ! session.pty) {
                resume();
            }
        };

        this.on('changed', listener);
        this.stop(id);
    }

    startAll(ids: string[]): void {
        ids.forEach((id) => this.start(id));
    }

    stopAll(ids: string[]): void {
        ids.forEach((id) => this.stop(id));
    }

    killEverything(): void {
        for (const session of this.sessions.values()) {
            this.clearRestartTimer(session);

            if (! session.pty) {
                continue;
            }

            const pid = session.pty.pid;

            try {
                process.kill(-pid, 'SIGKILL');
            } catch {
                try {
                    session.pty.kill();
                } catch {
                    // Already gone.
                }
            }
        }
    }

    private resolveCwd(session: Session): string {
        const dir = session.config.workingDir;

        if (! dir) {
            return session.projectPath;
        }

        return isAbsolute(dir) ? dir : resolve(session.projectPath, dir);
    }

    private mayRestart(session: Session): boolean {
        const now = Date.now();

        session.recentRestarts = session.recentRestarts.filter((at) => now - at < RAPID_WINDOW);

        if (session.recentRestarts.length >= MAX_RAPID_RESTARTS) {
            this.push(session, `\r\n\x1b[31mroost: crashed ${MAX_RAPID_RESTARTS} times in a row, giving up on auto-restart\x1b[0m\r\n`);

            return false;
        }

        session.recentRestarts.push(now);

        return true;
    }

    private scheduleRestart(session: Session): void {
        this.clearRestartTimer(session);
        this.push(session, `\x1b[90mroost: restarting in 1s...\x1b[0m\r\n`);

        session.restartTimer = setTimeout(() => {
            session.restartTimer = null;
            session.restartCount += 1;
            this.start(session.id);
        }, RESTART_DELAY);
    }

    private clearRestartTimer(session: Session): void {
        if (! session.restartTimer) {
            return;
        }

        clearTimeout(session.restartTimer);
        session.restartTimer = null;
    }

    private push(session: Session, data: string): void {
        session.buffer += data;

        if (session.buffer.length > BUFFER_LIMIT) {
            session.buffer = session.buffer.slice(session.buffer.length - BUFFER_LIMIT);
        }

        this.seq += 1;
        session.lastSeq = this.seq;

        this.emit('data', { id: session.id, seq: this.seq, data });
    }
}
