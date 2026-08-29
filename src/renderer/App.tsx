import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type EditorTarget, ProcessEditor } from './ProcessEditor';
import type { AppState, ProcessState, ProjectState } from '../shared/types';
import { TerminalPool } from './terminal-pool';

const EMPTY: AppState = { projects: [] };

function statusClass(status: string): string {
    return `dot dot-${status}`;
}

function uptime(startedAt: number | null): string {
    if (! startedAt) {
        return '';
    }

    const seconds = Math.floor((Date.now() - startedAt) / 1000);

    if (seconds < 60) {
        return `${seconds}s`;
    }

    if (seconds < 3600) {
        return `${Math.floor(seconds / 60)}m`;
    }

    if (seconds < 86400) {
        return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    }

    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function App(): JSX.Element {
    const [state, setState] = useState<AppState>(EMPTY);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [tick, setTick] = useState(0);
    const [editing, setEditing] = useState<EditorTarget | null>(null);

    const hostRef = useRef<HTMLDivElement | null>(null);
    const poolRef = useRef<TerminalPool | null>(null);

    useEffect(() => {
        if (! hostRef.current) {
            return;
        }

        const pool = new TerminalPool(hostRef.current, {
            onInput: (id, data) => window.roost.write(id, data),
            onResize: (id, cols, rows) => window.roost.resize(id, cols, rows),
            attach: (id) => window.roost.attach(id),
        });

        poolRef.current = pool;

        const offData = window.roost.onData((chunk) => pool.write(chunk));

        return () => {
            offData();
            pool.dispose();
            poolRef.current = null;
        };
    }, []);

    useEffect(() => {
        void window.roost.getState().then(setState);

        const offState = window.roost.onState(setState);
        const offFocus = window.roost.onFocusProcess((id) => setSelectedId(id));

        return () => {
            offState();
            offFocus();
        };
    }, []);

    useEffect(() => {
        const timer = setInterval(() => setTick((value) => value + 1), 1000);

        return () => clearInterval(timer);
    }, []);

    const allProcesses = useMemo(
        () => state.projects.flatMap((project) => project.processes),
        [state],
    );

    useEffect(() => {
        if (selectedId && allProcesses.some((entry) => entry.id === selectedId)) {
            return;
        }

        setSelectedId(allProcesses[0]?.id ?? null);
    }, [allProcesses, selectedId]);

    useEffect(() => {
        if (selectedId) {
            void poolRef.current?.show(selectedId);
        }
    }, [selectedId]);

    const selected = allProcesses.find((entry) => entry.id === selectedId) ?? null;
    const selectedProject = state.projects.find((project) => project.id === selected?.projectId) ?? null;

    const clearSelected = useCallback(() => {
        if (! selectedId) {
            return;
        }

        void window.roost.clear(selectedId);
        poolRef.current?.clear(selectedId);
    }, [selectedId]);

    return (
        <div className="app">
            <aside className="sidebar">
                <header className="sidebar-head">
                    <span className="brand">Roost</span>
                    <button className="ghost" title="Add project" onClick={() => void window.roost.addProject().then(setState)}>+</button>
                </header>

                <div className="sidebar-body">
                    {state.projects.length === 0 && (
                        <p className="empty">No projects yet. Hit <strong>+</strong> to add a folder.</p>
                    )}

                    {state.projects.map((project) => (
                        <ProjectRow
                            key={project.id}
                            project={project}
                            selectedId={selectedId}
                            collapsed={collapsed[project.id] === true}
                            onToggle={() => setCollapsed((current) => ({ ...current, [project.id]: ! current[project.id] }))}
                            onSelect={setSelectedId}
                            onRefresh={setState}
                            onEdit={setEditing}
                        />
                    ))}
                </div>

                <footer className="sidebar-foot">
                    <button className="ghost small" onClick={() => void window.roost.reload().then(setState)}>Reload configs</button>
                </footer>
            </aside>

            <main className="main">
                <header className="toolbar">
                    {selected ? (
                        <>
                            <span className={statusClass(selected.status)} />
                            <div className="toolbar-title">
                                <strong>{selected.name}</strong>
                                <span className="muted">{selectedProject?.name}</span>
                            </div>
                            <code className="command" title={selected.command}>{selected.kind === 'terminal' ? 'shell' : selected.command}</code>
                            <span className="spacer" />
                            <span className="muted" data-tick={tick}>
                                {selected.status === 'running' ? uptime(selected.startedAt) : selected.status}
                                {selected.restartCount > 0 ? ` · ${selected.restartCount} restarts` : ''}
                            </span>
                            {selected.status === 'running' || selected.status === 'starting' ? (
                                <button onClick={() => void window.roost.stop(selected.id)}>Stop</button>
                            ) : (
                                <button onClick={() => void window.roost.start(selected.id)}>Start</button>
                            )}
                            <button onClick={() => void window.roost.restart(selected.id)}>Restart</button>
                            {selectedProject && (
                                <button
                                    className="ghost"
                                    onClick={() => setEditing({ project: selectedProject, original: selected, kind: selected.kind })}
                                >
                                    Edit
                                </button>
                            )}
                            <button className="ghost" onClick={clearSelected}>Clear</button>
                        </>
                    ) : (
                        <span className="muted">Nothing selected</span>
                    )}
                </header>

                {selectedProject?.configError && (
                    <div className="banner">Config error in {selectedProject.name}: {selectedProject.configError}</div>
                )}

                <div className="terminal-host" ref={hostRef} />
            </main>

            {editing && (
                <ProcessEditor
                    target={editing}
                    onClose={() => {
                        setEditing(null);
                        void window.roost.reload().then(setState);
                    }}
                />
            )}
        </div>
    );
}

interface ProjectRowProps {
    project: ProjectState;
    selectedId: string | null;
    collapsed: boolean;
    onToggle: () => void;
    onSelect: (id: string) => void;
    onRefresh: (state: AppState) => void;
    onEdit: (target: EditorTarget) => void;
}

function ProjectRow({ project, selectedId, collapsed, onToggle, onSelect, onRefresh, onEdit }: ProjectRowProps): JSX.Element {
    const running = project.processes.filter((entry) => entry.status === 'running').length;
    const crashed = project.processes.filter((entry) => entry.status === 'crashed').length;

    return (
        <section className="project">
            <div className="project-head">
                <button className="twisty" onClick={onToggle}>{collapsed ? '▸' : '▾'}</button>
                <span className="project-name" title={project.path}>{project.name}</span>
                <span className={`badge ${crashed > 0 ? 'badge-bad' : ''}`}>{crashed > 0 ? `${crashed} down` : `${running}`}</span>
            </div>

            {! collapsed && (
                <>
                    <div className="project-actions">
                        <button className="ghost tiny" onClick={() => void window.roost.startProject(project.id)}>Start all</button>
                        <button className="ghost tiny" onClick={() => void window.roost.stopProject(project.id)}>Stop all</button>
                        <button className="ghost tiny" onClick={() => void window.roost.openConfig(project.path)}>roost.yml</button>
                        <button className="ghost tiny danger" onClick={() => void window.roost.removeProject(project.path).then(onRefresh)}>Remove</button>
                    </div>

                    {project.processes.map((entry) => (
                        <ProcessRow
                            key={entry.id}
                            entry={entry}
                            projectPath={project.path}
                            selected={entry.id === selectedId}
                            onSelect={() => onSelect(entry.id)}
                            onEdit={() => onEdit({ project, original: entry, kind: entry.kind })}
                            onDeleted={() => void window.roost.reload().then(onRefresh)}
                        />
                    ))}

                    <div className="add-row">
                        <button className="ghost tiny" onClick={() => onEdit({ project, original: null, kind: 'command' })}>+ Command</button>
                        <button className="ghost tiny" onClick={() => onEdit({ project, original: null, kind: 'terminal' })}>+ Terminal</button>
                    </div>
                </>
            )}
        </section>
    );
}

interface ProcessRowProps {
    entry: ProcessState;
    projectPath: string;
    selected: boolean;
    onSelect: () => void;
    onEdit: () => void;
    onDeleted: () => void;
}

function ProcessRow({ entry, projectPath, selected, onSelect, onEdit, onDeleted }: ProcessRowProps): JSX.Element {
    const [confirming, setConfirming] = useState(false);

    if (confirming) {
        return (
            <div className="process process-confirm">
                <span className="process-name">Delete {entry.name}?</span>
                <button
                    className="ghost tiny danger"
                    onClick={async () => {
                        await window.roost.deleteProcess(projectPath, entry.name);
                        setConfirming(false);
                        onDeleted();
                    }}
                >
                    Delete
                </button>
                <button className="ghost tiny" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
        );
    }

    return (
        <div
            className={`process ${selected ? 'process-selected' : ''}`}
            onClick={onSelect}
            onDoubleClick={onEdit}
        >
            <span className={statusClass(entry.status)} />
            <span className="process-name">{entry.name}</span>
            {entry.kind === 'terminal' && <span className="pill" title="A plain shell">$</span>}
            {entry.autoRestart && <span className="pill" title="Auto-restarts on crash">↻</span>}
            <span className="row-actions">
                {entry.status === 'running' || entry.status === 'starting' ? (
                    <button
                        className="ghost tiny"
                        title="Stop"
                        onClick={(event) => {
                            event.stopPropagation();
                            void window.roost.stop(entry.id);
                        }}
                    >
                        ■
                    </button>
                ) : (
                    <button
                        className="ghost tiny"
                        title="Start"
                        onClick={(event) => {
                            event.stopPropagation();
                            void window.roost.start(entry.id);
                        }}
                    >
                        ▶
                    </button>
                )}
                <button
                    className="ghost tiny"
                    title="Restart"
                    onClick={(event) => {
                        event.stopPropagation();
                        void window.roost.restart(entry.id);
                    }}
                >
                    ↻
                </button>
                <button
                    className="ghost tiny"
                    title="Edit"
                    onClick={(event) => {
                        event.stopPropagation();
                        onEdit();
                    }}
                >
                    ✎
                </button>
                <button
                    className="ghost tiny danger"
                    title="Delete"
                    onClick={(event) => {
                        event.stopPropagation();
                        setConfirming(true);
                    }}
                >
                    ✕
                </button>
            </span>
        </div>
    );
}
