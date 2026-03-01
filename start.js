// start.js - Build and run TypeScript files
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
let runtime = 'node';
let tsFile = null;
let extraArgs = [];

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--runtime=')) {
        runtime = arg.split('=')[1];
    } else if (arg.startsWith('-r=')) {
        runtime = arg.split('=')[1];
    } else if (arg.endsWith('.ts') || arg.endsWith('.js')) {
        tsFile = arg;
    } else {
        extraArgs.push(arg);
    }
}

if (!tsFile) {
    console.error('Usage: node start.js <ts-file> [--runtime=node|bun|deno] [args...]');
    console.error('Example: node start.js src/gtk/counter/counter.ts');
    console.error('Example: node start.js app.ts --runtime=deno');
    process.exit(1);
}

const filePath = path.resolve(tsFile);

if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
}

const runtimeFlags = {
    node: [],
    bun: [],
    deno: ['run', '--allow-all', '--unstable']
};

async function buildAndRun() {
    console.log('Building TypeScript...');
    
    const tscProc = spawn('npx', ['tsc'], {
        stdio: 'inherit',
        cwd: __dirname,
        shell: true
    });
    
    await new Promise((resolve, reject) => {
        tscProc.on('exit', (code) => {
            if (code !== 0) {
                console.error('Build failed with code:', code);
                reject(new Error(`tsc exited with code ${code}`));
            } else {
                resolve();
            }
        });
        tscProc.on('error', reject);
    });
    
    console.log('Build complete. Running with', runtime, ':', tsFile);
    
    const ext = path.extname(tsFile);
    const baseName = path.basename(tsFile, ext);
    const relativePath = path.relative(path.join(__dirname, 'src'), filePath);
    const jsFile = path.join(__dirname, 'dist', relativePath.replace(/\.ts$/, '.js'));
    
    const runtimeArgs = runtimeFlags[runtime] || [];
    const runtimeCmd = runtime;
    
    const finalArgs = runtime === 'deno' 
        ? [...runtimeArgs, jsFile, ...extraArgs]
        : [...runtimeArgs, jsFile, ...extraArgs];
    
    const proc = spawn(runtimeCmd, finalArgs, {
        stdio: 'inherit',
        cwd: process.cwd(),
        shell: true
    });
    
    proc.on('exit', (code) => {
        process.exit(code);
    });
    
    proc.on('error', (err) => {
        console.error(`Failed to start ${runtime}:`, err.message);
        process.exit(1);
    });
}

buildAndRun().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
