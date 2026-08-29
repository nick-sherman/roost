export type ProcessKind = 'command' | 'terminal';

export type ProcessStatus = 'stopped' | 'starting' | 'running' | 'crashed';

export interface ProcessConfig {
    name: string;
    kind: ProcessKind;
    command: string;
    workingDir: string | null;
    autoStart: boolean;
    autoRestart: boolean;
    env: Record<string, string>;
}

export interface ProcessState extends ProcessConfig {
    id: string;
    projectId: string;
    status: ProcessStatus;
    pid: number | null;
    startedAt: number | null;
    exitCode: number | null;
    exitSignal: number | null;
    restartCount: number;
}

export interface ProjectState {
    id: string;
    name: string;
    path: string;
    hasConfig: boolean;
    configError: string | null;
    processes: ProcessState[];
}

export interface SaveResult {
    error: string | null;
}

export interface AppState {
    projects: ProjectState[];
}

export interface PtyChunk {
    id: string;
    seq: number;
    data: string;
}

export interface AttachResult {
    text: string;
    lastSeq: number;
}
