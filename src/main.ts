import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execFile } from 'node:child_process';
import started from 'electron-squirrel-startup';
import { join } from 'node:path';

import {
    configPath,
    deleteProcess,
    ensureConfig,
    processId,
    projectId,
    readProjectConfig,
    readRegistry,
    saveProcess,
    writeRegistry,
} from './main/config';
import { ProcessManager } from './main/process-manager';
import { TrayController } from './main/tray';
import type { AppState, ProcessConfig, ProjectState, PtyChunk, SaveResult } from './shared/types';

if (started) {
    app.quit();
}

const manager = new ProcessManager();

let mainWindow: BrowserWindow | null = null;
let tray: TrayController | null = null;
let quitting = false;
let projectPaths: string[] = [];
let pushTimer: NodeJS.Timeout | null = null;

const CURSOR_BUNDLE_ID = 'com.todesktop.230313mzl4w4u92';

function syncProject(path: string): ProjectState {
    const id = projectId(path);
    const { config, hasConfig, error } = readProjectConfig(path);
    const entries = config.processes;
    const liveIds = new Set<string>();

    for (const entry of entries) {
        const pid = processId(id, entry.name);

        liveIds.add(pid);
        manager.upsert(pid, id, path, entry);
    }

    for (const stale of manager.idsForProject(id)) {
        if (! liveIds.has(stale)) {
            manager.forget(stale);
        }
    }

    return {
        id,
        name: config.name,
        path,
        hasConfig,
        configError: error,
        processes: entries
            .map((entry) => manager.state(processId(id, entry.name)))
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    };
}

function buildState(): AppState {
    return { projects: projectPaths.map((path) => syncProject(path)) };
}

