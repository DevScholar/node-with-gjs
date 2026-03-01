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
    const id = `gobj_${nextObjectId++}`;
    objectStore.set(id, obj);
    return { type: 'ref', id: id };
}

function processNestedCommands() {
    while (true) {
        const [line] = dataIn.read_line_utf8(null);
        if (!line) System.exit(0);
        const cmd = JSON.parse(line);
        if (cmd.type === 'reply') return cmd;
        let response;
        try { response = executeCommand(cmd); } 
        catch (e) { response = { type: 'error', message: e.toString() }; }
        dataOut.put_string(JSON.stringify(response) + '\n', null);
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
        objectStore.delete(cmd.targetId);
        return { type: 'void' };
    }
    if (cmd.action === 'Print') {
        print(...cmd.args.map(a => ResolveArg(a)));
        return { type: 'void' };
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
            const cmd = JSON.parse(line);
            
            let response;
            try { response = executeCommand(cmd); } 
            catch (e) { response = { type: 'error', message: e.toString() }; }
            
            dataOut.put_string(JSON.stringify(response) + '\n', null);
        } catch (e) {}
        return GLib.SOURCE_CONTINUE;
    });
}

print("GJS IPC Host: Initialization Complete.");
bindIPCEvent();

const mainLoop = GLib.MainLoop.new(null, false);
mainLoop.run();