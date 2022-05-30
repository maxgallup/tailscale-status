const {St, Clutter} = imports.gi;
const Main = imports.ui.main;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Me = imports.misc.extensionUtils.getCurrentExtension();

const statusString = "Status: ";
const enabledString = "🟢";
const disabledString = "❌";
const ownConnectionString = "💻";

class TailscaleNode {
    constructor(_name, _address, _online, _offersExit, _usesExit, _isSelf) {
        this.name = _name;
        this.address = _address;
        this.online = _online;
        this.offersExit = _offersExit;
        this.usesExit = _usesExit;
        this.isSelf = _isSelf;
    }

    get line() {
        var statusIcon;
        if (this.isSelf) {
            statusIcon = ownConnectionString;
        } else if (this.online) {
            statusIcon = enabledString;
        } else {
            statusIcon = disabledString;
        }
        return statusIcon + " " + this.address + " " + this.name;
    }
}

let nodes = [];

let nodesMenu;
let exitNodeMenu;
let statusItem;


function extractNodeInfo(json) {
    nodes = [];

    var me = json.Self;
    nodes.push(new TailscaleNode(
        me.HostName,
        me.TailscaleIPs[0],
        me.Online,
        me.ExitNodeOption,
        me.ExitNode,
        true
    ));
    
    for (let p in json.Peer) {
        var n = json.Peer[p];
        nodes.push(new TailscaleNode(
            n.HostName,
            n.TailscaleIPs[0],
            n.Online,
            n.ExitNodeOption,
            n.ExitNode,
            false
        ));
    }
    nodes.sort(sortNodes)
}

function sortNodes(a, b) {
    if (a.isSelf == true && b.isSelf == false) {
        return -1;
    }
    
    if (a.online == true && b.online == true) {
        return 0;
    } else if (a.online == true && b.online == false) {
        return -1;
    } else if (a.online == false && b.online == true) {
        return 1;
    } else if (a.online == false && b.online == false) {
        return 0;
    }
}

function setStatus(json) {
    switch (json.BackendState) {
        case "Running":
            statusItem.label.text = statusString + "up (no exit-node)";
            nodes.forEach( (node) => {
                if (node.usesExit) {
                statusItem.label.text = statusString + "up (exit-node: " + node.name + ")";
                }
            })
            break;
        case "Stopped":
            statusItem.label.text = statusString + "down";
            nodes = [];
            break;
        default:
            log("Error: unknown state");
    }
}

function refreshNodesMenu() {
    nodesMenu.removeAll();
    nodes.forEach( (node) => {
        let item = new PopupMenu.PopupMenuItem(node.line)
        item.connect('activate', () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, node.address);
        });
        nodesMenu.actor.add_child( item );
    });
}

function refreshExitNodesMenu() {
    exitNodeMenu.menu.removeAll();
    var uses_exit = false;
    nodes.forEach( (node) => {
        if (node.offersExit) {
        var item = new PopupMenu.PopupMenuItem(node.name)
        item.connect('activate', () => {
            cmdTailscaleUpWithExit(item.label.text);
        });
        if (node.usesExit) {
            item.setOrnament(1);
            exitNodeMenu.menu.addMenuItem(item);
            uses_exit = true;
        } else {
            item.setOrnament(0);
            exitNodeMenu.menu.addMenuItem(item);
        }
        }
    })
    
    var noneItem = new PopupMenu.PopupMenuItem('None');
    noneItem.connect('activate', () => {
        cmdTailscaleUpWithExit("");
    });
    (uses_exit) ? noneItem.setOrnament(0) : noneItem.setOrnament(1);
    exitNodeMenu.menu.addMenuItem(noneItem, 0);
}


function cmdTailscaleStatus() {
    try {
        let proc = Gio.Subprocess.new(
            ["tailscale", "status", "--json"],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (proc.get_successful()) {
                    const j = JSON.parse(stdout);
                    extractNodeInfo(j);
                    setStatus(j);
                    refreshExitNodesMenu();
                    refreshNodesMenu();
                }
            } catch (e) {
                logError(e);
            }
        });
    } catch (e) {
        logError(e);
    }
}

function cmdTailscaleUpWithExit(name) {
    try {
        let proc = Gio.Subprocess.new(
            ["pkexec", "tailscale", "up", "--exit-node=" + name],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (!proc.get_successful()) {
                    log("tailscale up failed")
                }
            } catch (e) {
                logError(e);
            }
        });
    } catch (e) {
        logError(e);
    }
}

function cmdTailscaleUp() {
    try {
        let proc = Gio.Subprocess.new(
            ["pkexec", "tailscale", "up"],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (!proc.get_successful()) {
                    log("tailscale up failed")
                }
            } catch (e) {
                logError(e);
            }
        });
    } catch (e) {
        logError(e);
    }
}

function cmdTailscaleDown() {
    try {
        let proc = Gio.Subprocess.new(
            ["pkexec", "tailscale", "down"],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (!proc.get_successful()) {
                    log("tailscale down failed")
                }
            } catch (e) {
                logError(e);
            }
        });
    } catch (e) {
        logError(e);
    }
}

const TailscalePopup = GObject.registerClass(
    class TailscalePopup extends PanelMenu.Button {
    
        _init () {

            super._init(0);

            let icon = new St.Icon({
                gicon : Gio.icon_new_for_string( Me.dir.get_path() + '/icon.svg' ),
                style_class : 'system-status-icon',
            });
            
            this.add_child(icon);

            statusItem = new PopupMenu.PopupMenuItem( statusString, {reactive : false} );
            let upItem = new PopupMenu.PopupMenuItem("Tailscale Up");
            let downItem = new PopupMenu.PopupMenuItem("Tailscale Down");
            nodesMenu = new PopupMenu.PopupMenuSection();
            exitNodeMenu = new PopupMenu.PopupSubMenuMenuItem("Exit Nodes");

            
            this.menu.addMenuItem(statusItem, 0);
            this.menu.addMenuItem( new PopupMenu.PopupSeparatorMenuItem(), 1);

            this.menu.addMenuItem(upItem, 2);
            upItem.connect('activate', () => {
                cmdTailscaleUp();
            });
            
            this.menu.addMenuItem(downItem, 3);
            downItem.connect('activate', () => {
                cmdTailscaleDown();
            });
            
            this.menu.connect('open-state-changed', (menu, open) => {
                if (open) {
                    cmdTailscaleStatus();
                }
            });
            
            this.menu.addMenuItem( new PopupMenu.PopupSeparatorMenuItem(), 4);
            this.menu.addMenuItem(nodesMenu, 5);
            this.menu.addMenuItem( new PopupMenu.PopupSeparatorMenuItem(), 6);
            this.menu.addMenuItem(exitNodeMenu, 7);

            nodes.forEach( (node) => {
                nodesMenu.actor.add_child( new PopupMenu.PopupMenuItem(node.line) );
            });
        }
    }
);

function init () {
}

function enable () {
    tailscale = new TailscalePopup();
    Main.panel.addToStatusArea('tailscale', tailscale, 1);
}

function disable () {
    nodesMenu.destroy();
    exitNodeMenu.destroy();
    statusItem.destroy();
    tailscale.destroy();
}

