import { h } from '../harness.js';

export function notify(msg, details) {
    h.notifications.push(details === undefined ? msg : `${msg} | ${details}`);
}

export const panel = {
    addToStatusArea(role, indicator, _pos) {
        h.statusArea[role] = indicator;
    },
};
