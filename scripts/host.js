// scripts/host.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

let InputStream, OutputStream;
try {
    const GioUnix = imports.gi.GioUnix;
    InputStream = GioUnix.InputStream;
    OutputStream = GioUnix.OutputStream;
} catch (e) {
    InputStream = Gio.UnixInputStream;
    OutputStream = Gio.UnixOutputStream;
}

if (!InputStream || !OutputStream) {
    console.error("Critical: Cannot find UnixInputStream/UnixOutputStream in this GJS environment.");
    System.exit(1);
}

const inStream = new InputStream({ fd: 3, close_fd: false });
const outStream = new OutputStream({ fd: 4, close_fd: false });

const dataIn = new Gio.DataInputStream({ base_stream: inStream });
const dataOut = new Gio.DataOutputStream({ base_stream: outStream });

const objectStore = new Map();
// Reverse map: GObject → id, for deduplication.
// WeakMap so GObjects can still be GC'd by SpiderMonkey when no other refs exist.
const objectToId = new WeakMap();
let nextObjectId = 1;

function ConvertToProtocol(obj) {
    if (obj === null || obj === undefined) return { type: 'null' };
    const t = typeof obj;
    if (t === 'string' || t === 'number' || t === 'boolean') {
        return { type: 'primitive', value: obj };
    }
    if (Array.isArray(obj)) {
        return { type: 'array', value: obj.map(ConvertToProtocol) };
    }
    // Deduplicate: if this GObject was already given an id that is still alive,
    // reuse it so Node.js gets back the same proxy rather than a new one.
    if (objectToId.has(obj)) {
        const existingId = objectToId.get(obj);
        if (objectStore.has(existingId)) {
            return { type: 'ref', id: existingId };
        }
    }
    const id = `gobj_${nextObjectId++}`;
    objectStore.set(id, obj);
    objectToId.set(obj, id);
    return { type: 'ref', id: id };
}

// Used by signal callbacks and also inside nested IPC calls triggered by those callbacks.
// GJS blocks here until Node.js sends a {type:'reply'} — commands interleaved by
// the Node.js callback (e.g. label.set_label()) are executed before the reply arrives.
function processNestedCommands() {
    while (true) {
        const [line] = dataIn.read_line_utf8(null);
        if (!line) System.exit(0);
        const cmd = JSON.parse(line);
        if (cmd.type === 'reply') return cmd;
        let response;
        try { response = executeCommand(cmd); }
        catch (e) { response = { type: 'error', message: e.toString() }; }
        if (response.type !== '__skip') {
            dataOut.put_string(JSON.stringify(response) + '\n', null);
        }
    }
}

function ResolveArg(arg) {
    if (arg.type === 'null') return null;
    if (arg.type === 'primitive') return arg.value;

    if (arg.type === 'uint8array') {
        return new Uint8Array(arg.value);
    }

    if (arg.type === 'ref') return objectStore.get(arg.id);
    if (arg.type === 'array') return arg.value.map(a => ResolveArg(a));
    if (arg.type === 'object') {
        const obj = {};
        for (let k in arg.value) obj[k] = ResolveArg(arg.value[k]);
        return obj;
    }
    if (arg.type === 'callback') {
        return (...cbArgs) => {
            // Always use the synchronous round-trip so the return value reaches GTK.
            // The Node.js Worker thread is always reading; it will forward this event
            // and drainEvents() will reply within ~16 ms regardless of whether
            // the main thread is currently inside a send() call or between polls.
            const mappedArgs = cbArgs.map(ConvertToProtocol);
            const msg = { type: 'event', callbackId: arg.callbackId, args: mappedArgs };
            dataOut.put_string(JSON.stringify(msg) + '\n', null);
            const res = processNestedCommands();
            if (res.result && res.result.type === 'primitive') return res.result.value;
            return null;
        };
    }
}

