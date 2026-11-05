import { h } from '../harness.js';

export function spawn(argv) {
    h.spawned.push(argv);
}
