// src/state.ts
import type { IpcWorker } from './ipc.js';
import type * as cp from 'node:child_process';

/**
 * Registry of all active callbacks registered from Node.js.
 * Exported so host packages (e.g. node-with-window) can register callbacks
 * that aren't tied to a specific proxy object lifetime (e.g. menu actions).
 */
export const callbackRegistry = new Map<string, Function>();
// Maps GJS object id → callback ids registered on its behalf (for bulk cleanup).
export const objectCallbacks = new Map<string, string[]>();
// Ids of GJS objects whose Node.js proxies have been GC'd; drained in drainEvents().
export const releaseQueue: string[] = [];

// ── Proxy cache (WeakRef) ────────────────────────────────────────────────────
// GJS deduplicates objects: the same GObject returned by multiple calls gets
// the same id.  Without a cache, each createProxy() call registers a separate
// FinalizationRegistry entry.  When ANY of those proxies is GC'd the id is
// released from GJS's objectStore — even though other proxies still reference
// it.  The WeakRef cache ensures there is at most ONE proxy per id.
export const proxyCache = new Map<string, WeakRef<any>>();

// FinalizationRegistry: only do in-process work here (push to queue).
// Actual IPC happens later in drainEvents() where ipc is known to be alive.
export const gcRegistry = new FinalizationRegistry((id: string) => {
    proxyCache.delete(id);
    releaseQueue.push(id);
    const cbs = objectCallbacks.get(id);
    if (cbs) {
        for (const cbId of cbs) callbackRegistry.delete(cbId);
        objectCallbacks.delete(id);
    }
});

export const namespaceCache = new Map<string, any>();
export const giVersions: Record<string, string> = {};

// ── Mutable process state ────────────────────────────────────────────────────
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
