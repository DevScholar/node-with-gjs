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
    private readOne(): { kind: string; data?: any } {
        let msg: ReturnType<typeof receiveMessageOnPort>;
        while (!(msg = receiveMessageOnPort(this.port))) {}
        return msg.message;
    }

    private waitResponse(): any {
        while (true) {
            const msg = this.readOne();
            if (msg.kind === 'eof') {
                this.exited = true;
                return { type: 'exit' };
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

    close() {
        this.exited = true;
        this.worker.terminate();
        try { fs.closeSync(this.fdRead); } catch {}
        try { fs.closeSync(this.fdWrite); } catch {}
    }
}
