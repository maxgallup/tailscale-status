import { Signals } from '../harness.js';

class EntryBuffer {
    constructor() {
        this.text = '';
    }
}

class Entry extends Signals {
    constructor({ buffer }) {
        super();
        this.buffer = buffer;
    }

    set_text(text) {
        this.buffer.text = text;
    }

    get_buffer() {
        return this.buffer;
    }
}

export default { Entry, EntryBuffer };
