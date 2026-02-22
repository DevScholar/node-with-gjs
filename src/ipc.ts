// src/ipc.ts
import * as fs from 'node:fs';

// Use a global/shared read buffer to handle redundant data across calls
let readBuffer = Buffer.alloc(0);

export function readLineSync(fd: number): string | null {
    while (true) {
        // 1. If the buffer already contains a complete line, extract and return it with minimal overhead
        const newlineIdx = readBuffer.indexOf(10); // 10 is the ASCII code for \n
        if (newlineIdx !== -1) {
            const line = readBuffer.subarray(0, newlineIdx).toString('utf8');
            readBuffer = readBuffer.subarray(newlineIdx + 1);
            return line;
        }

        // 2. Otherwise, try to read a large chunk from the pipe
        const chunk = Buffer.alloc(8192); // Attempt to read 8KB each time
        let bytesRead = 0;
        try {
            bytesRead = fs.readSync(fd, chunk, 0, 8192, null);
        } catch (e) {
            return null;
        }

        if (bytesRead === 0) {
            if (readBuffer.length === 0) return null;
            const line = readBuffer.toString('utf8');
            readBuffer = Buffer.alloc(0);
            return line;
        }

        // 3. Append the newly read data to the buffer
        readBuffer = Buffer.concat([readBuffer, chunk.subarray(0, bytesRead)]);
    }
}

export class IpcSync {
    private exited: boolean = false;

    constructor(
        private fdRead: number,
        private fdWrite: number,
        private onEvent: (msg: any) => any 
    ) {}

    send(cmd: any): any {
        if (this.exited) return { type: 'exit' };

        try {
            fs.writeSync(this.fdWrite, JSON.stringify(cmd) + '\n');
        } catch (e) {
            throw new Error("Pipe closed (Write failed)");
        }

        while (true) {
            const line = readLineSync(this.fdRead);
            if (line === null) throw new Error("Pipe closed (Read EOF)");
            if (!line.trim()) continue;

            let res: any;
            try {
                res = JSON.parse(line);
            } catch (e) {
                throw new Error(`Invalid JSON from host: ${line}`);
            }

            if (res.type === 'event') {
                let result = null;
                try {
                    result = this.onEvent(res);
                } catch (e) {
                    console.error("Callback Error:", e);
                }
                
                const reply = { type: 'reply', result: result };
                try {
                    fs.writeSync(this.fdWrite, JSON.stringify(reply) + '\n');
                } catch {}
                continue; 
            }

            if (res.type === 'error') throw new Error(`GJS Host Error: ${res.message}`);
            
            if (res.type === 'exit') {
                this.exited = true;
                return res;
            }
            
            return res;
        }
    }

    close() {
        this.exited = true;
        if (this.fdRead) try { fs.closeSync(this.fdRead); } catch {}
        if (this.fdWrite) try { fs.closeSync(this.fdWrite); } catch {}
    }
}