// src/marshal.ts
import { callbackRegistry, objectCallbacks } from './state.js';

export function wrapArg(arg: any, ownerObjectId?: string): any {
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
        // Async functions: enqueue event in GJS, drain via Poll from setInterval.
        // Sync functions: GJS blocks in processNestedCommands until Node.js replies;
        // the return value reaches GTK (e.g. close-request → true, draw-func calls).
        const isAsync = arg.constructor?.name === 'AsyncFunction';
        const descriptor: any = { type: 'callback', callbackId: cbId, async: isAsync };
        // syncReturn: for async callbacks that need to return a value synchronously
        // to GTK while still processing asynchronously in Node.js.
        // E.g. close-request must return true (prevent auto-close) immediately,
        // but the actual close logic runs asynchronously in Node.js.
        if ((arg as any).__syncReturn !== undefined) {
            descriptor.syncReturn = (arg as any).__syncReturn;
        }
        return descriptor;
    }

    if (Array.isArray(arg)) return { type: 'array', value: arg.map(a => wrapArg(a, ownerObjectId)) };

    if (typeof arg === 'object') {
        const plainObj: any = {};
        for (let k in arg) plainObj[k] = wrapArg(arg[k], ownerObjectId);
        return { type: 'object', value: plainObj };
    }

    return { type: 'primitive', value: arg };
}
