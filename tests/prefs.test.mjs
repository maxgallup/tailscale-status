import { test } from 'node:test';
import assert from 'node:assert/strict';

import { h } from './helpers.mjs';
import { reset } from './mocks/harness.js';

const { default: Prefs } = await import('../tailscale-status@maxgallup.github.com/prefs.js');

function open() {
    reset();
    h.settings.set('login-server', 'https://headscale.example.com');
    const pages = [];
    new Prefs({ path: '/ext' }).fillPreferencesWindow({ add: p => pages.push(p) });
    const row = pages[0].groups[0].rows[0];
    return { row, entry: row.suffixes[0] };
}

test('login server entry shows the current setting', () => {
    const { row, entry } = open();
    assert.equal(row.title, 'Login-Server URL');
    assert.equal(entry.get_buffer().text, 'https://headscale.example.com');
});

test('editing the login server entry saves the setting', () => {
    const { entry } = open();
    entry.set_text('https://other.example.com');
    entry.emit('changed');
    assert.equal(h.settings.get('login-server'), 'https://other.example.com');
});
