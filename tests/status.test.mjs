import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    h, setup, status, node, mullvad, labels, find, openMenu, isStatus, respondWith,
} from './helpers.mjs';

test('nodes menu lists self and peers with status icons', async () => {
    const { ui } = await setup(status({
        peers: [node('desktop', '100.64.0.2'), node('nas', '100.64.0.3', { online: false })],
    }));
    assert.deepEqual(labels(ui.nodes.menu), [
        '🟢 100.64.0.2 desktop',
        '⚫ 100.64.0.3 nas',
        '💻 100.64.0.1 laptop',
    ]);
});

test('nodes are ordered online first, then offline, self last', async () => {
    const { ui } = await setup(status({
        peers: [
            node('off', '100.64.0.2', { online: false }),
            node('on', '100.64.0.3'),
        ],
    }));
    assert.deepEqual(labels(ui.nodes.menu).map(l => l.split(' ').pop()), ['on', 'off', 'laptop']);
});

test('nodes with equal status are ordered by name', {
    todo: 'sortArrProp() returns undefined for equal groupPaths, so combineSort never reaches the name sort',
}, async () => {
    const { ui } = await setup(status({
        peers: [node('zed', '100.64.0.2'), node('alice', '100.64.0.3'), node('mike', '100.64.0.4')],
    }));
    assert.deepEqual(labels(ui.nodes.menu).map(l => l.split(' ').pop()), ['alice', 'mike', 'zed', 'laptop']);
});

test('peers without Tailscale IPs and Mullvad exit nodes are left out of the nodes menu', async () => {
    const { ui } = await setup(status({
        peers: [
            node('desktop', '100.64.0.2'),
            node('pending', null, { ips: null }),
            mullvad('se-sto-wg-001', '100.64.1.1', { country: 'Sweden', city: 'Stockholm' }),
        ],
    }));
    assert.deepEqual(labels(ui.nodes.menu), ['🟢 100.64.0.2 desktop', '💻 100.64.0.1 laptop']);
});

test('self is omitted when it has no Tailscale IPs', async () => {
    const { ui } = await setup(status({
        self: node('laptop', null, { ips: null }),
        peers: [node('desktop', '100.64.0.2')],
    }));
    assert.deepEqual(labels(ui.nodes.menu), ['🟢 100.64.0.2 desktop']);
});

test('activating a node copies its address to the clipboard', async () => {
    const { ui } = await setup(status({ peers: [node('desktop', '100.64.0.2')] }));
    ui.nodes.menu.items[0].activate();
    assert.equal(h.clipboard, '100.64.0.2');
    assert.deepEqual(h.notifications, ['Copied 100.64.0.2 to clipboard! (desktop)']);
});

test('Running: icon up, switch on, all items sensitive', async () => {
    const { ui } = await setup(status({ peers: [node('desktop', '100.64.0.2')] }));
    assert.equal(ui.icon.gicon.path, '/ext/icon-up.svg');
    assert.equal(ui.statusSwitch.state, true);
    assert.equal(ui.statusItem.label.text, 'Status: up (no exit-node)');
    for (const item of [ui.shield, ui.acceptRoutes, ui.allowLan, ui.statusSwitch,
        ui.receiveFiles, ui.nodes, ui.send, ui.exitNodes, ui.accounts, ui.accountButton, ui.logout])
        assert.equal(item.sensitive, true);
});

test('Running with an exit node shows it in the status and icon', async () => {
    const { ui } = await setup(status({
        peers: [node('exit', '100.64.0.9', { exitOption: true, exitNode: true })],
    }));
    assert.equal(ui.statusItem.label.text, 'Status: up (exit-node: exit)');
    assert.equal(ui.icon.gicon.path, '/ext/icon-exit-node.svg');
});

test('Stopped: icon down, switch off, only the switch stays sensitive', async () => {
    const { ui } = await setup(status({ state: 'Stopped', peers: [node('desktop', '100.64.0.2')] }));
    assert.equal(ui.icon.gicon.path, '/ext/icon-down.svg');
    assert.equal(ui.statusSwitch.state, false);
    assert.equal(ui.statusSwitch.sensitive, true);
    assert.equal(ui.statusItem.label.text, 'Status: down');
    for (const item of [ui.shield, ui.acceptRoutes, ui.allowLan, ui.receiveFiles,
        ui.nodes, ui.send, ui.exitNodes, ui.accounts, ui.accountButton, ui.logout])
        assert.equal(item.sensitive, false);
    assert.deepEqual(labels(ui.nodes.menu), []);
    assert.deepEqual(labels(ui.send.menu), []);
});

