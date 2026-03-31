// src/poll.ts
import { getIpc, getPollInterval, setPollInterval, releaseQueue, callbackRegistry } from './state.js';
import { createProxy } from './proxy.js';

// Delay between event-drain polls while the GTK main loop is running.
const POLL_INTERVAL_MS = 16;

function drainEvents() {
    const ipc = getIpc();
    if (!ipc) return;
    // Release GC'd objects first.
    if (releaseQueue.length > 0) {
        for (const id of releaseQueue.splice(0)) {
            try { ipc.send({ action: 'Release', targetId: id }); } catch {}
        }
    }
    // Drain pending sync events from the port (button clicks, draw-func, etc.)
    ipc.drainEvents();
    // Check if GJS has exited (detected by the worker getting EOF).
    if (ipc.isExited) {
        const pi = getPollInterval();
        if (pi) { clearInterval(pi); setPollInterval(null); }
        return;
    }
    // Drain async callback events from GJS's eventQueue via Poll.
    try {
        const res = ipc.send({ action: 'Poll' });
        if (res?.type === 'exit') {
            const pi = getPollInterval();
            if (pi) { clearInterval(pi); setPollInterval(null); }
        } else if (res && res.type === 'poll' && Array.isArray(res.events)) {
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

export function startPolling() {
    if (getPollInterval()) return;
    const pi = setInterval(drainEvents, POLL_INTERVAL_MS);
    (pi as any).unref?.();
    setPollInterval(pi);
}
