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
let sendMenu;
let statusItem;
let shieldItem;
let acceptRoutesItem;
let allowLanItem;
let statusSwitchItem;
let downloads_path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD);

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
            statusSwitchItem.setToggleState(true);
            statusItem.label.text = statusString + "up (no exit-node)";
            nodes.forEach( (node) => {
                if (node.usesExit) {
                statusItem.label.text = statusString + "up (exit-node: " + node.name + ")";
                }
            })
            setSwitches(true);
            break;
        case "Stopped":
            statusSwitchItem.setToggleState(false);
            statusItem.label.text = statusString + "down";
            nodes = [];
            setSwitches(false);
            break;
        default:
            log("Error: unknown state");
    }
}

function setSwitches(b) {
    shieldItem.actor._activatable = b;
    acceptRoutesItem.actor._activatable = b;
    allowLanItem.actor._activatable = b;
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
            // cmdTailscaleUp("--exit-node=" + item.label.text);
            cmdTailscale(["up", "--exit-node="+item.label.text])
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
        // cmdTailscaleUp("--exit-node=");
        cmdTailscale("up", "--exit-node=")
    });
    (uses_exit) ? noneItem.setOrnament(0) : noneItem.setOrnament(1);
    exitNodeMenu.menu.addMenuItem(noneItem, 0);
}

function refreshSendMenu() {
    sendMenu.menu.removeAll();
    nodes.forEach( (node) => {
        if (node.online && !node.isSelf) {
            var item = new PopupMenu.PopupMenuItem(node.name)
            item.connect('activate', () => {
                sendFiles(node.address);
            });
            sendMenu.menu.addMenuItem(item);
        }
    })
}

function sendFiles(dest) {
    try {
        let proc = Gio.Subprocess.new(
            ["zenity", "--file-selection", "--multiple"],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (proc.get_successful()) {
                    if (stdout != '') {
                        files = stdout.trim().split("|")
                        cmdTailscaleFile(files, dest)
                    }
                } else {
                    logError("zenity failed");
                }
            } catch (e) {
                logError(e);
            }
        });
    } catch (e) {
        logError(e);
    }
}

function cmdTailscaleFile(files, dest) { 
    args = ["pkexec", "tailscale", "file", "cp"]
    args = args.concat(files)
    args.push(dest + ":")
    try {
        let proc = Gio.Subprocess.new(
            args,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (proc.get_successful()) {
                    Main.notify('Tailscale Files sent to ' + dest);
                } else {
                    log("Unable to send files via Tailscale")
                    Main.notify('Unable to send files via Tailscale', 'check logs with journalctl -f -o cat /usr/bin/gnome-shell');
                }
            } catch (e) {
                logError(e);
            }
        });
    } catch (e) {
        logError(e);
    }
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
                    refreshSendMenu();
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

function cmdTailscale(args) {
    try {
        let proc = Gio.Subprocess.new(
            ["pkexec", "tailscale"].concat(args),
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (!proc.get_successful()) {
                    log("tailscale " + args[1] + " failed");
                }
            } catch (e) {
                logError(e);
            }
        });
    } catch (e) {
        logError(e);
    }
}


function cmdTailscaleRecFiles() {
    try {
        let proc = Gio.Subprocess.new(
            ["pkexec", "tailscale", "file", "get", downloads_path],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (proc.get_successful()) {
                    Main.notify('Saved files to ' + downloads_path);
                } else {
                    Main.notify('Unable to receive files to ' + downloads_path, 'check logs with journalctl -f -o cat /usr/bin/gnome-shell');
                    log("failed to accept files to " + downloads_path)
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

            this.menu.connect('open-state-changed', (menu, open) => {
                if (open) {
                    cmdTailscaleStatus();
                }
            });

            statusItem = new PopupMenu.PopupMenuItem( statusString, {reactive : false} );
            this.menu.addMenuItem(statusItem, 0);


            statusSwitchItem = new PopupMenu.PopupSwitchMenuItem("Tailscale", false);
            this.menu.addMenuItem(statusSwitchItem,1);
            statusSwitchItem.connect('activate', () => {
                if (statusSwitchItem.state) {
                    cmdTailscale(["up"]);
                } else {
                    cmdTailscale(["down"]);
                }
            })

            // ------ SEPARATOR ------
            this.menu.addMenuItem( new PopupMenu.PopupSeparatorMenuItem());
            
            // ------ NODES ------
            nodesMenu = new PopupMenu.PopupMenuSection();
            nodes.forEach( (node) => {
                nodesMenu.actor.add_child( new PopupMenu.PopupMenuItem(node.line) );
            });
            this.menu.addMenuItem(nodesMenu);

            // ------ SEPARATOR ------
            this.menu.addMenuItem( new PopupMenu.PopupSeparatorMenuItem());

            // ------ SHIELD ------
            shieldItem = new PopupMenu.PopupSwitchMenuItem("Block Incoming", false);
            this.menu.addMenuItem(shieldItem);
            shieldItem.connect('activate', () => {
                if (shieldItem.state) {
                    cmdTailscale(["up", "--shields-up"]);
                } else {
                    cmdTailscale(["up", "--shields-up=false"]);
                }
            })

            // ------ ACCEPT ROUTES ------
            acceptRoutesItem = new PopupMenu.PopupSwitchMenuItem("Accept Routes", false);
            this.menu.addMenuItem(acceptRoutesItem);
            acceptRoutesItem.connect('activate', () => {
                if (acceptRoutesItem.state) {
                    cmdTailscale(["up", "--accept-routes"]);
                } else {
                    cmdTailscale(["up", "--accept-routes=false"]);
                }
            })

            // ------ ALLOW DIRECT LAN ACCESS ------
            allowLanItem = new PopupMenu.PopupSwitchMenuItem("Allow Direct Lan Access", false);
            this.menu.addMenuItem(allowLanItem);
            allowLanItem.connect('activate', () => {
                if (allowLanItem.state) {
                    if (nodes[0].usesExit) {
                        cmdTailscale(["up", "--exit-node-allow-lan-access"]);
                    } else {
                        Main.notify("Must setup exit node first");
                        allowLanItem.setToggleState(false);
                    }
                } else {
                    cmdTailscale(["up", "--exit-node-allow-lan-access=false"]);
                }
            })

            // ------ SEPARATOR ------
            this.menu.addMenuItem( new PopupMenu.PopupSeparatorMenuItem());

            // ------ RECEIVE FILES MENU ------
            let receiveFilesItem = new PopupMenu.PopupMenuItem("Accept incoming files");
            receiveFilesItem.connect('activate', () => {
                cmdTailscaleRecFiles();
            })
            this.menu.addMenuItem(receiveFilesItem);

            // ------ SEND FILES MENU ------
            sendMenu = new PopupMenu.PopupSubMenuMenuItem("Send Files");
            this.menu.addMenuItem(sendMenu);

            // ------ EXIT NODES -------
            exitNodeMenu = new PopupMenu.PopupSubMenuMenuItem("Exit Nodes");
            this.menu.addMenuItem(exitNodeMenu);

            // ------ ABOUT ------
            let aboutMenu = new PopupMenu.PopupSubMenuMenuItem("About");
            this.menu.addMenuItem(aboutMenu);
            aboutMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem("The Tailscale Status extension is in no way affiliated with Tailscale Inc."));
            aboutMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem("Open an issue or pull request at github.com/maxgallup/tailscale-status"));

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
    tailscale.destroy();
    tailscale = null;
}
