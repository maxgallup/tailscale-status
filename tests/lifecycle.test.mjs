import { test } from 'node:test';
import assert from 'node:assert/strict';

import { h, flush, setup, status, ui, commands } from './helpers.mjs';

test('enable adds the indicator and polls status', async () => {
    await setup(status());
    const { button, icon } = ui();
    assert.ok(button);
    assert.equal(icon.style_class, 'system-status-icon');
    assert.deepEqual(h.calls[0], ['tailscale', 'status', '--json']);
});

test('menu items are in the expected order', async () => {
    await setup(status());
    const u = ui();
    assert.deepEqual(
        [u.statusSwitch, u.nodes, u.accountButton, u.accounts, u.shield, u.acceptRoutes,
            u.allowLan, u.receiveFiles, u.send, u.exitNodes, u.logout, u.about].map(i => i.label.text),
        ['Tailscale', 'Nodes', 'Update Accounts List', 'Accounts', 'Block Incoming', 'Accept Routes',
            'Allow Direct Lan Access', 'Accept incoming files', 'Send Files', 'Exit Nodes', 'Log Out', 'About']);
});

test('disable destroys the indicator', async () => {
    const { ext } = await setup(status());
    const { button } = ui();
    ext.disable();
    assert.equal(button.destroyed, true);
});

test('enable after disable rebuilds a working indicator', async () => {
    const { ext } = await setup(status());
    ext.disable();
    ext.enable();
    flush();
    const u = ui();
    assert.equal(u.statusItem.label.text, 'Status: up (no exit-node)');
});

test('a status reply arriving after disable is ignored', {
    todo: 'the pending status callback updates menu items that disable() has nulled',
}, async () => {
    const { ext, ui, logs, run } = await setup(status());
    run(() => {
        ui.button.menu.emit('open-state-changed', true);
        ext.disable();
    });
    assert.deepEqual(logs.filter(l => l.startsWith('🔴')), []);
});

test('receiving files still works after disable/enable', {
    todo: 'disable() nulls downloads_path and enable() never restores it (e.g. after screen lock)',
}, async () => {
    const { ext, run } = await setup(status());
    ext.disable();
    run(() => {
        ext.enable();
        flush();
        ui().receiveFiles.activate();
    });
    assert.deepEqual(commands(), ['pkexec tailscale file get /home/tester/Downloads']);
});

test('account indicator is reset after disable/enable', {
    todo: 'disable() sets currentAccount to null, shown as "Account: null"',
}, async () => {
    const { ext } = await setup(status());
    ext.disable();
    ext.enable();
    flush();
    assert.doesNotMatch(ui().accountIndicator.label.text, /null/);
});
