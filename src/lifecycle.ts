// src/lifecycle.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cp from 'node:child_process';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { IpcWorker } from './ipc.js';
import {
    getIpc, getProc, getInitialized, getReqPath, getResPath, getPollInterval,
    setIpc, setProc, setInitialized, setReqPath, setResPath, setPollInterval,
    callbackRegistry,
} from './state.js';
import { wrapArg } from './marshal.js';
import { createProxy } from './proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function cleanup() {
    if (!getInitialized()) return;
    setInitialized(false);

    const pi = getPollInterval();
    if (pi) { clearInterval(pi); setPollInterval(null); }
    const ipc = getIpc();
    if (ipc) try { ipc.close(); } catch {}
    const proc = getProc();
    if (proc && !proc.killed) try { proc.kill('SIGKILL'); } catch {}
    const reqPath = getReqPath();
    const resPath = getResPath();
    if (fs.existsSync(reqPath)) try { fs.unlinkSync(reqPath); } catch {}
    if (fs.existsSync(resPath)) try { fs.unlinkSync(resPath); } catch {}

    setProc(null);
    setIpc(null);
}

function findGjsPath(): string {
    try {
        const result = cp.execSync('which gjs', { encoding: 'utf-8' }).trim();
        return result || 'gjs';
    } catch {
        return 'gjs';
    }
}

export function initialize() {
    if (getInitialized()) return;

    const token = `${process.pid}-${Date.now()}`;
    const reqPath = path.join(os.tmpdir(), `gjs-req-${token}.pipe`);
    const resPath = path.join(os.tmpdir(), `gjs-res-${token}.pipe`);
    setReqPath(reqPath);
    setResPath(resPath);

    try {
        cp.execSync(`mkfifo "${reqPath}"`);
        cp.execSync(`mkfifo "${resPath}"`);
    } catch(e) {
        console.error("Failed to create Unix FIFOs");
        process.exit(1);
    }

    const scriptPath = path.join(__dirname, '..', 'scripts', 'host.js');
    const gjsPath = findGjsPath();

    function sq(s: string): string { return `'${s.replace(/'/g, "'\\''")}'`; }

    const proc = cp.spawn('bash', [
        '-c',
        `exec ${sq(gjsPath)} -m ${sq(scriptPath)} 3<${sq(reqPath)} 4>${sq(resPath)}`
    ], {
        stdio: 'inherit',
        env: process.env
    });

    setProc(proc);
    proc.unref();

    process.on('beforeExit', () => { cleanup(); process.exit(0); });
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
    process.on('uncaughtException', (err) => {
        console.error('Node.js Exception:', err);
        cleanup();
        process.exit(1);
    });

    const fdWrite = fs.openSync(reqPath, 'w');
    const fdRead = fs.openSync(resPath, 'r');

    const ipc = new IpcWorker(fdRead, fdWrite, (res: any) => {
        const cb = callbackRegistry.get(res.callbackId!);
        if (cb) {
            const wrappedArgs = (res.args || []).map((arg: any) => createProxy(arg));
            const result = cb(...wrappedArgs);
            // Wrap the return value as a protocol object so GJS's
            // processNestedCommands() can reconstruct it (e.g. true for close-request).
            return wrapArg(result);
        }
        return { type: 'null' };
    });

    setIpc(ipc);

    // Preserve GJS's global print() — only patch if not already defined so we
    // don't clobber a pre-existing definition (e.g. from a test framework).
    if (!(globalThis as any).print) {
        (globalThis as any).print = (...args: any[]) => {
            getIpc()!.send({ action: 'Print', args: args.map(arg => wrapArg(arg)) });
        };
    }

    setInitialized(true);
}
