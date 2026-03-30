// src/index.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cp from 'node:child_process';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { IpcWorker } from './ipc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Delay between event-drain polls while the GTK main loop is running.
const POLL_INTERVAL_MS = 16;

/**
 * Registry of all active callbacks registered from Node.js.
 * Exported so host packages (e.g. node-with-window) can register callbacks
 * that aren't tied to a specific proxy object lifetime (e.g. menu actions).
 */
export const callbackRegistry = new Map<string, Function>();
// Maps GJS object id → callback ids registered on its behalf (for bulk cleanup).
const objectCallbacks = new Map<string, string[]>();
// Ids of GJS objects whose Node.js proxies have been GC'd; drained in drainEvents().
const releaseQueue: string[] = [];

// FinalizationRegistry: only do in-process work here (push to queue).
// Actual IPC happens later in drainEvents() where ipc is known to be alive.
const gcRegistry = new FinalizationRegistry((id: string) => {
    releaseQueue.push(id);
    const cbs = objectCallbacks.get(id);
    if (cbs) {
        for (const cbId of cbs) callbackRegistry.delete(cbId);
        objectCallbacks.delete(id);
    }
});

const namespaceCache = new Map<string, any>();
const giVersions: Record<string, string> = {};

let ipc: IpcWorker | null = null;
let proc: cp.ChildProcess | null = null;
let initialized = false;
let reqPath = '';
let resPath = '';
let pollInterval: ReturnType<typeof setInterval> | null = null;
// Ref'd timer that keeps Node.js alive while a GTK/Gio app is running.
// Cleared when GJS exits so the event loop can drain and process.exit() runs.
let appKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
// App object ID to release (via AppRelease IPC) after the first activate event
// is delivered to Node.js.  Set when run_started is received, cleared after use.
let pendingAppRelease: string | null = null;

function cleanup() {
    if (!initialized) return;
    initialized = false;

    if (appKeepAliveTimer) { clearInterval(appKeepAliveTimer); appKeepAliveTimer = null; }
    pendingAppRelease = null;
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    if (ipc) try { ipc.close(); } catch {}
    if (proc && !proc.killed) try { proc.kill('SIGKILL'); } catch {}
    if (fs.existsSync(reqPath)) try { fs.unlinkSync(reqPath); } catch {}
    if (fs.existsSync(resPath)) try { fs.unlinkSync(resPath); } catch {}

    proc = null;
    ipc = null;
}

function findGjsPath(): string {
    try {
        const result = cp.execSync('which gjs', { encoding: 'utf-8' }).trim();
        return result || 'gjs';
    } catch {
        return 'gjs';
    }
}

function initialize() {
    if (initialized) return;

    const token = `${process.pid}-${Date.now()}`;
    reqPath = path.join(os.tmpdir(), `gjs-req-${token}.pipe`);
    resPath = path.join(os.tmpdir(), `gjs-res-${token}.pipe`);

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

    proc = cp.spawn('bash', [
        '-c',
        `exec ${sq(gjsPath)} -m ${sq(scriptPath)} 3<${sq(reqPath)} 4>${sq(resPath)}`
    ], {
        stdio: 'inherit',
        env: process.env
    });

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

    ipc = new IpcWorker(fdRead, fdWrite);

    // Preserve GJS's global print() — only patch if not already defined so we
    // don't clobber a pre-existing definition (e.g. from a test framework).
    if (!(globalThis as any).print) {
        (globalThis as any).print = (...args: any[]) => {
            ipc!.send({ action: 'Print', args: args.map(arg => wrapArg(arg)) });
        };
    }

    initialized = true;
}

