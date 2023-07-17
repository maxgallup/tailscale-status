const { St, Clutter } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Extension = imports.misc.extensionUtils.getCurrentExtension()
const Util = imports.misc.util

const { makeAsync, glibAsync, asyncTimeout, isCancelled } = Extension.imports.pipe

const Main = imports.ui.main;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Me = imports.misc.extensionUtils.getCurrentExtension();

const statusString = "Status: ";
const enabledString = "🟢";
const disabledString = "⚫";
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
let authItem;
let needsLogin = true;
let authUrl;

let health;

let shieldItem;
let acceptRoutesItem;
let allowLanItem;
let statusSwitchItem;
let downloads_path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD);
let icon;
let icon_down;
let icon_up;
let icon_exit_node;
let SETTINGS;

let timerId = null;

function extractNodeInfo(json) {
    nodes = [];

    var me = json.Self;
    if (me.TailscaleIPs != null) {
        nodes.push(new TailscaleNode(
            me.DNSName.split(".")[0],
            me.TailscaleIPs[0],
            me.Online,
            me.ExitNodeOption,
            me.ExitNode,
            true
        )
        );
    }
    for (let p in json.Peer) {
        var n = json.Peer[p];
        if (n.TailscaleIPs != null) {
            nodes.push(new TailscaleNode(
                n.DNSName.split(".")[0],
                n.TailscaleIPs[0],
                n.Online,
                n.ExitNodeOption,
                n.ExitNode,
                false
            ));
        }

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
function getUsername(json) {
    let id = 0
    if (json.Self.UserID != null) {
        id = json.Self.UserID
    }
    if (json.User != null) {
        for (const [key, value] of Object.entries(json.User)) {
            if (value.ID === id) {
                return value.LoginName
            }
        }
    }
    return json.Self.HostName
}
function setStatus(json) {
    needsLogin = false
    authItem.label.text = "Logged in: " + getUsername(json);
    authItem.sensitive = false;
    health = json.Health
    switch (json.BackendState) {
        case "Running":
            icon.gicon = icon_up;
            statusSwitchItem.setToggleState(true);
            statusItem.label.text = statusString + "up (no exit-node)";
            nodes.forEach((node) => {
                if (node.usesExit) {
                    statusItem.label.text = statusString + "up (exit-node: " + node.name + ")";
                    icon.gicon = icon_exit_node;
                }
            })
            setSwitches(true);
            break;
        case "Stopped":

            icon.gicon = icon_down;
            statusSwitchItem.setToggleState(false);
            statusItem.label.text = statusString + "down";
            nodes = [];
            setSwitches(false);
            break;
        case "NeedsLogin":
            log('needs login');
            needsLogin = true
            icon.gicon = icon_down;
            statusSwitchItem.setToggleState(false);
            authUrl = json.AuthURL;
            authItem.sensitive = true;
            if (authUrl.length > 0) {

                statusItem.label.text = statusString + "needs login";
                authItem.label.text = "Click to Login"

            } else {
                statusItem.label.text = statusString + "needs reconnect";
                authItem.label.text = "Click to Reconnect"
            }
            setSwitches(false);
            nodes = [];
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
    nodesMenu.menu.removeAll();
    nodes.forEach((node) => {
        let item = new PopupMenu.PopupMenuItem(node.line)
        item.connect('activate', () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, node.address);
            Main.notify("Copied " + node.address + " to clipboard! (" + node.name + ")");
        });
        nodesMenu.menu.addMenuItem(item);
    });
}

function refreshExitNodesMenu() {
    exitNodeMenu.menu.removeAll();
    var uses_exit = false;
    nodes.forEach((node) => {
        if (node.offersExit) {
            var item = new PopupMenu.PopupMenuItem(node.name)
            item.connect('activate', () => {
                cmdTailscale(["up", "--exit-node=" + node.address, "--reset"])
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
        cmdTailscale(["up", "--exit-node=", "--reset"]);
    });
    (uses_exit) ? noneItem.setOrnament(0) : noneItem.setOrnament(1);
    exitNodeMenu.menu.addMenuItem(noneItem, 0);
}

function refreshSendMenu() {
    sendMenu.menu.removeAll();
    nodes.forEach((node) => {
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




function cmdTailscaleStatus() {
    // let res = testScript(ctx, 'status', 'tailscale status --json').then(res => log(res))

    try {
        let proc = Gio.Subprocess.new(
            // ["curl", "--silent", "--unix-socket", "/run/tailscale/tailscaled.sock", "http://localhost/localapi/v0/status" ],
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

function cmdTailscale(args, addLoginServer = true) {

    // if (args[0] == "up") {
    //     args = args.concat(["--operator=$USER"]);
    // }

    // let command = ["tailscale"].concat(args).concat(["||", "pkexec", "tailscale"].concat(args));
    if (args[0] == "down") {
        args = ["pkexec", "tailscale"].concat(args)

    } else {
        args = ["pkexec", "tailscale"].concat(args)
        args = args.concat(["--reset"])
    }

    if (addLoginServer) {
        args = args.concat(["--login-server=" + SETTINGS.get_string('login-server')])
    }

    log("cmdTailscale:", args)
    executeShell(ctx, 'cmd', args).then(() => cmdTailscaleStatus()).catch(e => logError(e))

    // try {
    //     let proc = Gio.Subprocess.new(
    //         ["pkexec", "tailscale"].concat(args),
    //         Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    //     );
    //     log(proc.STDOUT_PIPE)
    //     proc.communicate_utf8_async(null, null, (proc, res) => {
    //         log(res)
    //         try {
    //             proc.communicate_utf8_finish(res);
    //             if (!proc.get_successful()) {
    //                 log(args);
    //                 log("failed @ cmdTailscale");
    //             } else {
    //                 cmdTailscaleStatus()
    //             }
    //         } catch (e) {
    //             logError(e);
    //         }
    //     });
    // } catch (e) {
    //     logError(e);
    // }
}

function cmdTailscaleRecFiles() {
    try {
        let proc = Gio.Subprocess.new(
            ["pkexec", "tailscale", "file", "get", downloads_path],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                proc.communicate_utf8_finish(res);
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

        _init() {
            super._init(0);


            icon_down = Gio.icon_new_for_string(Me.dir.get_path() + '/icon-down.svg');
            icon_up = Gio.icon_new_for_string(Me.dir.get_path() + '/icon-up.svg');
            icon_exit_node = Gio.icon_new_for_string(Me.dir.get_path() + '/icon-exit-node.svg');

            icon = new St.Icon({
                gicon: icon_down,
                style_class: 'system-status-icon',
            });

            this.add_child(icon);

            this.menu.connect('open-state-changed', (menu, open) => {
                if (open) {
                    cmdTailscaleStatus();
                }
            });

            statusItem = new PopupMenu.PopupMenuItem(statusString, { reactive: false });
            this.menu.addMenuItem(statusItem, 0);


            authItem = new PopupMenu.PopupMenuItem("Logged in", false);
            authItem.connect('activate', () => {
                if (authUrl.length > 0) {

                    Util.spawn(['xdg-open', authUrl])
                    log("open auth url", authUrl)
                } else {
                    // sometimes "NeedsLogin" but authURL is empty
                    try {
                        cmdTailscale(["down"], false);
                    } catch (e) {
                        logError(e);
                    }


                }


            });

            this.menu.addMenuItem(authItem, 1);


            statusSwitchItem = new PopupMenu.PopupSwitchMenuItem("Tailscale", false);
            this.menu.addMenuItem(statusSwitchItem, 2);
            statusSwitchItem.connect('activate', () => {
                if (statusSwitchItem.state) {
                    cmdTailscale(["up"]);
                } else {
                    cmdTailscale(["down"], false);
                }
            })

            // ------ SEPARATOR ------
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // ------ NODES ------
            nodesMenu = new PopupMenu.PopupSubMenuMenuItem("Nodes");
            nodes.forEach((node) => {
                nodesMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(node.line));
            });
            this.menu.addMenuItem(nodesMenu);

            // ------ SEPARATOR ------
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // ------ SHIELD ------
            shieldItem = new PopupMenu.PopupSwitchMenuItem("Block Incoming", false);
            this.menu.addMenuItem(shieldItem);
            shieldItem.connect('activate', () => {
                if (shieldItem.state) {
                    cmdTailscale(["up", "--shields-up"]);
                } else {
                    cmdTailscale(["up", "--shields-up=false", "--reset"]);
                }
            })

            // ------ ACCEPT ROUTES ------
            acceptRoutesItem = new PopupMenu.PopupSwitchMenuItem("Accept Routes", false);
            this.menu.addMenuItem(acceptRoutesItem);
            acceptRoutesItem.connect('activate', () => {
                if (acceptRoutesItem.state) {
                    cmdTailscale(["up", "--accept-routes"]);
                } else {
                    cmdTailscale(["up", "--accept-routes=false", "--reset"]);
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
                    cmdTailscale(["up", "--exit-node-allow-lan-access=false", "--reset"]);
                }
            })

            // ------ SEPARATOR ------
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

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
            let healthMenu = new PopupMenu.PopupMenuItem("Health")
            healthMenu.connect('activate', () => {
                if (health != null) {
                    Main.notify(health.join());

                } else {
                    Main.notify("null");
                }
            })

            let infoMenu = new PopupMenu.PopupMenuItem("This extension is in no way affiliated with Tailscale Inc.")
            let gitMenu = new PopupMenu.PopupMenuItem("Github")
            gitMenu.connect('activate', () => {
                Util.spawn(['xdg-open', "https://github.com/maxgallup/tailscale-status"])
            })
            
            let serverMenu = new PopupMenu.PopupMenuItem("Server")
            serverMenu.connect('activate', () => {
                Main.notify(SETTINGS.get_string('login-server'));

            })
            
            aboutMenu.menu.addMenuItem(infoMenu);
            // aboutMenu.menu.addMenuItem(healthMenu);
            aboutMenu.menu.addMenuItem(gitMenu);
            aboutMenu.menu.addMenuItem(serverMenu);

        }
    }
);

function init() {
}

function enable() {

    SETTINGS = ExtensionUtils.getSettings(
        'org.gnome.shell.extensions.tailscale-status');
    cmdTailscaleStatus()
    // Timer that updates Status icon and drop down menu
    timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SETTINGS.get_int('refresh-interval'), () => {
        cmdTailscaleStatus();
        return GLib.SOURCE_CONTINUE;
    });

    tailscale = new TailscalePopup();
    Main.panel.addToStatusArea('tailscale', tailscale, 1);
}

function disable() {
    tailscale.destroy();
    tailscale = null;
    icon = null;
    icon_down = null;
    icon_up = null;
    icon_exit_node = null;

    if (timerId) {
        GLib.Source.remove(timerId);
        timerId = null;
    }


}
let ctx = new Gio.Cancellable()
let errors = []
let show_output = true

let launcher = new Gio.SubprocessLauncher({
    flags: (
        Gio.SubprocessFlags.STDOUT_PIPE |
        Gio.SubprocessFlags.STDERR_PIPE
    )
})

function Stream(proc) {
    return new Gio.DataInputStream({
        base_stream: proc.get_stdout_pipe(),
        close_base_stream: true
    })
}
async function executeShell(ctx, name, args, timeout_ms = 10000) {
    //let proc = launcher.spawnv(["pkexec"].concat(args))
    let proc = launcher.spawnv(args)
    let stdout = Stream(proc)

    let i = 0
    let terminated = false
    let cancel_requested = false
    let read_error = null
    let proc_error = null
    let finish_ok = null
    let read_ctx = new Gio.Cancellable()

    /** check process status and return if pipe was successful or not */
    async function finish() {
        let ok = false
        try {
            ok = await glibAsync(
                (finish) => proc.wait_check_async(null, finish),
                (_, res) => proc.wait_check_finish(res),
            )
        } catch (err) {
            proc_error = err
        }
        if (read_error) logError(read_error)
        if (cancel_requested) {
            // ignore exit codes when process was killed by user
            ok = read_error ? false : true
        } else {
            if (proc_error) logError(proc_error)
            ok = !ok || read_error || proc_error ? false : true
        }
        return ok
    }

    function cancel() {
        // no manual cancellation need, pipe is already stopping
        if (terminated) return
        log(`${name} cancel requested`)
        cancel_requested = true
        read_ctx.cancel()
        proc.force_exit()
    }

    /** allow early termination of the pipe */
    if (ctx) ctx.connect(cancel)

    const cancelLater = asyncTimeout(cancel, timeout_ms)

    try {
        log(` ${name} started`)

        while (true) {
            try {
                let line = await glibAsync(
                    (finish) => stdout.read_line_async(GLib.PRIORITY_LOW, read_ctx, finish),
                    (_, res) => stdout.read_line_finish_utf8(res)[0],
                )
                if (line == null) break
                if (show_output) print('read', name, 'line:', i++, line)
            } catch (e) {
                if (!isCancelled(e)) read_error = e
                break
            }
        }
        terminated = true
        finish_ok = await finish()
    } catch (e) {
        logError(e)
        cancel()
    }

    await cancelLater
    return { cancel_requested, terminated, finish_ok }
}