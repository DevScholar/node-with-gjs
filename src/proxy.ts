// src/proxy.ts
import { getIpc, proxyCache, gcRegistry } from './state.js';
import { wrapArg } from './marshal.js';
import { startPolling } from './poll.js';

// Create a proxy for a GJS function that supports both calling (as a method on
// its parent) and static property access (via the function's own ref id).
// parentId + methodName → Invoke/NewProp;  fnId → Get for sub-properties.
export function makeFnProxy(parentId: string, methodName: string, fnId?: string): any {
    return new Proxy(function() {}, {
        get: fnId ? (_t: any, subProp: string | symbol) => {
            if (subProp === '__ref') return fnId;
            if (typeof subProp !== 'string') return undefined;
            const subVal = getIpc()!.send({ action: 'Get', targetId: fnId, property: subProp });
            if (subVal && subVal.type === 'function') {
                return makeFnProxy(fnId, subProp, subVal.id);
            }
            return createProxy(subVal);
        } : undefined,
        apply: (_t: any, _thisArg: any, args: any[]) => {
            const netArgs = args.map(a => wrapArg(a, parentId));
            const res = getIpc()!.send({ action: 'Invoke', targetId: parentId, methodName, args: netArgs });
            if (res?.type === 'run_started') {
                getIpc()!.refForApp();
                startPolling();
                return undefined;
            }
            return createProxy(res);
        },
        construct: (_t: any, args: any[]) => {
            const netArgs = args.map(a => wrapArg(a, parentId));
            const res = getIpc()!.send({ action: 'NewProp', targetId: parentId, property: methodName, args: netArgs });
            return createProxy(res);
        }
    });
}

export function createProxy(meta: any): any {
    if (meta.type === 'primitive' || meta.type === 'null') return meta.value;
    if (meta.type === 'uint8array') return new Uint8Array(meta.value);
    if (meta.type === 'array') return meta.value.map((item: any) => createProxy(item));
    if (meta.type !== 'ref') return undefined;

    const id = meta.id!;

    // Return the existing live proxy for this id (prevents duplicate-release on GC)
    const cached = proxyCache.get(id);
    if (cached) {
        const existing = cached.deref();
        if (existing) return existing;
    }

    const stub = function() {};

    const proxy = new Proxy(stub, {
        get: (target: any, prop: string | symbol) => {
            if (prop === '__ref') return id;
            if (typeof prop !== 'string') return undefined;

            const val = getIpc()!.send({ action: 'Get', targetId: id, property: prop });

            if (val && val.type === 'function') {
                return makeFnProxy(id, prop, val.id);
            }
            return createProxy(val);
        },

        set: (target: any, prop: string | symbol, value: any) => {
            if (typeof prop !== 'string') return false;
            getIpc()!.send({ action: 'Set', targetId: id, property: prop, value: wrapArg(value, id) });
            return true;
        },

        construct: (target: any, args: any[]) => {
            const netArgs = args.map(a => wrapArg(a, id));
            const res = getIpc()!.send({ action: 'New', typeId: id, args: netArgs });
            return createProxy(res);
        }
    });

    proxyCache.set(id, new WeakRef(proxy));
    gcRegistry.register(proxy, id);
    return proxy;
}