function executeCommand(cmd) {
    if (cmd.action === 'LoadNamespace') {
        if (cmd.version) {
            imports.gi.versions[cmd.namespace] = cmd.version;
        }
        const ns = imports.gi[cmd.namespace];
        return ConvertToProtocol(ns);
    }
    // Instantiate from direct TypeId
    if (cmd.action === 'New') {
        const Type = objectStore.get(cmd.typeId);
        const argsArray = (cmd.args || []).map(a => ResolveArg(a));
        const instance = new Type(...argsArray);
        return ConvertToProtocol(instance);
    }
    // Instantiate a property belonging to a namespace/object: e.g. new Gtk.Application()
    if (cmd.action === 'NewProp') {
        const target = objectStore.get(cmd.targetId);
        const Type = target[cmd.property];
        if (!Type) throw new Error("Constructor not found: " + cmd.property);
        const argsArray = (cmd.args || []).map(a => ResolveArg(a));
        const instance = new Type(...argsArray);
        return ConvertToProtocol(instance);
    }
    if (cmd.action === 'Get') {
        const target = objectStore.get(cmd.targetId);
        let val;
        try { val = target[cmd.property]; } catch(e) { return { type: 'null' }; }
        if (typeof val === 'function') return { type: 'function' };
        return ConvertToProtocol(val);
    }
    if (cmd.action === 'Invoke') {
        const target = objectStore.get(cmd.targetId);
        const argsArray = (cmd.args || []).map(a => ResolveArg(a));
        const func = target[cmd.methodName];
        if (!func) throw new Error("Method not found: " + cmd.methodName);
        const res = func.apply(target, argsArray);
        return ConvertToProtocol(res);
    }
    if (cmd.action === 'Set') {
        const target = objectStore.get(cmd.targetId);
        target[cmd.property] = ResolveArg(cmd.value);
        return { type: 'void' };
    }
    if (cmd.action === 'Release') {
        const obj = objectStore.get(cmd.targetId);
        objectStore.delete(cmd.targetId);
        // If objectToId still points to this id, remove it so the next
        // ConvertToProtocol for the same GObject allocates a fresh id.
        if (obj !== undefined && objectToId.get(obj) === cmd.targetId) {
            objectToId.delete(obj);
        }
        return { type: 'void' };
    }
    if (cmd.action === 'Print') {
        print(...cmd.args.map(a => ResolveArg(a)));
        return { type: 'void' };
    }
    // RunApp: pre-send {type:'ok'} so Node.js send() returns immediately,
    // then block inside app.run(). The GLib main loop inside app.run() continues
    // to process io_add_watch, so IPC commands (nested processNestedCommands calls
    // from signal callbacks) are served normally while the app is running.
    if (cmd.action === 'RunApp') {
        const target = objectStore.get(cmd.targetId);
        // Pre-send ok — Node.js Worker reads this and forwards to main thread,
        // which unblocks the main thread's waitResponse() spin loop.
        dataOut.put_string(JSON.stringify({ type: 'ok' }) + '\n', null);
        target.run([]);
        // app.run() returns when all windows are closed.
        // Return sentinel so io_add_watch does NOT send a second response.
        return { type: '__skip' };
    }
    throw new Error(`Unknown Action ${cmd.action}`);
}

function bindIPCEvent() {
    const channel = GLib.IOChannel.unix_new(3);
    GLib.io_add_watch(channel, GLib.PRIORITY_DEFAULT, GLib.IOCondition.IN, (channel, condition) => {
        try {
            const [line] = dataIn.read_line_utf8(null);
            if (!line) {
                System.exit(0);
                return GLib.SOURCE_REMOVE;
            }
            let cmd;
            try {
                cmd = JSON.parse(line);
            } catch (e) {
                dataOut.put_string(JSON.stringify({ type: 'error', message: 'Invalid JSON: ' + e.toString() }) + '\n', null);
                return GLib.SOURCE_CONTINUE;
            }
            let response;
            try { response = executeCommand(cmd); }
            catch (e) { response = { type: 'error', message: e.toString() }; }

            if (response.type !== '__skip') {
                dataOut.put_string(JSON.stringify(response) + '\n', null);
            }
        } catch (e) {
            System.exit(0);
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
}

print("GJS IPC Host: Initialization Complete.");
bindIPCEvent();

const mainLoop = GLib.MainLoop.new(null, false);
mainLoop.run();
