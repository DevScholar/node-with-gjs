import { initialize } from './lifecycle.js';
import { startPolling, addPostDrainHook, removePostDrainHook } from './poll.js';
import { createProxy } from './proxy.js';
import { getIpc, callbackRegistry, objectCallbacks, proxyCache, releaseQueue, namespaceCache, giVersions, unpinProxy } from './state.js';
import type { GjsRef, GiNamespaceMap, GiVersionsProxy } from './types.js';

export { callbackRegistry } from './state.js';
export { addPostDrainHook, removePostDrainHook } from './poll.js';
export type { GjsRef, GjsProxy, GiNamespaceMap, GiVersionsProxy } from './types.js';

export function init() {
    initialize();
}

export function releaseObject(proxy: GjsRef): void {
    const id = proxy?.__ref;
    if (!id || !getIpc()) return;
    proxyCache.delete(id);
    unpinProxy(id);
    try { getIpc()!.send({ action: 'Release', targetId: id }); } catch {}
    const cbs = objectCallbacks.get(id);
    if (cbs) {
        for (const cbId of cbs) callbackRegistry.delete(cbId);
        objectCallbacks.delete(id);
    }
}

export function startEventDrain(): void {
    initialize();
    startPolling();
}

export function drainCallbacks(): void {
    const ipc = getIpc();
    if (!ipc) return;
    if (releaseQueue.length > 0) {
        for (const id of releaseQueue.splice(0)) {
            try { ipc.send({ action: 'Release', targetId: id }); } catch {}
        }
    }
    ipc.drainEvents();
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

export const imports: {
    gi: GiNamespaceMap & {
        versions: GiVersionsProxy;
    };
} = {
    gi: new Proxy({} as GiNamespaceMap & { versions: GiVersionsProxy }, {
        get(_, namespace: string) {
            if (namespace === 'versions') {
                return new Proxy(giVersions, {
                    set(target, prop, value) {
                        target[prop as string] = value;
                        namespaceCache.delete(`${prop as string}@default`);
                        return true;
                    }
                }) as GiVersionsProxy;
            }
            const version = giVersions[namespace];
            const cacheKey = `${namespace}@${version || 'default'}`;
            if (!namespaceCache.has(cacheKey)) {
                initialize();
                const res = getIpc()!.send({ action: 'LoadNamespace', namespace, version });
                namespaceCache.set(cacheKey, createProxy(res) as GjsRef);
            }
            return namespaceCache.get(cacheKey);
        }
    })
};
