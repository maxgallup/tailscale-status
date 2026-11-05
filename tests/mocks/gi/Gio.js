import { h } from '../harness.js';

class Subprocess {
    static new(argv, _flags) {
        // GJS rejects non-string argv entries
        if (!argv.every(a => typeof a === 'string'))
            throw new TypeError(`invalid argv: ${JSON.stringify(argv)}`);
        h.calls.push(argv);
        return new Subprocess(argv);
    }

    constructor(argv) {
        this.argv = argv;
    }

    communicate_utf8_async(_stdin, _cancellable, cb) {
        h.queue.push(() => {
            const r = h.responder(this.argv) ?? {};
            this._ok = r.ok ?? true;
            this._stdout = r.stdout ?? '';
            cb(this, null);
        });
    }

    communicate_utf8_finish(_res) {
        return [true, this._stdout, ''];
    }

    get_successful() {
        return this._ok;
    }
}

export default {
    Subprocess,
    SubprocessFlags: { STDOUT_PIPE: 2, STDERR_PIPE: 8 },
    icon_new_for_string: path => ({ path }),
};
