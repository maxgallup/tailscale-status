import { h } from '../harness.js';

class Icon {
    constructor(params) {
        Object.assign(this, params);
    }
}

export default {
    Icon,
    ClipboardType: { CLIPBOARD: 1 },
    PolicyType: { ALWAYS: 0, AUTOMATIC: 1, NEVER: 2 },
    Clipboard: {
        get_default: () => ({ set_text: (_type, text) => { h.clipboard = text; } }),
    },
};
