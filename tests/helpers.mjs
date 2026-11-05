import { h, reset, flush } from './mocks/harness.js';

export { h, flush };

const EXT_URL = new URL('../tailscale-status@maxgallup.github.com/extension.js', import.meta.url).href;
let generation = 0;

// Builds one peer/self entry of `tailscale status --json`.
export function node(name, ip, {
    online = true, exitOption = false, exitNode = false, tags, location, ips, userID = 1,
} = {}) {
    return {
        HostName: name,
        DNSName: `${name}.tail1234.ts.net.`,
        TailscaleIPs: ips === undefined ? [ip, 'fd7a:115c:a1e0::1'] : ips,
        Online: online,
        ExitNodeOption: exitOption,
        ExitNode: exitNode,
        UserID: userID,
        ...(tags && { Tags: tags }),
        ...(location && { Location: location }),
    };
}

export function mullvad(name, ip, { country, city, ...rest } = {}) {
    return node(name, ip, {
        exitOption: true,
        userID: 999,
        tags: ['tag:mullvad-exit-node'],
        location: country ? { Country: country, City: city } : undefined,
        ...rest,
    });
}

export function status({
    state = 'Running', self = node('laptop', '100.64.0.1'), peers = [],
    users = { 1: { ID: 1, LoginName: 'alice@example.com' } }, authURL = '', health = null,
} = {}) {
    return {
        BackendState: state,
        AuthURL: authURL,
        Self: self,
        Peer: Object.fromEntries(peers.map((p, i) => [`nodekey:${i}`, p])),
        User: users,
        Health: health,
    };
}

export const isStatus = argv => argv.join(' ') === 'tailscale status --json';

// Replies to `tailscale status --json` with `json`; other commands go to `other`.
export function respondWith(json, other = () => ({ ok: true })) {
    h.responder = argv => isStatus(argv) ? { ok: true, stdout: JSON.stringify(json) } : other(argv);
}

// Commands other than status polling.
export function commands() {
    return h.calls.filter(a => !isStatus(a)).map(a => a.join(' '));
}

// Loads a fresh copy of extension.js (module state included) and enables it.
export async function setup(json = status(), other) {
    reset();
    respondWith(json, other);
    const logs = [];
    const { default: Ext } = await import(`${EXT_URL}?gen=${++generation}`);
    const ext = new Ext({ path: '/ext' });
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
        ext.enable();
        flush();
    } finally {
        console.log = origLog;
    }
    return { ext, logs, ui: ui(), run: fn => capture(logs, fn) };
}

// Runs fn and drains subprocess callbacks, capturing console.log.
function capture(logs, fn) {
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
        fn?.();
        flush();
    } finally {
        console.log = origLog;
    }
}

// Named handles on the top-level menu items, in the order extension.js adds them.
export function ui() {
    const button = h.statusArea.tailscale;
    const [
        statusSwitch, statusItem, authItem, accountIndicator, , nodes, accountButton,
        accounts, , shield, acceptRoutes, allowLan, , receiveFiles, send, exitNodes,
        logout, about,
    ] = button.menu.items;
    return {
        button, icon: button.children[0], statusSwitch, statusItem, authItem,
        accountIndicator, nodes, accountButton, accounts, shield, acceptRoutes, allowLan,
        receiveFiles, send, exitNodes, logout, about,
    };
}

export const labels = menu => menu.items.map(i => i.label.text);
export const find = (menu, text) => menu.items.find(i => i.label.text === text);

export function openMenu(button) {
    button.menu.emit('open-state-changed', true);
    flush();
}
