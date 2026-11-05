import { PopupMenu } from './popupMenu.js';

export class Button {
    constructor(...args) {
        this._init(...args);
    }

    _init(_menuAlignment) {
        this.menu = new PopupMenu();
        this.children = [];
        this.destroyed = false;
    }

    add_child(child) {
        this.children.push(child);
    }

    destroy() {
        this.destroyed = true;
    }
}
