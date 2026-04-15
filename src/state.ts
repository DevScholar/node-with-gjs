import type { IpcWorker } from './ipc.js';
import type * as cp from 'node:child_process';
import type { GjsRef } from './types.js';

export const callbackRegistry = new Map<string, Function>();
export const objectCallbacks = new Map<string, string[]>();
export const releaseQueue: string[] = [];

export const proxyCache = new Map<string, WeakRef<GjsRef>>();

// Strong references to proxies that have active signal callbacks.
// Prevents V8 GC from collecting a proxy whose GJS-side GObject is still
// alive (e.g. a Gtk.Button in a widget tree).  Matches real GJS behaviour
// where GObject signal connections prevent the callback from being collected.
export const connectedProxies = new Map<string, GjsRef>();

/** Pin a proxy so it is not GC'd while it has active callbacks. */
export function pinProxy(id: string): void {
    if (connectedProxies.has(id)) return;
    const weak = proxyCache.get(id);
    const ref = weak?.deref();
    if (ref) connectedProxies.set(id, ref);
}

/** Unpin a proxy when it has no more callbacks. */
export function unpinProxy(id: string): void {
    connectedProxies.delete(id);
}

export const gcRegistry = new FinalizationRegistry((id: string) => {
    proxyCache.delete(id);
    releaseQueue.push(id);
    const cbs = objectCallbacks.get(id);
    if (cbs) {
        for (const cbId of cbs) callbackRegistry.delete(cbId);
        objectCallbacks.delete(id);
    }
    connectedProxies.delete(id);
});

export const namespaceCache = new Map<string, GjsRef>();
export const giVersions: Record<string, string> = {};

let _ipc: IpcWorker | null = null;
let _proc: cp.ChildProcess | null = null;
let _initialized = false;
let _reqPath = '';
let _resPath = '';
let _pollInterval: ReturnType<typeof setInterval> | null = null;

export function getIpc() { return _ipc; }
export function getProc() { return _proc; }
export function getInitialized() { return _initialized; }
export function getReqPath() { return _reqPath; }
export function getResPath() { return _resPath; }
export function getPollInterval() { return _pollInterval; }

export function setIpc(val: IpcWorker | null) { _ipc = val; }
export function setProc(val: cp.ChildProcess | null) { _proc = val; }
export function setInitialized(val: boolean) { _initialized = val; }
export function setReqPath(val: string) { _reqPath = val; }
export function setResPath(val: string) { _resPath = val; }
export function setPollInterval(val: ReturnType<typeof setInterval> | null) { _pollInterval = val; }
