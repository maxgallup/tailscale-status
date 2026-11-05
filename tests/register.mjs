// Maps gi:// and resource:/// imports to the mocks in tests/mocks so the
// extension can be loaded under plain node.
import { registerHooks } from 'node:module';

const mocks = new URL('./mocks/', import.meta.url);

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('gi://')) {
            const name = specifier.slice('gi://'.length).split('?')[0];
            return { url: new URL(`gi/${name}.js`, mocks).href, shortCircuit: true };
        }
        if (specifier.startsWith('resource:///')) {
            const name = specifier.split('/').pop();
            return { url: new URL(`resource/${name}`, mocks).href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
