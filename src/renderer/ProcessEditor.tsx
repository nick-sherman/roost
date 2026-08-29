import { type JSX, useEffect, useState } from 'react';

import type { ProcessConfig, ProcessKind, ProjectState } from '../shared/types';

function envToText(env: Record<string, string>): string {
    return Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
}

function textToEnv(text: string): { env: Record<string, string>; error: string | null } {
    const env: Record<string, string> = {};

    for (const line of text.split('\n')) {
        const trimmed = line.trim();

        if (trimmed === '' || trimmed.startsWith('#')) {
            continue;
        }

        const split = trimmed.indexOf('=');

        if (split <= 0) {
            return { env: {}, error: `Cannot read this line as KEY=value: "${trimmed}"` };
        }

        env[trimmed.slice(0, split).trim()] = trimmed.slice(split + 1).trim();
    }

    return { env, error: null };
}

export interface EditorTarget {
    project: ProjectState;
    original: ProcessConfig | null;
    kind: ProcessKind;
}

interface Props {
    target: EditorTarget;
    onClose: () => void;
}

export function ProcessEditor({ target, onClose }: Props): JSX.Element {
    const { project, original } = target;
    const kind = original?.kind ?? target.kind;
    const isTerminal = kind === 'terminal';

    const [name, setName] = useState(original?.name ?? (isTerminal ? 'Terminal' : ''));
    const [command, setCommand] = useState(original?.command ?? window.roost.defaultShell);
    const [workingDir, setWorkingDir] = useState(original?.workingDir ?? '');
    const [autoStart, setAutoStart] = useState(original?.autoStart ?? false);
    const [autoRestart, setAutoRestart] = useState(original?.autoRestart ?? false);
    const [envText, setEnvText] = useState(envToText(original?.env ?? {}));
    const [error, setError] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const save = async (): Promise<void> => {
        const parsed = textToEnv(envText);

        if (parsed.error) {
            setError(parsed.error);

            return;
        }

        setSaving(true);

        const entry: ProcessConfig = {
            name: name.trim(),
            kind,
            command: isTerminal ? window.roost.defaultShell : command.trim(),
            workingDir: workingDir.trim() === '' ? null : workingDir.trim(),
            autoStart,
            autoRestart,
            env: parsed.env,
        };

        const result = await window.roost.saveProcess(project.path, original?.name ?? null, entry);

        setSaving(false);

        if (result.error) {
            setError(result.error);

            return;
        }

        onClose();
    };

    const remove = async (): Promise<void> => {
        if (! original) {
            return;
        }

        await window.roost.deleteProcess(project.path, original.name);
        onClose();
    };

    return (
        <div className="scrim" onMouseDown={onClose}>
            <div className="sheet" onMouseDown={(event) => event.stopPropagation()}>
                <header className="sheet-head">
                    <strong>{original ? `Edit ${original.name}` : isTerminal ? 'New terminal' : 'New command'}</strong>
                    <span className="muted">{project.name}</span>
                </header>

                <label className="field">
                    <span>Name</span>
                    <input value={name} placeholder="Dev Server" onChange={(event) => setName(event.target.value)} autoFocus />
                </label>

                {isTerminal ? (
                    <p className="note">
                        A terminal is a plain <code>{window.roost.defaultShell}</code> waiting in the project folder.
                        Nothing runs until you type it.
                    </p>
                ) : (
                    <label className="field">
                        <span>Command</span>
                        <textarea
                            value={command}
                            rows={2}
                            placeholder="composer dev"
                            spellCheck={false}
                            onChange={(event) => setCommand(event.target.value)}
                        />
                    </label>
                )}

                <label className="field">
                    <span>Working directory</span>
                    <input
                        value={workingDir}
                        placeholder={project.path}
                        spellCheck={false}
                        onChange={(event) => setWorkingDir(event.target.value)}
                    />
                    <small>Blank means the project folder. Relative paths resolve from there.</small>
                </label>

                <div className="field-row">
                    <label className="check">
                        <input type="checkbox" checked={autoStart} onChange={(event) => setAutoStart(event.target.checked)} />
                        <span>{isTerminal ? 'Open when Roost launches' : 'Start when Roost launches'}</span>
                    </label>
                    {! isTerminal && (
                        <label className="check">
                            <input type="checkbox" checked={autoRestart} onChange={(event) => setAutoRestart(event.target.checked)} />
                            <span>Restart if it crashes</span>
                        </label>
                    )}
                </div>

                <label className="field">
                    <span>Environment</span>
                    <textarea
                        value={envText}
                        rows={3}
                        placeholder={'KEY=value\nANOTHER=thing'}
                        spellCheck={false}
                        onChange={(event) => setEnvText(event.target.value)}
                    />
                </label>

                {error && <p className="sheet-error">{error}</p>}

                <footer className="sheet-foot">
                    {original && (
                        confirmingDelete ? (
                            <>
                                <span className="muted">Delete {original.name}?</span>
                                <button className="ghost danger" onClick={() => void remove()}>Yes, delete</button>
                                <button className="ghost" onClick={() => setConfirmingDelete(false)}>Keep it</button>
                            </>
                        ) : (
                            <button className="ghost danger" onClick={() => setConfirmingDelete(true)}>Delete</button>
                        )
                    )}
                    <span className="spacer" />
                    <button className="ghost" onClick={onClose}>Cancel</button>
                    <button className="primary" disabled={saving} onClick={() => void save()}>
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                </footer>
            </div>
        </div>
    );
}
