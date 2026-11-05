import { test } from 'node:test';
import assert from 'node:assert/strict';

import { h, setup, status, node, find, commands, isStatus } from './helpers.mjs';

const LOGIN = '--login-server=https://controlplane.tailscale.com';

test('switch on runs tailscale up with the login server', async () => {
    const { ui, run } = await setup(status({ state: 'Stopped' }));
    run(() => ui.statusSwitch.activate());
    assert.deepEqual(commands(), [`tailscale up ${LOGIN}`]);
});

test('switch off runs tailscale down without the login server', async () => {
    const { ui, run } = await setup(status());
    run(() => ui.statusSwitch.activate());
    assert.deepEqual(commands(), ['tailscale down']);
});

test('the login server is read from settings', async () => {
    const { ui, run } = await setup(status({ state: 'Stopped' }));
    h.settings.set('login-server', 'https://headscale.example.com');
    run(() => ui.statusSwitch.activate());
    assert.deepEqual(commands(), ['tailscale up --login-server=https://headscale.example.com']);
});

test('a successful command refreshes the status', async () => {
    const { ui, run } = await setup(status());
    const before = h.calls.filter(isStatus).length;
    run(() => ui.statusSwitch.activate());
    assert.equal(h.calls.filter(isStatus).length, before + 1);
});

test('a failed up is retried with pkexec as operator', async () => {
    const { ui, run } = await setup(status({ state: 'Stopped' }),
        argv => ({ ok: argv[0] === 'pkexec' }));
    run(() => ui.statusSwitch.activate());
    assert.deepEqual(commands(), [
        `tailscale up ${LOGIN}`,
        `pkexec tailscale up --operator=tester --reset ${LOGIN}`,
    ]);
});

test('a failed down is retried with pkexec without extra flags', async () => {
    const { ui, run } = await setup(status(), argv => ({ ok: argv[0] === 'pkexec' }));
    run(() => ui.statusSwitch.activate());
    assert.deepEqual(commands(), ['tailscale down', 'pkexec tailscale down']);
});

test('a failed pkexec retry is not retried again', async () => {
    const { ui, logs, run } = await setup(status(), () => ({ ok: false }));
    run(() => ui.statusSwitch.activate());
    assert.deepEqual(commands(), ['tailscale down', 'pkexec tailscale down']);
    assert.ok(logs.some(l => l.includes('failed @ cmdTailscale')), logs.join('\n'));
});

for (const [item, on, off] of [
    ['shield', '--shields-up', '--shields-up=false --reset'],
    ['acceptRoutes', '--accept-routes', '--accept-routes=false --reset'],
]) {
    test(`${item} toggle sets ${on}`, async () => {
        const { ui, run } = await setup(status());
        run(() => ui[item].activate());
        run(() => ui[item].activate());
        assert.deepEqual(commands(), [`tailscale up ${on} ${LOGIN}`, `tailscale up ${off} ${LOGIN}`]);
    });
}

test('allow LAN access requires an exit node', async () => {
    const { ui, run } = await setup(status({ peers: [node('desktop', '100.64.0.2')] }));
    run(() => ui.allowLan.activate());
    assert.deepEqual(commands(), []);
    assert.equal(ui.allowLan.state, false);
    assert.deepEqual(h.notifications, ['Must setup exit node first']);
});

test('allow LAN access is enabled when using an exit node', async () => {
    const { ui, run } = await setup(status({
        peers: [node('exit', '100.64.0.9', { exitOption: true, exitNode: true })],
    }));
    run(() => ui.allowLan.activate());
    run(() => ui.allowLan.activate());
    assert.deepEqual(commands(), [
        `tailscale up --exit-node-allow-lan-access ${LOGIN}`,
        `tailscale up --exit-node-allow-lan-access=false --reset ${LOGIN}`,
    ]);
});

test('allow LAN access finds the exit node wherever it sorts', {
    todo: 'allow LAN only checks nodes[0].usesExit, which is not necessarily the exit node',
}, async () => {
    const { ui, run } = await setup(status({
        peers: [
            node('alpha', '100.64.0.2'),
            node('exit', '100.64.0.9', { exitOption: true, exitNode: true }),
        ],
    }));
    run(() => ui.allowLan.activate());
    assert.deepEqual(commands(), [`tailscale up --exit-node-allow-lan-access ${LOGIN}`]);
});

test('choosing an exit node runs tailscale up --exit-node', async () => {
    const { ui, run } = await setup(status({
        peers: [node('router', '100.64.0.2', { exitOption: true })],
    }));
    run(() => find(ui.exitNodes.menu, 'router').activate());
    run(() => find(ui.exitNodes.menu, 'None').activate());
    assert.deepEqual(commands(), [
        `tailscale up --exit-node=100.64.0.2 --reset ${LOGIN}`,
        `tailscale up --exit-node= --reset ${LOGIN}`,
    ]);
});

test('log out runs tailscale logout', async () => {
    const { ui, run } = await setup(status());
    run(() => ui.logout.activate());
    assert.deepEqual(commands(), ['tailscale logout']);
});

