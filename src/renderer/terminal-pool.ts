import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';

import type { AttachResult, PtyChunk } from '../shared/types';

const THEME = {
    background: '#14161a',
    foreground: '#d7dae0',
    cursor: '#7aa2f7',
    selectionBackground: '#2a3140',
    black: '#1a1d23',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#c0caf5',
    brightBlack: '#565f89',
    brightRed: '#ff7a93',
    brightGreen: '#b9f27c',
    brightYellow: '#ff9e64',
    brightBlue: '#7da6ff',
    brightMagenta: '#bb9af7',
    brightCyan: '#0db9d7',
    brightWhite: '#d5d6db',
};

interface Pane {
    element: HTMLDivElement;
    term: Terminal;
    fit: FitAddon;
    ready: boolean;
    lastSeq: number;
    queue: PtyChunk[];
}

export class TerminalPool {
    private panes = new Map<string, Pane>();

    private activeId: string | null = null;

    private observer: ResizeObserver;

    constructor(
        private root: HTMLElement,
        private handlers: {
            onInput: (id: string, data: string) => void;
            onResize: (id: string, cols: number, rows: number) => void;
            attach: (id: string) => Promise<AttachResult>;
        },
    ) {
        this.observer = new ResizeObserver(() => this.fitActive());
        this.observer.observe(root);
    }

    async show(id: string): Promise<void> {
        if (this.activeId === id) {
            this.fitActive();

            return;
        }

        const previous = this.activeId ? this.panes.get(this.activeId) : null;

        if (previous) {
            previous.element.style.display = 'none';
        }

        this.activeId = id;

        const pane = this.panes.get(id) ?? this.create(id);

        pane.element.style.display = 'block';
        this.fitActive();
        pane.term.focus();
    }

    write(chunk: PtyChunk): void {
        const pane = this.panes.get(chunk.id);

        if (! pane) {
            return;
        }

        if (! pane.ready) {
            pane.queue.push(chunk);

            return;
        }

        if (chunk.seq <= pane.lastSeq) {
            return;
        }

        pane.lastSeq = chunk.seq;
        pane.term.write(chunk.data);
    }

    clear(id: string): void {
        const pane = this.panes.get(id);

        pane?.term.clear();
        pane?.term.reset();
    }

    forget(id: string): void {
        const pane = this.panes.get(id);

        if (! pane) {
            return;
        }

        pane.term.dispose();
        pane.element.remove();
        this.panes.delete(id);

        if (this.activeId === id) {
            this.activeId = null;
        }
    }

    dispose(): void {
        this.observer.disconnect();

        for (const id of [...this.panes.keys()]) {
            this.forget(id);
        }
    }

    private create(id: string): Pane {
        const element = document.createElement('div');

        element.className = 'terminal-pane';

        const term = new Terminal({
            allowProposedApi: true,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12.5,
            lineHeight: 1.25,
            cursorBlink: true,
            scrollback: 20_000,
            theme: THEME,
        });

        const fit = new FitAddon();

        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());

        this.root.appendChild(element);
        term.open(element);

        term.onData((data) => this.handlers.onInput(id, data));
        term.onResize(({ cols, rows }) => this.handlers.onResize(id, cols, rows));

        const pane: Pane = { element, term, fit, ready: false, lastSeq: 0, queue: [] };

        this.panes.set(id, pane);

        void this.handlers.attach(id).then((result) => {
            if (result.text) {
                term.write(result.text);
            }

            pane.lastSeq = result.lastSeq;
            pane.ready = true;

            for (const queued of pane.queue) {
                if (queued.seq > pane.lastSeq) {
                    pane.lastSeq = queued.seq;
                    term.write(queued.data);
                }
            }

            pane.queue = [];
        });

        return pane;
    }

    private fitActive(): void {
        if (! this.activeId) {
            return;
        }

        const pane = this.panes.get(this.activeId);

        if (! pane || pane.element.clientHeight === 0) {
            return;
        }

        try {
            pane.fit.fit();
        } catch {
            // The pane is not laid out yet.
        }
    }
}
