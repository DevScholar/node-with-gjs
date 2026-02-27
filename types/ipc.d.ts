export declare function readLineSync(fd: number): string | null;
export declare class IpcSync {
    private fdRead;
    private fdWrite;
    private onEvent;
    private exited;
    constructor(fdRead: number, fdWrite: number, onEvent: (msg: any) => any);
    send(cmd: any): any;
    close(): void;
}