function wrapArg(arg: any, ownerObjectId?: string): any {
    if (arg === null || arg === undefined) return { type: 'null' };
    if (arg.__ref) return { type: 'ref', id: arg.__ref };

    if (arg instanceof Uint8Array) {
        return { type: 'uint8array', value: Array.from(arg) };
    }

    if (typeof arg === 'function') {
        const cbId = `cb_${Date.now()}_${Math.random()}`;
        callbackRegistry.set(cbId, arg);
        if (ownerObjectId) {
            if (!objectCallbacks.has(ownerObjectId)) objectCallbacks.set(ownerObjectId, []);
            objectCallbacks.get(ownerObjectId)!.push(cbId);
        }
        return { type: 'callback', callbackId: cbId };
    }

    if (Array.isArray(arg)) return { type: 'array', value: arg.map(a => wrapArg(a, ownerObjectId)) };

    if (typeof arg === 'object') {
        const plainObj: any = {};
        for (let k in arg) plainObj[k] = wrapArg(arg[k], ownerObjectId);
        return { type: 'object', value: plainObj };
    }

    return { type: 'primitive', value: arg };
}

function createProxy(meta: any): any {
    if (meta.type === 'primitive' || meta.type === 'null') return meta.value;
    if (meta.type === 'array') return meta.value.map((item: any) => createProxy(item));
    if (meta.type !== 'ref') return undefined;

    const id = meta.id!;
    const stub = function() {};

    const proxy = new Proxy(stub, {
        get: (target: any, prop: string | symbol) => {
            if (prop === '__ref') return id;
            if (typeof prop !== 'string') return undefined;

            const val = ipc!.send({ action: 'Get', targetId: id, property: prop });

            if (val && val.type === 'function') {
                return new Proxy(function() {}, {
                    apply: (t, thisArg, args) => {
                        const netArgs = args.map(a => wrapArg(a, id));
                        const res = ipc!.send({ action: 'Invoke', targetId: id, methodName: prop, args: netArgs });
                        // GJS detected this is Gio.Application.run() and entered the main loop.
                        // Start the drain loop so events are delivered during app lifetime.
                        if (res?.type === 'run_started') {
                            pendingAppRelease = res.appId ?? null;
                            startPolling();
                            // Keep the event loop alive while the GTK app runs.
                            // Cleared in drainEvents() when GJS exits.
                            if (!appKeepAliveTimer) {
                                appKeepAliveTimer = setInterval(() => {}, 10_000);
                            }
                            return undefined;
                        }
                        return createProxy(res);
                    },
                    construct: (t, args) => {
                        const netArgs = args.map(a => wrapArg(a, id));
                        const res = ipc!.send({ action: 'NewProp', targetId: id, property: prop, args: netArgs });
                        return createProxy(res);
                    }
                });
            }
            return createProxy(val);
        },

        set: (target: any, prop: string | symbol, value: any) => {
            if (typeof prop !== 'string') return false;
            ipc!.send({ action: 'Set', targetId: id, property: prop, value: wrapArg(value, id) });
            return true;
        },

        construct: (target: any, args: any[]) => {
            const netArgs = args.map(a => wrapArg(a, id));
            const res = ipc!.send({ action: 'New', typeId: id, args: netArgs });
            return createProxy(res);
        }
    });

    gcRegistry.register(proxy, id);
    return proxy;
}

export function init() {
    initialize();
}

/**
 * Manually release a proxy object immediately, without waiting for V8 GC.
 * Useful when you know an object is no longer needed and want to free the
 * GJS-side reference right away (e.g. a closed window's WebView).
 */
export function releaseObject(proxy: any): void {
    const id = proxy?.__ref;
    if (!id || !ipc) return;
    try { ipc.send({ action: 'Release', targetId: id }); } catch {}
    const cbs = objectCallbacks.get(id);
    if (cbs) {
        for (const cbId of cbs) callbackRegistry.delete(cbId);
        objectCallbacks.delete(id);
    }
}

/**
 * Start the event-drain poll loop immediately, without waiting for
 * Gio.Application.run() to be detected.
 *
 * Call this just before entering a GLib.MainLoop (or any blocking GTK loop)
 * that was started without going through Gio.Application.run(), so that GJS
 * signal callbacks are delivered to Node.js while the loop is running.
 */
