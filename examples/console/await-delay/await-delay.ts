// Run: node start.js examples/console/await-delay/await-delay.ts
import { loadGi } from '../../../gi-loader.ts';

loadGi('GLib', '2.0');

print('0s');
await new Promise(resolve => setTimeout(resolve, 1000));
print("1s");
await new Promise(resolve => setTimeout(resolve, 1000));
print("2s");
await new Promise(resolve => setTimeout(resolve, 1000));
