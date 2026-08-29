import { app } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse, stringify } from 'yaml';

import type { ProcessConfig, ProcessKind } from '../shared/types';

export const CONFIG_FILENAME = 'roost.yml';

export interface ProjectConfig {
    name: string;
    processes: ProcessConfig[];
}

export interface ReadResult {
    config: ProjectConfig;
    hasConfig: boolean;
    error: string | null;
}

export function projectId(path: string): string {
    return createHash('sha1').update(path).digest('hex').slice(0, 10);
}

export function processId(project: string, processName: string): string {
    return `${project}::${processName}`;
}

export function configPath(path: string): string {
    return join(path, CONFIG_FILENAME);
}

function registryPath(): string {
    const dir = app.getPath('userData');

    if (! existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    return join(dir, 'projects.json');
}

export function readRegistry(): string[] {
    const file = registryPath();

    if (! existsSync(file)) {
        return [];
    }

    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));

        return Array.isArray(parsed?.projects) ? parsed.projects : [];
    } catch {
        return [];
    }
}

export function writeRegistry(paths: string[]): void {
    writeFileSync(registryPath(), JSON.stringify({ projects: paths }, null, 2));
}

function coerceProcess(name: string, raw: unknown): ProcessConfig | null {
    if (typeof raw === 'string') {
        return {
            name,
            kind: 'command',
            command: raw,
            workingDir: null,
            autoStart: false,
            autoRestart: false,
            env: {},
        };
    }

    if (! raw || typeof raw !== 'object') {
        return null;
    }

    const entry = raw as Record<string, unknown>;

    if (typeof entry.command !== 'string' || entry.command.trim() === '') {
        return null;
    }

    const kind: ProcessKind = entry.kind === 'terminal' ? 'terminal' : 'command';
    const env: Record<string, string> = {};

    if (entry.env && typeof entry.env === 'object') {
        for (const [key, value] of Object.entries(entry.env as Record<string, unknown>)) {
            env[key] = String(value);
        }
    }

    return {
        name,
        kind,
        command: entry.command,
        workingDir: typeof entry.working_dir === 'string' && entry.working_dir !== '' ? entry.working_dir : null,
        autoStart: entry.auto_start === true,
        autoRestart: entry.auto_restart === true,
        env,
    };
}

function parseFile(file: string, path: string): { config: ProjectConfig; error: string | null } {
    const fallback: ProjectConfig = { name: basename(path), processes: [] };

    try {
        const raw = parse(readFileSync(file, 'utf8')) as Record<string, unknown> | null;

        if (! raw || typeof raw !== 'object') {
            return { config: fallback, error: null };
        }

        const processes: ProcessConfig[] = [];
        const entries = raw.processes;

        if (entries && typeof entries === 'object') {
            for (const [name, value] of Object.entries(entries as Record<string, unknown>)) {
                const parsed = coerceProcess(name, value);

                if (parsed) {
                    processes.push(parsed);
                }
            }
        }

        return {
            config: {
                name: typeof raw.name === 'string' ? raw.name : basename(path),
                processes,
            },
            error: null,
        };
    } catch (error) {
        return { config: fallback, error: (error as Error).message };
    }
}

export function readProjectConfig(path: string): ReadResult {
    const file = configPath(path);

    if (! existsSync(file)) {
        return {
            config: { name: basename(path), processes: [] },
            hasConfig: false,
            error: null,
        };
    }

    const { config, error } = parseFile(file, path);

    return { config, hasConfig: true, error };
}

export function writeProjectConfig(path: string, config: ProjectConfig): void {
    const processes: Record<string, unknown> = {};

    for (const entry of config.processes) {
        const body: Record<string, unknown> = {
            command: entry.command,
            auto_start: entry.autoStart,
            auto_restart: entry.autoRestart,
        };

        if (entry.kind === 'terminal') {
            body.kind = 'terminal';
        }

        if (entry.workingDir) {
            body.working_dir = entry.workingDir;
        }

        if (Object.keys(entry.env).length > 0) {
            body.env = entry.env;
        }

        processes[entry.name] = body;
    }

    writeFileSync(configPath(path), stringify({ name: config.name, processes }));
}

export function ensureConfig(path: string): boolean {
    if (existsSync(configPath(path))) {
        return false;
    }

    writeProjectConfig(path, { name: basename(path), processes: [] });

    return true;
}

export function saveProcess(path: string, originalName: string | null, entry: ProcessConfig): string | null {
    const name = entry.name.trim();

    if (name === '') {
        return 'A command needs a name.';
    }

    if (entry.command.trim() === '') {
        return 'A command needs something to run.';
    }

    const { config } = readProjectConfig(path);
    const processes = [...config.processes];
    const clash = processes.findIndex((existing) => existing.name === name);
    const index = originalName ? processes.findIndex((existing) => existing.name === originalName) : -1;

    if (clash !== -1 && clash !== index) {
        return `This project already has a command called "${name}".`;
    }

    const next: ProcessConfig = { ...entry, name };

    if (index === -1) {
        processes.push(next);
    } else {
        processes[index] = next;
    }

    writeProjectConfig(path, { name: config.name, processes });

    return null;
}

export function deleteProcess(path: string, name: string): void {
    const { config } = readProjectConfig(path);

    writeProjectConfig(path, {
        name: config.name,
        processes: config.processes.filter((entry) => entry.name !== name),
    });
}
