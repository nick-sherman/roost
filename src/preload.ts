import { contextBridge, ipcRenderer } from 'electron';

import type { AppState, AttachResult, ProcessConfig, PtyChunk, SaveResult } from './shared/types';

const api = {
    defaultShell: process.env.SHELL || '/bin/zsh',

    getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),
    addProject: (): Promise<AppState> => ipcRenderer.invoke('projects:add'),
    removeProject: (path: string): Promise<AppState> => ipcRenderer.invoke('projects:remove', path),
    reload: (): Promise<AppState> => ipcRenderer.invoke('projects:reload'),
    revealConfig: (path: string): Promise<boolean> => ipcRenderer.invoke('projects:revealConfig', path),
    createConfig: (path: string): Promise<boolean> => ipcRenderer.invoke('projects:createConfig', path),
    openConfig: (path: string): Promise<string> => ipcRenderer.invoke('projects:openConfig', path),
    saveProcess: (path: string, originalName: string | null, entry: ProcessConfig): Promise<SaveResult> =>
        ipcRenderer.invoke('proc:save', path, originalName, entry),
    deleteProcess: (path: string, name: string): Promise<void> =>
        ipcRenderer.invoke('proc:delete', path, name),

    start: (id: string): Promise<void> => ipcRenderer.invoke('proc:start', id),
    stop: (id: string): Promise<void> => ipcRenderer.invoke('proc:stop', id),
    restart: (id: string): Promise<void> => ipcRenderer.invoke('proc:restart', id),
    clear: (id: string): Promise<void> => ipcRenderer.invoke('proc:clear', id),
    attach: (id: string): Promise<AttachResult> => ipcRenderer.invoke('proc:attach', id),
    startProject: (id: string): Promise<void> => ipcRenderer.invoke('proc:startProject', id),
    stopProject: (id: string): Promise<void> => ipcRenderer.invoke('proc:stopProject', id),

    write: (id: string, data: string): void => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number): void => ipcRenderer.send('pty:resize', id, cols, rows),

    onState: (handler: (state: AppState) => void): (() => void) => {
        const listener = (_event: unknown, state: AppState) => handler(state);

        ipcRenderer.on('state', listener);

        return () => ipcRenderer.removeListener('state', listener);
    },

    onData: (handler: (chunk: PtyChunk) => void): (() => void) => {
        const listener = (_event: unknown, chunk: PtyChunk) => handler(chunk);

        ipcRenderer.on('pty:data', listener);

        return () => ipcRenderer.removeListener('pty:data', listener);
    },

    onFocusProcess: (handler: (id: string) => void): (() => void) => {
        const listener = (_event: unknown, id: string) => handler(id);

        ipcRenderer.on('focus:process', listener);

        return () => ipcRenderer.removeListener('focus:process', listener);
    },
};

contextBridge.exposeInMainWorld('roost', api);

export type RoostApi = typeof api;
