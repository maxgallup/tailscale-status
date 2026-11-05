import { h } from '../harness.js';

const settings = {
    get_string: key => h.settings.get(key),
    set_string: (key, value) => h.settings.set(key, value),
};

export class ExtensionPreferences {
    constructor(metadata = {}) {
        this.metadata = metadata;
        this.path = metadata.path ?? '/ext';
    }

    getSettings() {
        return settings;
    }
}

export const gettext = s => s;