for (const state of ['Stopped', 'NeedsLogin']) {
    test(`${state}: exit nodes menu only offers None`, {
        todo: 'setStatus() clears nodes but not nodesTree, which the exit nodes menu is built from',
    }, async () => {
        const { ui } = await setup(status({
            state, peers: [node('router', '100.64.0.2', { exitOption: true })],
        }));
        assert.deepEqual(labels(ui.exitNodes.menu), ['None']);
    });
}

test('NeedsLogin opens the auth URL once and enables the login item', async () => {
    const authURL = 'https://login.tailscale.com/a/abc123';
    const { ui } = await setup(status({ state: 'NeedsLogin', authURL }));
    assert.deepEqual(h.spawned, [['xdg-open', authURL]]);
    assert.equal(ui.statusItem.label.text, 'Status: needs login');
    assert.equal(ui.authItem.label.text, 'Click to Login');
    assert.equal(ui.authItem.sensitive, true);
    assert.equal(ui.statusSwitch.state, false);
    assert.equal(ui.statusSwitch.sensitive, false);

    openMenu(ui.button);
    assert.equal(h.spawned.length, 1, 'auth URL should not be reopened on every refresh');
});

test('NeedsLogin reopens the auth URL after having been logged in', async () => {
    const authURL = 'https://login.tailscale.com/a/abc123';
    const { ui } = await setup(status({ state: 'NeedsLogin', authURL }));
    respondWith(status());
    openMenu(ui.button);
    respondWith(status({ state: 'NeedsLogin', authURL }));
    openMenu(ui.button);
    assert.equal(h.spawned.length, 2);
});

test('NeedsLogin without an auth URL opens nothing', async () => {
    await setup(status({ state: 'NeedsLogin' }));
    assert.deepEqual(h.spawned, []);
});

test('an unknown backend state is logged', async () => {
    const { logs } = await setup(status({ state: 'Starting' }));
    assert.ok(logs.some(l => l.includes('unknown state')), logs.join('\n'));
});

test('logged-in user is looked up from Self.UserID', async () => {
    const { ui } = await setup(status({
        users: { 1: { ID: 1, LoginName: 'alice@example.com' }, 2: { ID: 2, LoginName: 'bob@example.com' } },
    }));
    assert.equal(ui.authItem.label.text, 'Logged in: alice@example.com');
    assert.equal(ui.authItem.sensitive, false);
});

test('logged-in user falls back to the host name', async () => {
    const { ui } = await setup(status({ users: null }));
    assert.equal(ui.authItem.label.text, 'Logged in: laptop');
});

test('invalid status JSON is logged without throwing', async () => {
    const { ui, logs, run } = await setup();
    h.responder = argv => isStatus(argv) ? { ok: true, stdout: 'not json' } : { ok: true };
    run(() => openMenu(ui.button));
    assert.ok(logs.some(l => l.startsWith('🔴') && l.includes('SyntaxError')), logs.join('\n'));
});

test('opening the menu refreshes the status', async () => {
    const { ui } = await setup(status());
    const before = h.calls.filter(isStatus).length;
    respondWith(status({ state: 'Stopped' }));
    openMenu(ui.button);
    assert.equal(h.calls.filter(isStatus).length, before + 1);
    assert.equal(ui.statusItem.label.text, 'Status: down');

    ui.button.menu.emit('open-state-changed', false);
    assert.equal(h.queue.length, 0, 'closing the menu should not poll');
});

test('exit nodes menu lists only nodes offering exit, with None first', async () => {
    const { ui } = await setup(status({
        peers: [
            node('router', '100.64.0.2', { exitOption: true }),
            node('desktop', '100.64.0.3'),
        ],
    }));
    assert.deepEqual(labels(ui.exitNodes.menu), ['None', 'router']);
    assert.deepEqual(ui.exitNodes.menu.items.map(i => i.ornament), [1, 0]);
});

test('the active exit node is marked instead of None', async () => {
    const { ui } = await setup(status({
        peers: [node('router', '100.64.0.2', { exitOption: true, exitNode: true })],
    }));
    assert.equal(find(ui.exitNodes.menu, 'None').ornament, 0);
    assert.equal(find(ui.exitNodes.menu, 'router').ornament, 1);
});

