// gi-loader.ts
// Universal GI namespace loader for Node.js, Bun, and Deno
// Usage:
//   import { loadGi } from './gi-loader.ts';
//   const Gtk = loadGi('Gtk', '4.0');

import { init, loadGiNamespace } from './src/index.ts';

init();

export function loadGi(namespace: string, version: string = '') {
    return loadGiNamespace(namespace, version);
}