function pushState(): void {
    if (pushTimer) {
        return;
    }

    pushTimer = setTimeout(() => {
        pushTimer = null;

        const state = buildState();

        mainWindow?.webContents.send('state', state);
        tray?.update(state);
    }, 30);
}

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 780,
        minHeight: 480,
        title: 'Roost',
        titleBarStyle: 'hidden',
        // 12px buttons topped at 20 centre on 26, the middle of the 52px .sidebar-head.
        trafficLightPosition: { x: 20, y: 20 },
        backgroundColor: '#14161a',
        webPreferences: {
            preload: join(__dirname, 'preload.js'),
        },
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
        mainWindow.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
    }

    mainWindow.on('close', (event) => {
        if (quitting) {
            return;
        }

        event.preventDefault();
        mainWindow?.hide();

        if (process.platform === 'darwin') {
            app.dock?.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.webContents.on('did-finish-load', () => pushState());
}

function openInCursor(file: string): Promise<string> {
    return new Promise((resolve) => {
        execFile('open', ['-b', CURSOR_BUNDLE_ID, file], (error) => {
            if (! error) {
                resolve('');

                return;
            }

            void shell.openPath(file).then(resolve);
        });
    });
}

function showWindow(): void {
    if (! mainWindow) {
        createWindow();
    }

    app.dock?.show();
    mainWindow?.show();
    mainWindow?.focus();
}

function autoStartAll(): void {
    if (process.env.ROOST_NO_AUTOSTART === '1') {
        return;
    }

    for (const project of buildState().projects) {
        for (const entry of project.processes) {
            if (entry.autoStart && entry.status === 'stopped') {
                manager.start(entry.id);
            }
        }
    }
}

manager.on('changed', () => pushState());

manager.on('data', (chunk: PtyChunk) => {
    mainWindow?.webContents.send('pty:data', chunk);
});

function registerIpc(): void {
    ipcMain.handle('state:get', () => buildState());

    ipcMain.handle('projects:add', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Add a project folder',
            properties: ['openDirectory', 'createDirectory'],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return buildState();
        }

        for (const path of result.filePaths) {
            if (! projectPaths.includes(path)) {
                projectPaths.push(path);
            }
        }

        writeRegistry(projectPaths);
        pushState();

        return buildState();
    });

    ipcMain.handle('projects:remove', (_event, path: string) => {
        const id = projectId(path);

        manager.idsForProject(id).forEach((entry) => manager.forget(entry));
        projectPaths = projectPaths.filter((entry) => entry !== path);
        writeRegistry(projectPaths);
        pushState();

        return buildState();
    });

    ipcMain.handle('projects:reload', () => {
        pushState();

        return buildState();
    });

    ipcMain.handle('projects:createConfig', (_event, path: string) => {
        const created = ensureConfig(path);

        pushState();

        return created;
    });

    ipcMain.handle('projects:openConfig', async (_event, path: string) => {
        ensureConfig(path);

        return openInCursor(configPath(path));
    });

    ipcMain.handle('projects:revealConfig', (_event, path: string) => {
        ensureConfig(path);
        shell.showItemInFolder(configPath(path));

        return true;
    });

    ipcMain.handle(
        'proc:save',
        (_event, path: string, originalName: string | null, entry: ProcessConfig): SaveResult => {
            ensureConfig(path);

            const error = saveProcess(path, originalName, entry);

            if (error) {
                return { error };
            }

            const id = projectId(path);
            const previous = originalName ? manager.state(processId(id, originalName)) : null;
            const wasRunning = previous?.status === 'running' || previous?.status === 'starting';
            const renamed = originalName !== null && originalName !== entry.name.trim();

            if (wasRunning && renamed) {
                manager.stop(processId(id, originalName as string));
            }

            pushState();

            if (wasRunning && ! renamed) {
                manager.restart(processId(id, entry.name.trim()));
            }

            return { error: null };
        },
    );

    ipcMain.handle('proc:delete', (_event, path: string, name: string) => {
        manager.forget(processId(projectId(path), name));
        deleteProcess(path, name);
        pushState();
    });

    ipcMain.handle('proc:start', (_event, id: string) => manager.start(id));
    ipcMain.handle('proc:stop', (_event, id: string) => manager.stop(id));
    ipcMain.handle('proc:restart', (_event, id: string) => manager.restart(id));
    ipcMain.handle('proc:clear', (_event, id: string) => manager.clear(id));
    ipcMain.handle('proc:attach', (_event, id: string) => manager.attach(id));

    ipcMain.handle('proc:startProject', (_event, id: string) => {
        for (const entry of manager.idsForProject(id)) {
            const state = manager.state(entry);

            if (state && state.kind === 'command') {
                manager.start(entry);
            }
        }
    });

    ipcMain.handle('proc:stopProject', (_event, id: string) => manager.stopAll(manager.idsForProject(id)));

    ipcMain.on('pty:write', (_event, id: string, data: string) => manager.write(id, data));
    ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => manager.resize(id, cols, rows));
}

app.on('ready', () => {
    projectPaths = readRegistry();

    registerIpc();
    createWindow();

    tray = new TrayController({
        show: () => showWindow(),
        focusProcess: (id) => {
            showWindow();
            mainWindow?.webContents.send('focus:process', id);
        },
        restart: (id) => manager.restart(id),
        startProject: (id) => {
            for (const entry of manager.idsForProject(id)) {
                const state = manager.state(entry);

                if (state && state.kind === 'command') {
                    manager.start(entry);
                }
            }
        },
        stopProject: (id) => manager.stopAll(manager.idsForProject(id)),
        quit: () => {
            quitting = true;
            app.quit();
        },
    });

    tray.build();
    autoStartAll();
    pushState();
});

app.on('window-all-closed', () => {
    // The tray keeps Roost alive; quitting happens through the tray menu or Cmd+Q.
});

app.on('activate', () => showWindow());

app.on('before-quit', () => {
    quitting = true;
    manager.killEverything();
});

app.on('will-quit', () => {
    tray?.destroy();
});
