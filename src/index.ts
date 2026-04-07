// src/index.ts
import { initialize } from './lifecycle.js';
import { startPolling, addPostDrainHook, removePostDrainHook } from './poll.js';
import { createProxy } from './proxy.js';
import { getIpc, callbackRegistry, objectCallbacks, proxyCache, releaseQueue, namespaceCache, giVersions } from './state.js';

export { callbackRegistry } from './state.js';
export { addPostDrainHook, removePostDrainHook } from './poll.js';

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
    if (!id || !getIpc()) return;
    proxyCache.delete(id);
    try { getIpc()!.send({ action: 'Release', targetId: id }); } catch {}
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
 * Synchronously drain all pending GJS events (both sync and async).
 * Returns immediately if nothing is queued.
 *
 * Use this in a tight spin-loop when you need to process callbacks without
 * yielding to the Node.js event loop.
 */
export function drainCallbacks(): void {
    const ipc = getIpc();
    if (!ipc) return;
    // Release GC'd objects.
    if (releaseQueue.length > 0) {
        for (const id of releaseQueue.splice(0)) {
            try { ipc.send({ action: 'Release', targetId: id }); } catch {}
        }
    }
    // Drain pending sync events from the port.
    ipc.drainEvents();
    // Drain async events from GJS eventQueue.
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
                const res = getIpc()!.send({ action: 'LoadNamespace', namespace, version });
                namespaceCache.set(cacheKey, createProxy(res));
            }
            return namespaceCache.get(cacheKey);
        }
    })
};
