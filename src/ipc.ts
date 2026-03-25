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

    // Handle a GJS-initiated event: call the JS callback and send the return
    // value back to GJS so the signal handler gets the correct return value.
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
    // Any events that arrive in the interim are handled inline (GJS is blocked
    // in processNestedCommands waiting for the reply, so we must handle them
    // before the actual response arrives).
    private waitResponse(): any {
        while (true) {
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
            if (res.type === 'error') throw new Error(`GJS Host Error: ${res.message}`);
            return res;
        }
    }

    send(cmd: any): any {
        if (this.exited) return { type: 'exit' };
        try {
            fs.writeSync(this.fdWrite, JSON.stringify(cmd) + '\n');
        } catch {
            throw new Error('Pipe closed (Write failed)');
        }
        return this.waitResponse();
    }

    // Drain events that arrived between send() calls.
    // Called by setInterval (16 ms) so that callbacks fired during app.run()
    // are delivered to JS even when the main thread isn't inside send().
    // Because GJS blocks in processNestedCommands until it gets a reply,
    // calling handleEvent() here sends the reply and unblocks GJS.
    drainEvents() {
        if (this.exited) return;
        let msg: ReturnType<typeof receiveMessageOnPort>;
        while ((msg = receiveMessageOnPort(this.port))) {
            const { kind, data } = msg.message;
            if (kind === 'event') this.handleEvent(data);
            // unexpected 'response' messages between commands are harmless; ignore
        }
    }

    close() {
        this.exited = true;
        this.worker.terminate();
        try { fs.closeSync(this.fdRead); } catch {}
        try { fs.closeSync(this.fdWrite); } catch {}
    }
}
