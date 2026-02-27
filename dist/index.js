// src/index.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cp from 'node:child_process';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { IpcSync } from './ipc.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gcRegistry = new FinalizationRegistry((id) => {
    try {
        if (ipc)
            ipc.send({ action: 'Release', targetId: id });
    }
    catch { }
});
const callbackRegistry = new Map();
let ipc = null;
let proc = null;
let initialized = false;
let reqPath = '';
let resPath = '';
function cleanup() {
    if (!initialized)
        return;
    initialized = false;
    if (ipc)
        try {
            ipc.close();
        }
        catch { }
    if (proc && !proc.killed)
        try {
            proc.kill('SIGKILL');
        }
        catch { }
    if (fs.existsSync(reqPath))
        try {
            fs.unlinkSync(reqPath);
        }
        catch { }
    if (fs.existsSync(resPath))
        try {
            fs.unlinkSync(resPath);
        }
        catch { }
    proc = null;
    ipc = null;
}
function findGjsPath() {
    try {
        const result = cp.execSync('which gjs', { encoding: 'utf-8' }).trim();
        return result || 'gjs';
    }
    catch {
        return 'gjs';
    }
}
function initialize() {
    if (initialized)
        return;
    const token = `${process.pid}-${Date.now()}`;
    reqPath = path.join(os.tmpdir(), `gjs-req-${token}.pipe`);
    resPath = path.join(os.tmpdir(), `gjs-res-${token}.pipe`);
    try {
        cp.execSync(`mkfifo "${reqPath}"`);
        cp.execSync(`mkfifo "${resPath}"`);
    }
    catch (e) {
        console.error("Failed to create Unix FIFOs");
        process.exit(1);
    }
    const scriptPath = path.join(__dirname, '..', 'scripts', 'host.js');
    const gjsPath = findGjsPath();
    proc = cp.spawn('bash', ['-c', `exec "${gjsPath}" -m "${scriptPath}" 3<"${reqPath}" 4>"${resPath}"`], {
        stdio: 'inherit',
        env: process.env
    });
    proc.unref();
    process.on('beforeExit', () => { cleanup(); process.exit(0); });
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('uncaughtException', (err) => {
        console.error('Node.js Exception:', err);
        cleanup();
        process.exit(1);
    });
    const fdWrite = fs.openSync(reqPath, 'w');
    const fdRead = fs.openSync(resPath, 'r');
    ipc = new IpcSync(fdRead, fdWrite, (res) => {
        const cb = callbackRegistry.get(res.callbackId);
        if (cb) {
            const wrappedArgs = (res.args || []).map((arg) => createProxy(arg));
            return cb(...wrappedArgs);
        }
        return null;
    });
    globalThis.print = (...args) => {
        ipc.send({ action: 'Print', args: args.map(wrapArg) });
    };
    initialized = true;
}
function wrapArg(arg) {
    if (arg === null || arg === undefined)
        return { type: 'null' };
    if (arg.__ref)
        return { type: 'ref', id: arg.__ref };
    if (arg instanceof Uint8Array) {
        return { type: 'uint8array', value: Array.from(arg) };
    }
    if (typeof arg === 'function') {
        const cbId = `cb_${Date.now()}_${Math.random()}`;
        callbackRegistry.set(cbId, arg);
        return { type: 'callback', callbackId: cbId };
    }
    if (Array.isArray(arg))
        return { type: 'array', value: arg.map(wrapArg) };
    if (typeof arg === 'object') {
        const plainObj = {};
        for (let k in arg)
            plainObj[k] = wrapArg(arg[k]);
        return { type: 'object', value: plainObj };
    }
    return { type: 'primitive', value: arg };
}
function createProxy(meta) {
    if (meta.type === 'primitive' || meta.type === 'null')
        return meta.value;
    if (meta.type === 'array')
        return meta.value.map((item) => createProxy(item));
    if (meta.type !== 'ref')
        return undefined;
    const id = meta.id;
    const stub = function () { };
    const proxy = new Proxy(stub, {
        get: (target, prop) => {
            if (prop === '__ref')
                return id;
            if (typeof prop !== 'string')
                return undefined;
            const val = ipc.send({ action: 'Get', targetId: id, property: prop });
            if (val && val.type === 'function') {
                return new Proxy(function () { }, {
                    apply: (t, thisArg, args) => {
                        const netArgs = args.map(wrapArg);
                        const res = ipc.send({ action: 'Invoke', targetId: id, methodName: prop, args: netArgs });
                        return createProxy(res);
                    },
                    construct: (t, args) => {
                        const netArgs = args.map(wrapArg);
                        const res = ipc.send({ action: 'NewProp', targetId: id, property: prop, args: netArgs });
                        return createProxy(res);
                    }
                });
            }
            return createProxy(val);
        },
        set: (target, prop, value) => {
            if (typeof prop !== 'string')
                return false;
            ipc.send({ action: 'Set', targetId: id, property: prop, value: wrapArg(value) });
            return true;
        },
        construct: (target, args) => {
            const netArgs = args.map(wrapArg);
            const res = ipc.send({ action: 'New', typeId: id, args: netArgs });
            return createProxy(res);
        }
    });
    gcRegistry.register(proxy, id);
    return proxy;
}
export function init() {
    initialize();
}
// Internal function - not exposed to users
function loadGiNamespace(namespace, version) {
    initialize();
    const res = ipc.send({ action: 'LoadNamespace', namespace, version });
    return createProxy(res);
}
// Namespace cache to avoid creating multiple proxies for the same namespace
const namespaceCache = new Map();
// GI namespace versions
const giVersions = {};
// Create the gi proxy with lazy loading and caching
const giProxy = new Proxy({}, {
    get(_, namespace) {
        if (namespace === 'versions') {
            return new Proxy(giVersions, {
                set(target, prop, value) {
                    target[prop] = value;
                    // Clear cache for this namespace when version changes
                    const cacheKey = `${prop}@default`;
                    namespaceCache.delete(cacheKey);
                    return true;
                }
            });
        }
        const version = giVersions[namespace];
        const cacheKey = `${namespace}@${version || 'default'}`;
        if (!namespaceCache.has(cacheKey)) {
            namespaceCache.set(cacheKey, loadGiNamespace(namespace, version));
        }
        return namespaceCache.get(cacheKey);
    }
});
// The main exports object - compatible with GJS imports
export const imports = {
    gi: giProxy
};
