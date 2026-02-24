// Run: node start.js examples/console/await-delay/await-delay.ts
import { imports } from '../../../gi-loader.ts';

imports.gi.GLib;

print('0s');
await new Promise(resolve => setTimeout(resolve, 1000));
print("1s");
await new Promise(resolve => setTimeout(resolve, 1000));
print("2s");
await new Promise(resolve => setTimeout(resolve, 1000));
