// src/ipc.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker, MessageChannel, receiveMessageOnPort } from 'worker_threads';
import type { MessagePort } from 'worker_threads';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class IpcWorker {
    private worker: Worker;
    private port: MessagePort;
    private exited = false;
    private seqCounter = 0;
    // Stash for out-of-order responses: if waitResponse(seq=2) reads a response
    // with seq=1, it stashes it here so waitResponse(seq=1) can find it later.
    private stash = new Map<number, any>();

    constructor(
        private fdRead: number,
        private fdWrite: number,
        private onEvent: (msg: any) => any
    ) {
        const { port1, port2 } = new MessageChannel();
        this.port = port1;

        const workerPath = path.join(__dirname, 'ipc-worker.js');
        this.worker = new Worker(workerPath, {
            workerData: { fdRead, port: port2 },
            transferList: [port2]
        });
        // Start unref'd so console scripts (no app.run()) exit naturally when done.
        // refForApp() re-refs the worker when a Gio.Application.run() is detected,
        // keeping Node.js alive until GJS exits and the worker gets EOF.
        this.worker.unref();
        this.worker.on('error', (e) =>
            console.error('[node-with-gjs] IPC worker error:', e)
        );
    }

    // Spin-receive: returns the next message from the worker.
    // receiveMessageOnPort() is a synchronous, non-blocking call.
    // GJS responds in microseconds, so the spin is extremely brief.
    private readOne(): { kind: string; data?: any } {
        let msg: ReturnType<typeof receiveMessageOnPort>;
        while (!(msg = receiveMessageOnPort(this.port))) {}
        return msg.message;
    }

    // Handle a GJS-initiated sync event: call the JS callback and send the
    // return value back to GJS so the signal handler gets the correct return value.
    private handleEvent(eventData: any) {
        let result: any = null;
        try {
            result = this.onEvent(eventData);
        } catch (e) {
            console.error('[node-with-gjs] Callback error:', e);
        }
        try {
            fs.writeSync(this.fdWrite, JSON.stringify({ type: 'reply', result }) + '\n');
        } catch {}
    }

    // Wait for the response to the current command.
    // Any sync events that arrive in the interim are handled inline — GJS is
    // blocked in processNestedCommands() waiting for the reply, so we must
    // dispatch them before the actual response arrives.
    // Sequence numbers ensure that out-of-order responses (e.g. a Poll response
    // arriving while we're waiting for a Get response inside an event handler)
    // are stashed and returned to the correct caller.
    private waitResponse(expectedSeq: number): any {
        while (true) {
            // A nested waitResponse may have already stashed our response.
            if (this.stash.has(expectedSeq)) {
                const res = this.stash.get(expectedSeq)!;
                this.stash.delete(expectedSeq);
                if (res.type === 'error') throw new Error(`GJS Host Error: ${res.message}`);
                return res;
            }
            const msg = this.readOne();
            if (msg.kind === 'eof') {
                this.exited = true;
                return { type: 'exit' };
            }
            if (msg.kind === 'event') {
                this.handleEvent(msg.data);
                continue; // keep waiting for the real response
            }
            const res = msg.data;
            if (res._seq !== expectedSeq) {
                // This response belongs to a different pending send() call.
                // Stash it so the right waitResponse() can pick it up.
                this.stash.set(res._seq, res);
                continue;
            }
            if (res.type === 'error') throw new Error(`GJS Host Error: ${res.message}`);
            return res;
        }
    }

    send(cmd: any): any {
        if (this.exited) return { type: 'exit' };
        const seq = ++this.seqCounter;
        cmd._seq = seq;
        try {
            fs.writeSync(this.fdWrite, JSON.stringify(cmd) + '\n');
        } catch {
            throw new Error('Pipe closed (Write failed)');
        }
        return this.waitResponse(seq);
    }

    // Drain sync events that arrived between send() calls.
    // Called by setInterval (16 ms) so that callbacks fired during app.run()
    // (e.g. button clicks, draw-func calls) are delivered to JS even when the
    // main thread is not inside send(). GJS blocks in processNestedCommands()
    // until handleEvent() sends the reply, then continues.
    drainEvents() {
        if (this.exited) return;
        let msg: ReturnType<typeof receiveMessageOnPort>;
        while ((msg = receiveMessageOnPort(this.port))) {
            const { kind, data } = msg.message;
            if (kind === 'event') this.handleEvent(data);
            else if (kind === 'eof') { this.exited = true; break; }
            // unexpected 'response' messages between commands are harmless; ignore
        }
    }

    /** Re-ref the worker when a Gio.Application.run() is detected, so Node.js
     *  stays alive until GJS exits and the worker receives EOF. */
    refForApp() { this.worker.ref(); }

    get isExited(): boolean { return this.exited; }

    close() {
        this.exited = true;
        this.worker.terminate();
        try { fs.closeSync(this.fdRead); } catch {}
        try { fs.closeSync(this.fdWrite); } catch {}
    }
}
