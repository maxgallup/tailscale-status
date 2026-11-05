import { Signals } from '../harness.js';

export const Ornament = { NONE: 0, DOT: 1, CHECK: 2 };

class ScrollActor {
    constructor() {
        this.pseudoClasses = new Set();
        this.mouseScrolling = true;
    }

    set_mouse_scrolling(v) {
        this.mouseScrolling = v;
    }

    add_style_pseudo_class(c) {
        this.pseudoClasses.add(c);
    }

    remove_style_pseudo_class(c) {
        this.pseudoClasses.delete(c);
    }
}

export class PopupMenuBase extends Signals {
    constructor() {
        super();
        this.items = [];
        this.actor = new ScrollActor();
    }

    addMenuItem(item, position) {
        if (position === undefined)
            this.items.push(item);
        else
            this.items.splice(position, 0, item);
    }

    removeAll() {
        this.items = [];
    }

    _needsScrollbar() {
        return false;
    }

    _setOpenedSubMenu(_menu) {}
}

export class PopupMenu extends PopupMenuBase {}
export class PopupSubMenu extends PopupMenuBase {}

export class PopupBaseMenuItem extends Signals {
    constructor(...args) {
        super();
        this._init(...args);
    }

    _init(_params) {
        this.sensitive = true;
        this.ornament = Ornament.NONE;
    }

    setOrnament(o) {
        this.ornament = o;
    }

    activate() {
        this.emit('activate');
    }
}

export class PopupMenuItem extends PopupBaseMenuItem {
    _init(text, params) {
        super._init(params);
        this.label = { text };
    }
}

export class PopupSwitchMenuItem extends PopupBaseMenuItem {
    _init(text, active = false, params) {
        super._init(params);
        this.label = { text };
        this.state = active;
    }

    setToggleState(state) {
        this.state = state;
    }

    // like gnome-shell, the switch flips before 'activate' fires
    activate() {
        this.state = !this.state;
        this.emit('toggled', this.state);
        super.activate();
    }
}

export class PopupSubMenuMenuItem extends PopupBaseMenuItem {
    _init(text, _wantIcon) {
        super._init();
        this.label = { text };
        this.menu = new PopupSubMenu();
    }

    _subMenuOpenStateChanged(_menu, _open) {}
}

export class PopupSeparatorMenuItem extends PopupBaseMenuItem {}
