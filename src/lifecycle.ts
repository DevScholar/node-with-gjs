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
        // execFileSync runs 'which' directly, no shell involved.
        return cp.execFileSync('which', ['gjs'], { encoding: 'utf-8' }).trim() || 'gjs';
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

    // execFileSync runs mkfifo directly without a shell.
    try {
        cp.execFileSync('mkfifo', [reqPath, resPath]);
    } catch {
        console.error('Failed to create Unix FIFOs');
        process.exit(1);
    }

    const scriptPath = path.join(__dirname, '..', 'scripts', 'host.js');
    const gjsPath = findGjsPath();

    const spawnEnv = { ...process.env };
    try {
        const vendor = fs.readFileSync('/sys/class/dmi/id/sys_vendor', 'utf-8').trim();
        if (vendor === 'VMware, Inc.') {
            spawnEnv['WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS'] = '1';
        }
    } catch { /* not available outside Linux/bare-metal; ignore */ }

    // Open both FIFOs with correct direction and without deadlocking.
    //
    // A FIFO open(O_RDONLY) blocks until a writer opens, and open(O_WRONLY)
    // blocks until a reader opens.  To avoid deadlocking synchronously:
    //
    //   1. open(O_RDONLY | O_NONBLOCK) — returns immediately without a writer.
    //   2. open(O_WRONLY)              — succeeds because step 1 is a reader.
    //   3. open(O_RDONLY)              — succeeds because step 2 is a writer.
    //      This creates a fresh open file description: blocking, no O_NONBLOCK.
    //   4. close the O_NONBLOCK fd from step 1 (it was only needed to unblock step 2).
    //
    // reqPath: Node writes commands  → GJS reads  (child fd 3)
    // resPath: GJS  writes responses → Node reads (child fd 4)

    const O_RDONLY_NB = fs.constants.O_RDONLY | fs.constants.O_NONBLOCK;

    const fdReqTmp   = fs.openSync(reqPath, O_RDONLY_NB); // step 1
    const fdReqWrite = fs.openSync(reqPath, 'w');          // step 2 — Node writes here
    const fdReqRead  = fs.openSync(reqPath, 'r');          // step 3 — GJS reads here (blocking)
    fs.closeSync(fdReqTmp);                                 // step 4

    const fdResTmp   = fs.openSync(resPath, O_RDONLY_NB); // step 1
    const fdResWrite = fs.openSync(resPath, 'w');          // step 2 — GJS writes here
    const fdResRead  = fs.openSync(resPath, 'r');          // step 3 — Node reads here (blocking)
    fs.closeSync(fdResTmp);                                 // step 4

    // Spawn GJS directly, passing fds as integers per the Node.js docs.
    // Node.js calls dup2(fdReqRead, 3) and dup2(fdResWrite, 4) in the child.
    //
    // Deno does not support integer-fd stdio inheritance in child_process.spawn.
    // Use bash as a shim: it opens the FIFOs by path and redirects them onto
    // fd 3 and fd 4 before exec-ing GJS, so GJS sees the same fd layout.
    // Both ends are already open in Node from the three-step trick above, so
    // bash's open() unblocks immediately without any deadlock risk.
    // TODO: remove bash shim and use the Node.js path for Deno too once
    //       denoland/deno#33140 ships in a stable release.
    const isDenoRuntime = typeof (globalThis as any).Deno !== 'undefined';
    function sq(s: string): string { return `'${s.replace(/'/g, "'\\''")}'`; }
    const proc = isDenoRuntime
        ? cp.spawn('bash', [
              '-c',
              `exec ${sq(gjsPath)} -m ${sq(scriptPath)} 3<${sq(reqPath)} 4>${sq(resPath)}`
          ], {
              stdio: ['inherit', 'inherit', 'inherit'],
              env: spawnEnv
          })
        : cp.spawn(gjsPath, ['-m', scriptPath], {
              stdio: ['inherit', 'inherit', 'inherit', fdReqRead, fdResWrite],
              env: spawnEnv
          });

    // Close the parent's copies that were handed to the child.
    // fdReqRead:  parent never reads from the command pipe; keeping it open
    //             would prevent GJS from seeing EOF when fdReqWrite is closed.
    // fdResWrite: parent never writes to the response pipe; keeping it open
    //             would prevent Node from seeing EOF when GJS exits.
    fs.closeSync(fdReqRead);
    fs.closeSync(fdResWrite);

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

    const ipc = new IpcWorker(fdResRead, fdReqWrite, (res: any) => {
        const cb = callbackRegistry.get(res.callbackId!);
        if (cb) {
            const wrappedArgs = (res.args || []).map((arg: any) => createProxy(arg));
            const result = cb(...wrappedArgs);
            // Wrap the return value as a protocol object so GJS's
            // processNestedCommands() can reconstruct it (e.g. true for close-request).
            return wrapArg(result);
        }
        return { type: 'null' };
    }, isDenoRuntime ? resPath : undefined);

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
