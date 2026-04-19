// src/ipc-worker.ts
// This module runs in a dedicated Worker thread.
// It owns fdRead and permanently blocks in readSync(), forwarding
// every line from the GJS host to the main thread via a MessagePort.
// This keeps the Node.js main thread's event loop alive while GJS runs.
import { workerData } from 'worker_threads';
import type { MessagePort } from 'worker_threads';
import * as fs from 'node:fs';

const port: MessagePort = workerData.port;
// Under Deno, worker_threads isolates have separate resource tables, so the
// fdRead from the main thread is unusable here.  If fdReadPath is supplied,
// open the FIFO locally in this worker's context instead.
// TODO: remove fdReadPath branch once denoland/deno#33039 ships in a stable release.
const fdRead: number = workerData.fdReadPath
    ? fs.openSync(workerData.fdReadPath as string, fs.constants.O_RDONLY)
    : workerData.fdRead;

let pending = Buffer.alloc(0);

function readLine(): string | null {
    while (true) {
        const nl = pending.indexOf(10); // '\n'
        if (nl !== -1) {
            const line = pending.subarray(0, nl).toString('utf8');
            pending = pending.subarray(nl + 1);
            return line;
        }
        const chunk = Buffer.alloc(8192);
        let n = 0;
        try {
            n = fs.readSync(fdRead, chunk, 0, 8192, null);
        } catch {
            return null;
        }
        if (n === 0) return null;
        pending = Buffer.concat([pending, chunk.subarray(0, n)]);
    }
}

// Permanent read loop — blocks in readSync(), never yields unless GJS exits.
while (true) {
    const line = readLine();
    if (line === null) {
        port.postMessage({ kind: 'eof' });
        break;
    }
    if (!line.trim()) continue;
    let msg: any;
    try {
        msg = JSON.parse(line);
    } catch {
        continue; // skip malformed JSON
    }
    // 'event' = GJS-initiated sync callback (needs a reply before GJS continues)
    // 'async_event' = GJS-initiated async callback (no reply needed)
    // everything else = response to a command sent by the main thread
    const kind = msg.type === 'event' ? 'event' : msg.type === 'async_event' ? 'async_event' : 'response';
    port.postMessage({ kind, data: msg });
}
