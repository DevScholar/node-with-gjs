import { getIpc, proxyCache, gcRegistry } from './state.js';
import { wrapArg } from './marshal.js';
import { startPolling } from './poll.js';
import type { GjsProxy, GjsRef } from './types.js';

export type { GjsProxy } from './types.js';

type ProxyResult<T extends object = object> = GjsProxy<T> | undefined | null | number | string | boolean | Uint8Array | GjsProxy<object>[];

export function makeFnProxy<T extends object = object>(parentId: string, methodName: string, fnId?: string): GjsProxy<T> {
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
            return createProxy(res) as GjsProxy<T>;
        }
    }) as GjsProxy<T>;
}

export function createProxy<T extends object = object>(meta: any): ProxyResult<T> {
    if (meta.type === 'primitive' || meta.type === 'null') return meta.value;
    if (meta.type === 'uint8array') return new Uint8Array(meta.value);
    if (meta.type === 'array') return meta.value.map((item: any) => createProxy(item));
    if (meta.type !== 'ref') return undefined;

    const id = meta.id!;

    const cached = proxyCache.get(id);
    if (cached) {
        const existing = cached.deref();
        if (existing) return existing as GjsProxy<T>;
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
            return createProxy(res) as GjsProxy<T>;
        }
    }) as GjsProxy<T>;

    proxyCache.set(id, new WeakRef(proxy as unknown as GjsRef));
    gcRegistry.register(proxy, id);
    return proxy;
}
