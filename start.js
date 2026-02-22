// start.js
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const args = process.argv.slice(2);

if (args.length === 0) {
    console.error('Usage: node start.js <script.ts> [--runtime=node|bun|deno]');
    console.error('       bun start.js <script.ts> [--runtime=node|bun|deno]');
    console.error('       deno run start.js <script.ts> [--runtime=node|bun|deno]');
    process.exit(1);
}

let runtime = null;
let targetScript = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runtime' && args[i + 1]) {
        runtime = args[i + 1].toLowerCase();
        i++;
    } else if (!args[i].startsWith('--')) {
        targetScript = args[i];
    }
}

if (!targetScript) {
    console.error('Error: No script specified');
    process.exit(1);
}

targetScript = path.resolve(targetScript);
const hookUrl = new URL('./hook.js', import.meta.url).href;

if (!runtime) {
    runtime = detectRuntime();
}

const validRuntimes = ['node', 'bun', 'deno'];
if (!validRuntimes.includes(runtime)) {
    console.error(`Error: Invalid runtime "${runtime}". Must be one of: ${validRuntimes.join(', ')}`);
    process.exit(1);
}

console.log(`Starting ${runtime.charAt(0).toUpperCase() + runtime.slice(1)}-GJS execution context...`);

let proc;

switch (runtime) {
    case 'bun':
        proc = spawnBun(targetScript);
        break;
    case 'deno':
        proc = spawnDeno(targetScript);
        break;
    case 'node':
    default:
        proc = spawnNode(targetScript, hookUrl);
        break;
}

proc.on('exit', (code) => {
    process.exit(code || 0);
});

function detectRuntime() {
    if (typeof Bun !== 'undefined') return 'bun';
    if (typeof Deno !== 'undefined') return 'deno';
    return 'node';
}

function spawnNode(targetScript, hookUrl) {
    return spawn(process.execPath, [
        '--no-warnings', 
        '--experimental-loader', hookUrl,
        '--experimental-transform-types', 
        targetScript
    ], {
        stdio: 'inherit',
        env: process.env
    });
}

function spawnBun(targetScript) {
    return spawn('bun', [
        'run',
        targetScript
    ], {
        stdio: 'inherit',
        env: process.env
    });
}

function spawnDeno(targetScript) {
    return spawn('deno', [
        'run',
        '--allow-all',
        targetScript
    ], {
        stdio: 'inherit',
        env: process.env
    });
}
