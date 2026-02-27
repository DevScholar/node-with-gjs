// hook.js - Node.js module loader hook for gi:// protocol
export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('gi://')) {
        return {
            url: specifier,
            shortCircuit: true,
            format: 'module'
        };
    }
    return nextResolve(specifier, context, nextResolve);
}

export async function load(url, context, nextLoad) {
    if (url.startsWith('gi://')) {
        // Safely parse 'gi://Gtk?version=4.0'
        const bareUrl = url.replace('gi://', '');
        const [namespacePart, queryPart] = bareUrl.split('?');
        
        const namespace = namespacePart;
        let version = '';
        
        if (queryPart) {
            const params = new URLSearchParams(queryPart);
            version = params.get('version') || '';
        }

        const coreUrl = new URL('./dist/index.js', import.meta.url).href;
        
        const source = `
            import { init, imports } from '${coreUrl}';
            init();
            imports.gi.versions['${namespace}'] = '${version}';
            const ns = imports.gi['${namespace}'];
            export default ns;
        `;
        
        return {
            format: 'module',
            shortCircuit: true,
            source: source
        };
    }
    return nextLoad(url, context, nextLoad);
}