test('login item runs tailscale up when there is no auth URL', async () => {
    const { ui, run } = await setup(status({ state: 'NeedsLogin' }));
    run(() => ui.authItem.activate());
    assert.deepEqual(commands(), [`tailscale up ${LOGIN}`]);
});

test('login item only refreshes when an auth URL is pending', async () => {
    const { ui, run } = await setup(status({ state: 'NeedsLogin', authURL: 'https://login.tailscale.com/a/x' }));
    run(() => ui.authItem.activate());
    assert.deepEqual(commands(), []);
});

test('receive files saves to the Downloads directory', async () => {
    const { ui, run } = await setup(status());
    run(() => ui.receiveFiles.activate());
    assert.deepEqual(commands(), ['pkexec tailscale file get /home/tester/Downloads']);
    assert.deepEqual(h.notifications, ['Saved files to /home/tester/Downloads']);
});

test('receive files reports failure', async () => {
    const { ui, run } = await setup(status(), () => ({ ok: false }));
    run(() => ui.receiveFiles.activate());
    assert.match(h.notifications[0], /^Unable to receive files to \/home\/tester\/Downloads/);
});

test('send files picks files with zenity and sends them with tailscale file cp', {
    todo: 'sendFiles() assigns an undeclared `files` and calls cmdTailscaleFile(), which was removed in a0367ac',
}, async () => {
    const { ui, logs, run } = await setup(status({ peers: [node('desktop', '100.64.0.2')] }),
        argv => argv[0] === 'zenity' ? { ok: true, stdout: '/tmp/a.txt|/tmp/b c.txt\n' } : { ok: true });
    run(() => find(ui.send.menu, 'desktop').activate());
    assert.ok(commands().includes('zenity --file-selection --multiple'));
    const cp = h.calls.find(a => a.includes('cp'));
    assert.ok(cp, logs.join('\n'));
    assert.deepEqual(cp.slice(cp.indexOf('tailscale')),
        ['tailscale', 'file', 'cp', '/tmp/a.txt', '/tmp/b c.txt', '100.64.0.2:']);
});

test('send files does nothing when zenity is cancelled', async () => {
    const { ui, logs, run } = await setup(status({ peers: [node('desktop', '100.64.0.2')] }),
        argv => ({ ok: argv[0] !== 'zenity' }));
    run(() => find(ui.send.menu, 'desktop').activate());
    assert.deepEqual(commands(), ['zenity --file-selection --multiple']);
    assert.ok(logs.some(l => l.includes('zenity failed')), logs.join('\n'));
});

// `tailscale switch --list` prints an "ID  Tailnet  Account" table and marks the
// active profile with a trailing "*".
const SWITCH_LIST = [
    'ID    Tailnet             Account',
    'a1b2  example.com         alice@example.com*',
    'c3d4  bob.github          bob@example.com',
    '',
].join('\n');

const switchList = argv => argv.join(' ').endsWith('switch --list') ? { ok: true, stdout: SWITCH_LIST } : { ok: true };

test('update accounts runs tailscale switch --list, retrying with pkexec', async () => {
    const { ui, run } = await setup(status(), argv => ({ ok: argv[0] === 'pkexec' }));
    run(() => ui.accountButton.activate());
    assert.deepEqual(commands().slice(0, 2), ['tailscale switch --list', 'pkexec tailscale switch --list']);
});

test('account list shows one item per profile', {
    todo: 'switch --list parsing expects a legacy " *" suffix and lists the header row',
}, async () => {
    const { ui, run } = await setup(status(), switchList);
    run(() => ui.accountButton.activate());
    const items = ui.accounts.menu.items.map(i => i.label.text);
    assert.equal(items.length, 2, items.join('\n'));
    assert.ok(items.every(l => !l.includes('*') && !l.startsWith('ID')), items.join('\n'));
});

test('account list marks the active account', {
    todo: 'switch --list parsing expects a legacy " *" suffix',
}, async () => {
    const { ui, run } = await setup(status(), switchList);
    run(() => ui.accountButton.activate());
    run(() => ui.button.menu.emit('open-state-changed', true));
    assert.match(ui.accountIndicator.label.text, /^Account: .*alice@example\.com/);
});

test('choosing another account switches to it without the login server', async () => {
    const { ui, run } = await setup(status(), switchList);
    run(() => ui.accountButton.activate());
    const bob = ui.accounts.menu.items.find(i => i.label.text.includes('bob@example.com'));
    run(() => bob.activate());
    assert.ok(commands().some(c => /^tailscale switch (c3d4|bob@example\.com)$/.test(c)), commands().join('\n'));
    assert.match(h.notifications[0], /^Switching to /);
});

test('choosing the active account does not switch', {
    todo: 'currentAccount holds the whole list line but is compared against the extracted email',
}, async () => {
    const { ui, run } = await setup(status(), switchList);
    run(() => ui.accountButton.activate());
    const alice = ui.accounts.menu.items.find(i => i.label.text.includes('alice@example.com'));
    run(() => alice.activate());
    assert.ok(!commands().some(c => c.startsWith('tailscale switch ') && !c.endsWith('--list')), commands().join('\n'));
});