export function startEventDrain(): void {
    initialize();
    startPolling();
}

/**
 * Synchronously drain all pending GJS callback events that have already arrived
 * from the Worker thread. Returns immediately if nothing is queued.
 *
 * Use this in a tight spin-loop when you need to process callbacks without
 * yielding to the Node.js event loop — for example, while synchronously
 * waiting for a modal GTK dialog to close.
 *
 * Example:
 *   const sab = new SharedArrayBuffer(4);
 *   const arr = new Int32Array(sab);
 *   while (!done) {
 *     drainCallbacks();
 *     Atomics.wait(arr, 0, 0, 2); // sleep ~2 ms
 *   }
 */
export function drainCallbacks(): void {
    if (!ipc) return;
    if (releaseQueue.length > 0) {
        for (const id of releaseQueue.splice(0)) {
            try { ipc.send({ action: 'Release', targetId: id }); } catch {}
        }
    }
    try {
        const res = ipc.send({ action: 'Poll' });
        if (res && res.type === 'poll' && Array.isArray(res.events)) {
            for (const ev of res.events) {
                const cb = callbackRegistry.get(ev.callbackId);
                if (cb) {
                    const wrappedArgs = (ev.args || []).map((arg: any) => createProxy(arg));
                    try { cb(...wrappedArgs); } catch(e) { console.error('[node-with-gjs] Callback error:', e); }
                }
            }
        }
    } catch { /* ignore if GJS exited */ }
}

function drainEvents() {
    if (!ipc) return;
    // Release GC'd objects first.
    if (releaseQueue.length > 0) {
        for (const id of releaseQueue.splice(0)) {
            try { ipc.send({ action: 'Release', targetId: id }); } catch {}
        }
    }
    // Poll GJS for any queued callback events.
    let gjsExited = false;
    try {
        const res = ipc.send({ action: 'Poll' });
        if (res?.type === 'exit') {
            gjsExited = true;
        } else if (res && res.type === 'poll' && Array.isArray(res.events)) {
            for (const ev of res.events) {
                const cb = callbackRegistry.get(ev.callbackId);
                if (cb) {
                    const wrappedArgs = (ev.args || []).map((arg: any) => createProxy(arg));
                    try { cb(...wrappedArgs); } catch(e) { console.error('[node-with-gjs] Callback error:', e); }
                }
            }
            // Release the app hold AFTER delivering the first batch of events.
            // By this point the activate callback has run and the first window
            // has been created (IPC is synchronous), so the extra hold is no
            // longer needed to prevent a premature GTK quit.
            if (pendingAppRelease && res.events.length > 0) {
                const appId = pendingAppRelease;
                pendingAppRelease = null;
                try { ipc.send({ action: 'AppRelease', appId }); } catch {}
            }
        }
    } catch { gjsExited = true; }
    if (gjsExited && appKeepAliveTimer) {
        clearInterval(appKeepAliveTimer);
        appKeepAliveTimer = null;
    }
}

function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(drainEvents, POLL_INTERVAL_MS);
    (pollInterval as any).unref?.();
}

export const imports = {
    gi: new Proxy({} as any, {
        get(_, namespace: string) {
            if (namespace === 'versions') {
                return new Proxy(giVersions, {
                    set(target, prop, value) {
                        target[prop as string] = value;
                        namespaceCache.delete(`${prop as string}@default`);
                        return true;
                    }
                });
            }
            const version = giVersions[namespace];
            const cacheKey = `${namespace}@${version || 'default'}`;
            if (!namespaceCache.has(cacheKey)) {
                initialize();
                const res = ipc!.send({ action: 'LoadNamespace', namespace, version });
                namespaceCache.set(cacheKey, createProxy(res));
            }
            return namespaceCache.get(cacheKey);
        }
    })
};
