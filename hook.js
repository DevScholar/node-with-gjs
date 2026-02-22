// hook.js
export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('gi://')) {
        return {
            url: specifier,
            shortCircuit: true,
            format: 'module'
        };
    }
    return nextResolve(specifier, context);
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

        const coreUrl = new URL('./src/index.ts', import.meta.url).href;
        
        const source = `
            import { init, loadGiNamespace } from '${coreUrl}';
            init();
            export default loadGiNamespace('${namespace}', '${version}');
        `;
        
        return {
            format: 'module',
            shortCircuit: true,
            source: source
        };
    }
    return nextLoad(url, context);
}