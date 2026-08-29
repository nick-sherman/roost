import { createRoot } from 'react-dom/client';

import { App } from './App';
import '../index.css';
import '@xterm/xterm/css/xterm.css';

const container = document.getElementById('root');

if (! container) {
    throw new Error('Roost could not find its root element.');
}

createRoot(container).render(<App />);
