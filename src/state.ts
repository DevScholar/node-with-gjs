import type { IpcWorker } from './ipc.js';
import type * as cp from 'node:child_process';
import type { GjsRef } from './types.js';

export const callbackRegistry = new Map<string, Function>();
export const objectCallbacks = new Map<string, string[]>();
export const releaseQueue: string[] = [];

export const proxyCache = new Map<string, WeakRef<GjsRef>>();

export const gcRegistry = new FinalizationRegistry((id: string) => {
    proxyCache.delete(id);
    releaseQueue.push(id);
    const cbs = objectCallbacks.get(id);
    if (cbs) {
        for (const cbId of cbs) callbackRegistry.delete(cbId);
        objectCallbacks.delete(id);
    }
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
