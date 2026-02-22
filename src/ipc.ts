// src/ipc.ts
import * as fs from 'node:fs';

export function readLineSync(fd: number): string | null {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    const buf = Buffer.alloc(1);
    
    while (true) {
        try {
            const r = fs.readSync(fd, buf, 0, 1, null);
            if (r === 0) {
                if (chunks.length === 0) return null;
                break;
            }
            if (buf[0] === 10) break; 
            const chunk = Buffer.alloc(1);
            buf.copy(chunk);
            chunks.push(chunk);
            totalLength += 1;
        } catch (e) {
            return null;
        }
    }
    if (chunks.length === 0) return '';
    const completeBuffer = Buffer.concat(chunks, totalLength);
    return completeBuffer.toString('utf8');
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