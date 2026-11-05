class PreferencesPage {
    constructor() {
        this.groups = [];
    }

    add(group) {
        this.groups.push(group);
    }
}

class PreferencesGroup {
    constructor() {
        this.rows = [];
    }

    add(row) {
        this.rows.push(row);
    }
}

class ActionRow {
    constructor(params) {
        Object.assign(this, params);
        this.suffixes = [];
    }

    add_suffix(w) {
        this.suffixes.push(w);
    }
}

export default { PreferencesPage, PreferencesGroup, ActionRow };
