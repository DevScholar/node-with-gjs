// gi-loader.ts
// Universal GI namespace loader for Node.js, Bun, and Deno
// Usage:
//   import { imports } from './gi-loader.ts';
//   const { Gtk, Gdk } = imports.gi;
//
//   // Or specify versions:
//   imports.gi.versions.Gtk = '4.0';
//   const Gtk = imports.gi.Gtk;

import { init, imports } from './src/index.ts';

init();

export { imports };
