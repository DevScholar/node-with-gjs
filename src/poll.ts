// src/poll.ts
import { getIpc, getPollInterval, setPollInterval, releaseQueue } from './state.js';

// Delay between event-drain polls while the GTK main loop is running.
const POLL_INTERVAL_MS = 16;

// Post-drain hooks: callbacks executed at the end of every drainEvents() tick.
// Used by consumers (e.g. node-with-window) that need deferred work to run
// outside a GJS signal handler context, without relying on setImmediate/setTimeout
// (which can stall when the event loop doesn't cycle after readOne() busy-wait).
const postDrainHooks = new Set<() => void>();

/** Register a callback to run after each event-drain tick. */
export function addPostDrainHook(fn: () => void): void { postDrainHooks.add(fn); }

/** Remove a previously registered post-drain hook. */
export function removePostDrainHook(fn: () => void): void { postDrainHooks.delete(fn); }

function drainEvents() {
    const ipc = getIpc();
    if (!ipc) return;
    // Process one ID at a time so a send() failure (host died) doesn't
    // silently drop every remaining ID in the queue. If send throws, push
    // the unsent IDs back so a future attempt can retry — but if the host
    // is exited, just discard (the host process is gone, the GC is moot).
    while (releaseQueue.length > 0) {
        const id = releaseQueue.shift()!;
        try {
            ipc.send({ action: 'Release', targetId: id });
        } catch {
            if (ipc.isExited) {
                releaseQueue.length = 0;
                break;
            }
            // Transient failure — put it back at the front and stop draining
            // this tick so we don't busy-loop on a broken pipe.
            releaseQueue.unshift(id);
            break;
        }
    }
    // Drain pending messages from the port (sync events, async events, EOF).
    // Async events are delivered directly via the output pipe (bypassing the
    // old Poll round-trip), so we only need to read from the MessagePort here.
    ipc.drainEvents();
    // Check if GJS has exited (detected by the worker getting EOF).
    if (ipc.isExited) {
        const pi = getPollInterval();
        if (pi) { clearInterval(pi); setPollInterval(null); }
        return;
    }
    // Run post-drain hooks (deferred close-request handlers, etc.)
    if (postDrainHooks.size > 0) {
        for (const hook of postDrainHooks) {
            try { hook(); } catch (e) { console.error('[node-with-gjs] Post-drain hook error:', e); }
        }
    }
}

export function startPolling() {
    if (getPollInterval()) return;
    const pi = setInterval(drainEvents, POLL_INTERVAL_MS);
    (pi as any).unref?.();
    setPollInterval(pi);
}
