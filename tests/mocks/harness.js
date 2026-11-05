// Shared state recorded by the mocks and inspected by the tests.
export const h = {};

export function reset() {
    Object.assign(h, {
        // argv of every Gio.Subprocess spawned
        calls: [],
        // pending communicate_utf8_async callbacks
        queue: [],
        // (argv) => {ok, stdout}
        responder: () => ({ ok: true, stdout: '' }),
        notifications: [],
        spawned: [],
        clipboard: null,
        statusArea: {},
        settings: new Map([['login-server', 'https://controlplane.tailscale.com']]),
        downloadsDir: '/home/tester/Downloads',
        userName: 'tester',
    });
}
reset();

// Run queued subprocess callbacks, including any they enqueue.
export function flush() {
    for (let i = 0; h.queue.length > 0; i++) {
        if (i > 100)
            throw new Error('flush: subprocess loop');
        h.queue.shift()();
    }
}

export class Signals {
    constructor() {
        this._handlers = {};
    }

    connect(name, cb) {
        (this._handlers[name] ??= []).push(cb);
    }

    emit(name, ...args) {
        for (const cb of this._handlers[name] ?? [])
            cb(this, ...args);
    }
}