test('Mullvad exit nodes are grouped by country and city', async () => {
    const { ui } = await setup(status({
        peers: [
            node('router', '100.64.0.2', { exitOption: true }),
            mullvad('no-osl-wg-001', '100.64.1.1', { country: 'Norway', city: 'Oslo' }),
            mullvad('se-sto-wg-001', '100.64.1.2', { country: 'Sweden', city: 'Stockholm' }),
            mullvad('xx-unknown', '100.64.1.3'),
        ],
    }));
    const menu = ui.exitNodes.menu;
    assert.deepEqual(labels(menu), ['None', 'router', 'Mullvad']);

    const mv = find(menu, 'Mullvad').menu;
    assert.deepEqual(labels(mv), [' xx-unknown', ' Norway', ' Sweden']);
    const norway = find(mv, ' Norway').menu;
    assert.deepEqual(labels(norway), ['  Oslo']);
    assert.deepEqual(labels(find(norway, '  Oslo').menu), ['   no-osl-wg-001']);
});

test('Mullvad countries are sorted by name', {
    todo: 'sortArrProp() returns undefined when one groupPath is a prefix of another, making the sort inconsistent',
}, async () => {
    const { ui } = await setup(status({
        peers: [
            mullvad('se-sto-wg-001', '100.64.1.2', { country: 'Sweden', city: 'Stockholm' }),
            mullvad('xx-unknown', '100.64.1.3'),
            mullvad('no-osl-wg-001', '100.64.1.1', { country: 'Norway', city: 'Oslo' }),
        ],
    }));
    assert.deepEqual(labels(find(ui.exitNodes.menu, 'Mullvad').menu), [' xx-unknown', ' Norway', ' Sweden']);
});

test('an active Mullvad exit node marks every parent submenu', async () => {
    const { ui } = await setup(status({
        peers: [
            mullvad('no-osl-wg-001', '100.64.1.1', { country: 'Norway', city: 'Oslo', exitNode: true }),
            mullvad('se-sto-wg-001', '100.64.1.2', { country: 'Sweden', city: 'Stockholm' }),
        ],
    }));
    const menu = ui.exitNodes.menu;
    const mv = find(menu, 'Mullvad');
    const norway = find(mv.menu, ' Norway');
    const oslo = find(norway.menu, '  Oslo');
    assert.equal(find(menu, 'None').ornament, 0);
    assert.equal(mv.ornament, 1);
    assert.equal(norway.ornament, 1);
    assert.equal(oslo.ornament, 1);
    assert.equal(find(mv.menu, ' Sweden').ornament, 0);
    assert.equal(ui.statusItem.label.text, 'Status: up (exit-node: no-osl-wg-001)');
});

test('nested exit node submenus defer scrolling to the exit nodes menu', async () => {
    const { ui } = await setup(status({
        peers: [mullvad('no-osl-wg-001', '100.64.1.1', { country: 'Norway', city: 'Oslo' })],
    }));
    const root = ui.exitNodes.menu;
    const norway = find(find(root, 'Mullvad').menu, ' Norway');
    assert.equal(norway.menu._needsScrollbar(), false);
    assert.equal(norway.menu.actor.mouseScrolling, false);

    root._needsScrollbar = () => true;
    norway._subMenuOpenStateChanged(norway.menu, true);
    assert.equal(root.actor.vscrollbar_policy, 0);
    assert.ok(root.actor.pseudoClasses.has('scrolled'));

    root._needsScrollbar = () => false;
    norway._subMenuOpenStateChanged(norway.menu, false);
    assert.ok(!root.actor.pseudoClasses.has('scrolled'));
});

test('send menu lists only online peers that are not Mullvad nodes', async () => {
    const { ui } = await setup(status({
        peers: [
            node('desktop', '100.64.0.2'),
            node('nas', '100.64.0.3', { online: false }),
            mullvad('se-sto-wg-001', '100.64.1.2', { country: 'Sweden', city: 'Stockholm' }),
        ],
    }));
    assert.deepEqual(labels(ui.send.menu), ['desktop']);
});

test('health item shows the health messages', async () => {
    const { ui } = await setup(status({ health: ['DNS unavailable', 'no DERP home'] }));
    find(ui.about.menu, 'Health').activate();
    assert.deepEqual(h.notifications, ['DNS unavailable,no DERP home']);
});

test('health item handles missing health', async () => {
    const { ui } = await setup(status());
    find(ui.about.menu, 'Health').activate();
    assert.deepEqual(h.notifications, ['null']);
});

test('contribute item opens the project page', async () => {
    const { ui } = await setup(status());
    find(ui.about.menu, 'Contribute').activate();
    assert.deepEqual(h.spawned, [['xdg-open', 'https://github.com/maxgallup/tailscale-status#contribute']]);
});
