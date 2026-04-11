export interface GjsRef {
    readonly __ref: string;
}

export type GjsProxy<T extends object = object> = GjsRef & T;

export interface GiNamespaceMap {
    [namespace: string]: unknown;
}

export interface GiVersionsProxy {
    [namespace: string]: string;
}
