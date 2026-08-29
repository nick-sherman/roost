import { app, Menu, nativeImage, Tray } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { AppState } from '../shared/types';

type Health = 'green' | 'amber' | 'red' | 'grey';

function assetsDir(): string {
    const packaged = join(process.resourcesPath, 'assets');

    return existsSync(packaged) ? packaged : join(__dirname, '..', '..', 'assets');
}

function iconFor(health: Health) {
    const image = nativeImage.createFromPath(join(assetsDir(), `tray-${health}.png`));

    return image.isEmpty() ? image : image.resize({ width: 16, height: 16 });
}

function healthOf(state: AppState): Health {
    const processes = state.projects.flatMap((project) => project.processes);
    const crashed = processes.filter((entry) => entry.status === 'crashed');
    const running = processes.filter((entry) => entry.status === 'running');

    if (crashed.length > 0) {
        return 'red';
    }

    if (running.length === 0) {
        return 'grey';
    }

    const stoppedButWanted = processes.filter(
        (entry) => entry.autoStart && entry.status === 'stopped',
    );

    return stoppedButWanted.length > 0 ? 'amber' : 'green';
}

export interface TrayActions {
    show: () => void;
    focusProcess: (id: string) => void;
    restart: (id: string) => void;
    startProject: (projectId: string) => void;
    stopProject: (projectId: string) => void;
    quit: () => void;
}

export class TrayController {
    private tray: Tray | null = null;

    constructor(private actions: TrayActions) {}

    build(): void {
        this.tray = new Tray(iconFor('grey'));
        this.tray.setToolTip('Roost');
        this.tray.on('click', () => this.actions.show());
    }

    update(state: AppState): void {
        if (! this.tray) {
            return;
        }

        const health = healthOf(state);
        const running = state.projects.flatMap((p) => p.processes).filter((p) => p.status === 'running').length;
        const crashed = state.projects.flatMap((p) => p.processes).filter((p) => p.status === 'crashed').length;

        this.tray.setImage(iconFor(health));
        this.tray.setToolTip(`Roost — ${running} running${crashed > 0 ? `, ${crashed} crashed` : ''}`);

        const projectItems: Electron.MenuItemConstructorOptions[] = state.projects.map((project) => ({
            label: project.name,
            submenu: [
                { label: 'Start all', click: () => this.actions.startProject(project.id) },
                { label: 'Stop all', click: () => this.actions.stopProject(project.id) },
                { type: 'separator' },
                ...project.processes.map((entry) => ({
                    label: `${statusGlyph(entry.status)}  ${entry.name}`,
                    submenu: [
                        { label: 'Show', click: () => this.actions.focusProcess(entry.id) },
                        { label: 'Restart', click: () => this.actions.restart(entry.id) },
                    ],
                })),
            ],
        }));

        this.tray.setContextMenu(Menu.buildFromTemplate([
            { label: `${running} running${crashed > 0 ? `, ${crashed} crashed` : ''}`, enabled: false },
            { type: 'separator' },
            ...(projectItems.length > 0 ? projectItems : [{ label: 'No projects yet', enabled: false }]),
            { type: 'separator' },
            { label: 'Open Roost', click: () => this.actions.show() },
            { label: 'Quit Roost', click: () => this.actions.quit() },
        ]));
    }

    destroy(): void {
        this.tray?.destroy();
        this.tray = null;
    }
}

function statusGlyph(status: string): string {
    if (status === 'running') {
        return '●';
    }

    if (status === 'crashed') {
        return '✖';
    }

    if (status === 'starting') {
        return '◐';
    }

    return '○';
}

app.on('will-quit', () => {
    // Keeps the tray from lingering after the app closes.
});
