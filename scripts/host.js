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
// Queue of callback events waiting to be drained by a Poll command.
const eventQueue = [];
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
            // Enqueue the event; Node.js drains it via the Poll action.
            // Returning immediately keeps the GLib main loop running so GTK
            // events (button clicks, dialog responses, etc.) are processed.
            const mappedArgs = cbArgs.map(ConvertToProtocol);
            eventQueue.push({ callbackId: arg.callbackId, args: mappedArgs });
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
    if (cmd.action === 'Poll') {
        const events = eventQueue.splice(0);
        return { type: 'poll', events };
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
            // Detect Gio.Application.run() by actual runtime type — no heuristics.
            // Pre-send {type:'run_started'} so Node.js unblocks immediately,
            // then enter the blocking GTK main loop. The GLib event loop inside
            // app.run() continues to fire io_add_watch, so signal-callback IPC
            // (processNestedCommands) keeps working while the app is running.
            // Returning SOURCE_CONTINUE without a second dataOut.put_string avoids
            // sending a spurious extra response — no sentinel needed.
            if (cmd.action === 'Invoke' && cmd.methodName === 'run') {
                const target = objectStore.get(cmd.targetId);
                let isGioApp = false;
                try { isGioApp = target instanceof imports.gi.Gio.Application; } catch {}
                if (isGioApp) {
                    dataOut.put_string(JSON.stringify({ type: 'run_started' }) + '\n', null);
                    const argsArray = (cmd.args || []).map(a => ResolveArg(a));
                    target.run(argsArray[0] || []);
                    // app.run() returned — all windows closed.
                    // Quit the GLib main loop so the GJS process exits.
                    // This causes the Worker's readSync() to get EOF, the Worker
                    // thread exits, and Node.js has nothing left to keep it alive.
                    mainLoop.quit();
                    return GLib.SOURCE_CONTINUE;
                }
            }

            let response;
            try { response = executeCommand(cmd); }
            catch (e) { response = { type: 'error', message: e.toString() }; }

            dataOut.put_string(JSON.stringify(response) + '\n', null);
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
