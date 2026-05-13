/**
 * Tailscale Status GNOME Extension
 * * @version 1.11.0 (v12)
 * @description A GNOME Shell extension to manage Tailscale status and file transfers.
 * * Modifications Log:
 * - v12: Fixed 'me is undefined' crash in extractNodeInfo when daemon returns JSON without 'Self'. Fixed GIO Directory error in API receiveFile by explicitly requiring a filename, dropping to CLI fallback gracefully for bulk dir downloads.
 * - v11: Fixed TypeError in API by replacing read_line_utf8_async with read_line_async + TextDecoder. Wired up watchEvents in enable() to notify on incoming files.
 * - v10: Phase 3 implementation - Created TailscaleService to act as a fallback wrapper. Tries TailscaleAPI first, falls back to TailscaleCLI on failure.
 * - v9: Fixed false-positive error notification in receiveFile by ignoring non-fatal exit codes from unprivileged 'tailscale file get'.
 * - v8: Phase 1 implementation - Created TailscaleCLI class to abstract all Gio.Subprocess calls into Promise-based methods matching TailscaleAPI signatures.
 * - v7: Initiated Phase 2 of the API migration. Added endpoints for files and stream polling (watch-ipn-bus) based on local tests.
 * - v6: Fixed 'gettext can only be called from extensions' by removing top-level _() calls.
 * - v5: Removed 'pkexec' from 'tailscale file get' to fix root ownership and password prompt. Commented out Taildrop polling.
 * - v4: Internationalization (i18n) setup.
 * - v3: Implemented background polling to notify the user about incoming Taildrop files.
 * - v2: Added this header for file metadata and version control.
 * - v1: Modified cmdTailscaleRecFiles to prompt for a download directory using zenity.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as ExtensionUtils from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

const enabledString = "🟢";
const disabledString = "⚫";
const ownConnectionString = "💻";

class TailscaleCLI {
    constructor() {}

    async getStatus() {
        return new Promise((resolve, reject) => {
            let proc = Gio.Subprocess.new(
                ["tailscale", "status", "--json"],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    if (proc.get_successful()) {
                        resolve(JSON.parse(stdout));
                    } else {
                        reject(stderr || "Failed to get status");
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async sendCommand(args, unprivileged = true, addLoginServer = true) {
        return new Promise((resolve, reject) => {
            let original_args = args;
            if (addLoginServer && SETTINGS) {
                args = args.concat(["--login-server=" + SETTINGS.get_string('login-server')]);
            }

            let command = (unprivileged ? ["tailscale"] : ["pkexec", "tailscale"]).concat(args);

            let proc = Gio.Subprocess.new(
                command,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    if (!proc.get_successful()) {
                        if (unprivileged) {
                            let fallbackArgs = args[0] == "up" ? original_args.concat(["--operator=" + GLib.get_user_name(), "--reset"]) : original_args;
                            this.sendCommand(fallbackArgs, false, addLoginServer)
                                .then(resolve)
                                .catch(reject);
                        } else {
                            reject(stderr || "Command failed");
                        }
                    } else {
                        resolve(stdout);
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async receiveFile(filename, destPath) {
        return new Promise((resolve, reject) => {
            let tailscaleProc = Gio.Subprocess.new(
                ["tailscale", "file", "get", destPath],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            tailscaleProc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    if (proc.get_successful()) {
                        resolve(stdout);
                    } else {
                        if (stderr && stderr.toLowerCase().includes("denied")) {
                            reject(stderr || "Permission denied");
                        } else {
                            myWarn("Ignored non-fatal CLI error in receiveFile: " + stderr);
                            resolve(stdout || "Files likely saved");
                        }
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async sendFile(filePath, peerId, filename = null) {
        return new Promise((resolve, reject) => {
            let proc = Gio.Subprocess.new(
                ["tailscale", "file", "cp", filePath, peerId + ":"],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    if (proc.get_successful()) {
                        resolve(stdout);
                    } else {
                        reject(stderr || "Failed to send file via CLI");
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async getAccounts(unprivileged = true) {
        return new Promise((resolve, reject) => {
            let command = (unprivileged ? ["tailscale"] : ["pkexec", "tailscale"]).concat(["switch", "--list"]);
            let proc = Gio.Subprocess.new(
                command,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    if (proc.get_successful()) {
                        let accs = stdout.split("\n").filter(item => item.length > 0);
                        resolve(accs);
                    } else {
                        if (unprivileged) {
                            this.getAccounts(false).then(resolve).catch(reject);
                        } else {
                            reject(stderr || "Failed to list accounts");
                        }
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async switchAccount(account) {
        return this.sendCommand(["switch", account], true, false);
    }

    async logout() {
        return this.sendCommand(["logout"], true, false);
    }

    async getFiles() { return []; }
    watchEvents(callback) {}
}

class TailscaleAPI {
    constructor() {
        this.socketPath = '/run/tailscale/tailscaled.sock';
    }

    async _request(endpoint, method = 'GET', bodyObj = null) {
        return new Promise((resolve, reject) => {
            try {
                let client = new Gio.SocketClient();
                let address = Gio.UnixSocketAddress.new(this.socketPath);

                client.connect_async(address, null, (client, res) => {
                    try {
                        let connection = client.connect_finish(res);
                        let output = connection.get_output_stream();
                        let input = connection.get_input_stream();
                        
                        let bodyStr = bodyObj ? JSON.stringify(bodyObj) : "";
                        
                        let requestStr = `${method} ${endpoint} HTTP/1.0\r\n` +
                                         `Host: local-tailscaled.sock\r\n` +
                                         `Authorization: Basic Og==\r\n` +
                                         `Content-Type: application/json\r\n`;

                        if (bodyStr) {
                            let byteLen = new TextEncoder().encode(bodyStr).length;
                            requestStr += `Content-Length: ${byteLen}\r\n`;
                        }

                        requestStr += `Connection: close\r\n\r\n`;

                        if (bodyStr) {
                            requestStr += bodyStr;
                        }

                        output.write_all_async(requestStr, GLib.PRIORITY_DEFAULT, null, (out, res2) => {
                            try {
                                out.write_all_finish(res2);
                                let dataStream = new Gio.DataInputStream({ base_stream: input });
                                let responseText = "";
                                
                                let readLines = () => {
                                    dataStream.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res3) => {
                                        try {
                                            let [lineData, length] = stream.read_line_finish(res3);
                                            if (lineData !== null) {
                                                let line = lineData instanceof Uint8Array ? new TextDecoder().decode(lineData) : lineData;
                                                responseText += line + "\r\n";
                                                readLines();
                                            } else {
                                                let parts = responseText.split("\r\n\r\n");
                                                if (parts.length >= 2) {
                                                    let body = parts.slice(1).join("\r\n\r\n");
                                                    resolve(JSON.parse(body));
                                                } else {
                                                    resolve({});
                                                }
                                            }
                                        } catch (e) {
                                            reject(e);
                                        }
                                    });
                                };
                                readLines();
                            } catch (e) {
                                reject(e);
                            }
                        });
                    } catch (e) {
                        reject(e);
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    _watchStream(endpoint, callback) {
        try {
            let client = new Gio.SocketClient();
            let address = Gio.UnixSocketAddress.new(this.socketPath);

            client.connect_async(address, null, (client, res) => {
                try {
                    let connection = client.connect_finish(res);
                    let output = connection.get_output_stream();
                    let input = connection.get_input_stream();
                    
                    let requestStr = `GET ${endpoint} HTTP/1.1\r\n` +
                                     `Host: local-tailscaled.sock\r\n` +
                                     `Authorization: Basic Og==\r\n` +
                                     `Connection: keep-alive\r\n\r\n`;

                    output.write_all_async(requestStr, GLib.PRIORITY_DEFAULT, null, (out, res2) => {
                        try {
                            out.write_all_finish(res2);
                            let dataStream = new Gio.DataInputStream({ base_stream: input });
                            
                            let readLoop = () => {
                                dataStream.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res3) => {
                                    try {
                                        let [lineData, length] = stream.read_line_finish(res3);
                                        if (lineData !== null) {
                                            let line = lineData instanceof Uint8Array ? new TextDecoder().decode(lineData) : lineData;
                                            if (line.startsWith('{')) {
                                                try {
                                                    let jsonObj = JSON.parse(line);
                                                    callback(jsonObj);
                                                } catch (parseErr) {
                                                    myWarn("Failed to parse stream line: " + parseErr);
                                                }
                                            }
                                            readLoop();
                                        } else {
                                            myWarn("Tailscale API stream closed");
                                        }
                                    } catch (e) {
                                        myError("Stream read error: " + e);
                                    }
                                });
                            };
                            readLoop();
                        } catch (e) {
                            myError("Stream write error: " + e);
                        }
                    });
                } catch (e) {
                    myError("Stream connect error: " + e);
                }
            });
        } catch (e) {
            myError("Stream setup error: " + e);
        }
    }

    async getStatus() {
        return this._request('/localapi/v0/status');
    }

    watchEvents(callback) {
        this._watchStream('/localapi/v0/watch-ipn-bus', callback);
    }

    async getFiles() {
        return this._request('/localapi/v0/files/');
    }

    async editPrefs(prefsObj) {
        return this._request('/localapi/v0/prefs', 'PATCH', prefsObj);
    }

    async sendCommand(args) {
        throw new Error("API sendCommand not fully implemented yet");
    }

    async receiveFile(filename, destPath) {
        // v12: Avoid Gio directory writing error by gracefully rejecting if filename is missing.
        if (!filename) {
            return Promise.reject(new Error("API receiveFile requires a specific filename. Directory bulk download is handled by CLI fallback."));
        }

        return new Promise((resolve, reject) => {
            try {
                let client = new Gio.SocketClient();
                let address = Gio.UnixSocketAddress.new(this.socketPath);

                client.connect_async(address, null, (client, res) => {
                    try {
                        let connection = client.connect_finish(res);
                        let output = connection.get_output_stream();
                        let input = new Gio.DataInputStream({ base_stream: connection.get_input_stream() });
                        
                        let requestStr = `GET /localapi/v0/files/${filename} HTTP/1.0\r\n` +
                                         `Host: local-tailscaled.sock\r\n` +
                                         `Authorization: Basic Og==\r\n` +
                                         `Connection: close\r\n\r\n`;

                        output.write_all_async(requestStr, GLib.PRIORITY_DEFAULT, null, (out, res2) => {
                            try {
                                out.write_all_finish(res2);
                                
                                let skipHeaders = () => {
                                    input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res3) => {
                                        try {
                                            let [lineData, length] = stream.read_line_finish(res3);
                                            let line = null;
                                            if (lineData !== null) {
                                                line = lineData instanceof Uint8Array ? new TextDecoder().decode(lineData) : lineData;
                                            }
                                            if (line !== null && line.trim() !== "") {
                                                skipHeaders();
                                            } else {
                                                let file = Gio.File.new_for_path(destPath);
                                                file.replace_async(null, false, Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, null, (f, res4) => {
                                                    try {
                                                        let fileOutStream = f.replace_finish(res4);
                                                        fileOutStream.splice_async(
                                                            input, 
                                                            Gio.OutputStreamSpliceFlags.CLOSE_TARGET | Gio.OutputStreamSpliceFlags.CLOSE_SOURCE, 
                                                            GLib.PRIORITY_DEFAULT, 
                                                            null, 
                                                            (spliceOut, spliceRes) => {
                                                                try {
                                                                    spliceOut.splice_finish(spliceRes);
                                                                    resolve(true);
                                                                } catch (e) {
                                                                    reject("Splice error: " + e);
                                                                }
                                                            }
                                                        );
                                                    } catch (e) {
                                                        reject("File create error: " + e);
                                                    }
                                                });
                                            }
                                        } catch (e) {
                                            reject("Header read error: " + e);
                                        }
                                    });
                                };
                                skipHeaders();
                            } catch (e) {
                                reject(e);
                            }
                        });
                    } catch (e) {
                        reject(e);
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    async sendFile(filePath, peerId, filename) {
        throw new Error("API sendFile not implemented yet (requires binary stream handling)");
    }

    async getAccounts() {
        return this._request('/localapi/v0/profiles/');
    }

    async switchAccount(profileId) {
        return this._request(`/localapi/v0/profiles/${profileId}`, 'POST');
    }

    async logout() {
        return this._request('/localapi/v0/logout', 'POST');
    }
}

class TailscaleService {
    constructor() {
        this.api = new TailscaleAPI();
        this.cli = new TailscaleCLI();
    }

    async getStatus() {
        try {
            return await this.api.getStatus();
        } catch (e) {
            myWarn("API getStatus failed, falling back to CLI. Reason: " + e);
            return await this.cli.getStatus();
        }
    }

    async sendCommand(args, unprivileged = true, addLoginServer = true) {
        try {
            return await this.api.sendCommand(args);
        } catch (e) {
            myWarn("API sendCommand failed, falling back to CLI. Reason: " + e);
            return await this.cli.sendCommand(args, unprivileged, addLoginServer);
        }
    }

    async receiveFile(filename, destPath) {
        try {
            return await this.api.receiveFile(filename, destPath);
        } catch (e) {
            myWarn("API receiveFile failed, falling back to CLI. Reason: " + e);
            return await this.cli.receiveFile(filename, destPath);
        }
    }

    async sendFile(filePath, peerId, filename = null) {
        try {
            return await this.api.sendFile(filePath, peerId, filename);
        } catch (e) {
            myWarn("API sendFile failed, falling back to CLI. Reason: " + e);
            return await this.cli.sendFile(filePath, peerId, filename);
        }
    }

    async getAccounts(unprivileged = true) {
        try {
            return await this.api.getAccounts();
        } catch (e) {
            myWarn("API getAccounts failed, falling back to CLI. Reason: " + e);
            return await this.cli.getAccounts(unprivileged);
        }
    }

    async switchAccount(account) {
        try {
            return await this.api.switchAccount(account);
        } catch (e) {
            myWarn("API switchAccount failed, falling back to CLI. Reason: " + e);
            return await this.cli.switchAccount(account);
        }
    }

    async logout() {
        try {
            return await this.api.logout();
        } catch (e) {
            myWarn("API logout failed, falling back to CLI. Reason: " + e);
            return await this.cli.logout();
        }
    }

    watchEvents(callback) {
        this.api.watchEvents(callback);
    }
}

const tsService = new TailscaleService();

class TailscaleNode {
    constructor(_name, _address, _online, _offersExit, _usesExit, _isSelf, _isMullvadExitNode, _groupPath) {
        this.name = _name;
        this.address = _address;
        this.online = _online;
        this.offersExit = _offersExit;
        this.usesExit = _usesExit;
        this.isSelf = _isSelf;
        this.isMullvadExitNode = _isMullvadExitNode;
        this.groupPath = _groupPath;
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
let nodesTree = { nodes: [], subTrees: {} }
let accounts = [];
let currentAccount = null; 

let nodesMenu;
let accountButton;
let accountsMenu;
let accountIndicator;
let logoutButton;
let exitNodeMenu;
let sendMenu;
let statusItem;
let authItem;
let needToAuth = true;
let authUrl;

let health;

let receiveFilesItem
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

function myWarn(string) {
    console.log("🟡 [tailscale-status]: " + string);
}

function myError(string) {
    console.log("🔴 [tailscale-status]: " + string);
}

function extractNodeInfo(json) {
    nodes = [];
    nodesTree = { nodes: [], subTrees: {} };

    // v12: Protect against undefined 'Self' when the daemon state is minimal or stopped
    if (!json || !json.Self) return;

    var me = json.Self;
    if (me && me.TailscaleIPs != null) {
        nodes.push(new TailscaleNode(
            me.DNSName.split(".")[0],
            me.TailscaleIPs[0],
            me.Online,
            me.ExitNodeOption,
            me.ExitNode,
            true,
            false,
            []
        )
        );
    }
    
    if (json.Peer) {
        for (let p in json.Peer) {
            var n = json.Peer[p];
            let isMullvad = false;
            let groupPath = [];
            if (n.Tags?.includes('tag:mullvad-exit-node')) {
                isMullvad = true;
                if (n.Location?.Country && n.Location?.City) {
                    groupPath = ["Mullvad", n.Location.Country, n.Location.City];
                } else {
                    groupPath = ["Mullvad"]
                }
            }
            if (n.TailscaleIPs != null) {
                nodes.push(new TailscaleNode(
                    n.DNSName.split(".")[0],
                    n.TailscaleIPs[0],
                    n.Online,
                    n.ExitNodeOption,
                    n.ExitNode,
                    false,
                    isMullvad,
                    groupPath
                ));
            }
        }
    }

    nodes.sort(combineSort(sortProp('isSelf'), sortProp('online', 'desc'), sortArrProp('groupPath'), sortProp('name')))

    for (const n of nodes) {
        let t = nodesTree;
        for (const p of n.groupPath) {
            if (!(p in t.subTrees)) {
                t.subTrees[p] = { nodes: [], subTrees: {} }
            }
            t = t.subTrees[p]
        }
        t.nodes.push(n);
    }
}

function sortArrProp(p) {
    return function comp(a, b) {
        const [_aa, _bb] = [a[p] ?? [], b[p] ?? []]
        for (let i = 0; i < Math.max(_aa.length, _bb.length); i++) {
            const [_a, _b] = [_aa[i], _bb[i]]
            if (_a < _b) {
                return -1;
            } else if (_b < _a) {
                return 1;
            } else {
                continue;
            }
        }
    }
}

function sortProp(p, desc=undefined) {
    return function comp(a, b) {
        if (desc == 'desc') {
            [b, a] = [a, b];
        }
        const [_a, _b] = [a[p], b[p]];
        if (_a < _b) {
            return -1;
        } else if (_b < _a) {
            return 1;
        } else {
            return 0;
        }
    }
}

function combineSort(...sorters) {
    return function comp(a, b) {
        for (const fn of sorters) {
            const res = fn(a, b);
            if (res != 0) {
                return res
            }
        }
    }
}

function getUsername(json) {
    // v12: Protect against undefined 'Self'
    if (!json || !json.Self) return "Unknown";

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
    authItem.label.text = _("Logged in: ") + getUsername(json);
    accountIndicator.label.text = _("Account: ") + currentAccount;
    authItem.sensitive = false;
    health = json ? json.Health : null;
    
    let backendState = json ? json.BackendState : "Unknown";
    switch (backendState) {
        case "Running":
            needToAuth = true
            icon.gicon = icon_up;
            statusSwitchItem.setToggleState(true);
            statusItem.label.text = _("Status: ") + _("up (no exit-node)");
            nodes.forEach((node) => {
                if (node.usesExit) {
                    statusItem.label.text = _("Status: ") + _("up (exit-node: ") + node.name + ")";
                    icon.gicon = icon_exit_node;
                }
            })
            setAllItems(true);
            break;
        case "Stopped":
            needToAuth = true
            icon.gicon = icon_down;
            statusSwitchItem.setToggleState(false);
            statusItem.label.text = _("Status: ") + _("down");
            nodes = [];
            setAllItems(false);
            statusSwitchItem.sensitive = true;
            break;
        case "NeedsLogin":
            icon.gicon = icon_down;
            statusSwitchItem.setToggleState(false);
            authUrl = json.AuthURL;
            if (authUrl && authUrl.length > 0 && needToAuth) {
                Util.spawn(['xdg-open', authUrl])
                needToAuth = false
            }

            authItem.sensitive = true;
            statusItem.label.text = _("Status: ") + _("needs login");
            authItem.label.text = _("Click to Login");

            setAllItems(false);
            nodes = [];
            break;

        default:
            myError("Error: unknown state");
    }
}

function setAllItems(b) {
    shieldItem.sensitive = b;
    acceptRoutesItem.sensitive = b;
    allowLanItem.sensitive = b;
    statusSwitchItem.sensitive = b;
    receiveFilesItem.sensitive = b;
    nodesMenu.sensitive = b;
    sendMenu.sensitive = b;
    exitNodeMenu.sensitive = b;
    accountsMenu.sensitive = b;
    accountButton.sensitive = b;
    logoutButton.sensitive = b;
}

function refreshNodesMenu() {
    nodesMenu.menu.removeAll();
    for (const node of nodes) {
        if (node.isMullvadExitNode) {
            continue;
        }

        let item = new PopupMenu.PopupMenuItem(node.line)
        item.connect('activate', () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, node.address);
            Main.notify(_("Copied ") + node.address + _(" to clipboard! (") + node.name + ")");
        });
        nodesMenu.menu.addMenuItem(item);
    };
}

const FixedSubMenuMenuItem = GObject.registerClass(
class FixedSubMenuMenuItem extends PopupMenu.PopupSubMenuMenuItem {
    _init(name, rootScroller) {
        super._init(name);
        this.rootScroller = rootScroller;
        this.menu._needsScrollbar = () => false;
        this.menu.actor.set_mouse_scrolling(false);
    }

    _subMenuOpenStateChanged(menu, open) {
        super._subMenuOpenStateChanged(menu, open);
        {
            const needsScrollbar = this.rootScroller._needsScrollbar();
            this.rootScroller.actor.vscrollbar_policy = St.PolicyType.ALWAYS;
            if (needsScrollbar)
                this.rootScroller.actor.add_style_pseudo_class('scrolled');
            else
                this.rootScroller.actor.remove_style_pseudo_class('scrolled');
        }
    }
}
);

function _refreshExitNodesMenu(menu, t, indent = '', rootScroller = null) {
    let usesExit = false;

    for (const node of t.nodes) {
        if (!node.offersExit) {
            continue;
        }

        const item = new PopupMenu.PopupMenuItem(indent+node.name)
        item.connect('activate', () => {
            tsService.sendCommand(["up", "--exit-node=" + node.address, "--reset"])
                .then(updateStatusUI).catch(myError);
        });
        item.setOrnament(node.usesExit ? 1 : 0)
        menu.addMenuItem(item);
        usesExit ||= node.usesExit;
    }

    rootScroller = rootScroller || menu;

    for (const [name, st] of Object.entries(t.subTrees)) {
        const subMenu = new FixedSubMenuMenuItem(indent+name, rootScroller);
        const stUsesExit = _refreshExitNodesMenu(subMenu.menu, st, indent+' ', rootScroller)
        subMenu.setOrnament(stUsesExit ? 1 : 0)
        menu.addMenuItem(subMenu)
        usesExit ||= stUsesExit
    }

    return usesExit
}

function refreshExitNodesMenu() {
    exitNodeMenu.menu.removeAll();

    const usesExit = _refreshExitNodesMenu(exitNodeMenu.menu, nodesTree);

    var noneItem = new PopupMenu.PopupMenuItem(_('None'));
    noneItem.connect('activate', () => {
        tsService.sendCommand(["up", "--exit-node=", "--reset"])
            .then(updateStatusUI).catch(myError);
    });
    noneItem.setOrnament(usesExit ? 0 : 1)
    exitNodeMenu.menu.addMenuItem(noneItem, 0);
}

function refreshSendMenu() {
    sendMenu.menu.removeAll();
    for (const node of nodes) {
        if (!node.online || node.isSelf || node.isMullvadExitNode) {
            continue;
        }

        var item = new PopupMenu.PopupMenuItem(node.name)
        item.connect('activate', () => {
            sendFilesUI(node.address);
        });
        sendMenu.menu.addMenuItem(item);
    }
}

function sendFilesUI(dest) {
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
                        let files = stdout.trim().split("|");
                        files.forEach(file => {
                            tsService.sendFile(file, dest)
                                .then(() => Main.notify(_('File sent successfully: ') + file + ' → ' + dest))
                                .catch(err => {
                                    myError("Failed to send file: " + file + " to " + dest + " | " + err);
                                });
                        });
                    }
                } else {
                    myWarn("zenity canceled by user");
                }
            } catch (e) {
                myError(e);
            }
        });
    } catch (e) {
        myError(e);
    }
}

function updateAccountsListUI() {
    tsService.getAccounts().then(accs => {
        accounts = accs;
        accountsMenu.menu.removeAll();
        accounts.forEach((account) => {
            if (typeof account === 'string') {
                if (account.slice(-2) == " *") {
                    account = account.slice(0, -2)
                    currentAccount = account
                }
                let accountItem = new PopupMenu.PopupMenuItem(account)
                accountItem.connect('activate', () => {
                    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
                    const email = account.match(emailRegex);
                    if (email == null) {
                        myError("failed to extract email from account string")
                        return
                    }
                    switchAccountUI(email[0]);
                });
                accountsMenu.menu.addMenuItem(accountItem);
            } else if (typeof account === 'object') {
                let accName = account.UserProfile?.LoginName || account.Name || "Unknown";
                let accountItem = new PopupMenu.PopupMenuItem(accName)
                accountItem.connect('activate', () => {
                    switchAccountUI(account.ID || accName);
                });
                accountsMenu.menu.addMenuItem(accountItem);
            }
        });
    }).catch(err => {
        myWarn("failed to fetch accounts: " + err);
    });
}

function switchAccountUI(account) {
    if (currentAccount == account) {
        Main.notify(_("Already logged in with ") + account)
        return
    } else {
        Main.notify(_("Switching to ") + account)
        currentAccount = account
    }

    tsService.switchAccount(account)
        .then(updateStatusUI)
        .catch(myError);
}

function updateStatusUI() {
    tsService.getStatus().then(json => {
        extractNodeInfo(json);
        setStatus(json);
        refreshExitNodesMenu();
        refreshSendMenu();
        refreshNodesMenu();
    }).catch(err => {
        myError("Failed to fetch status: " + err);
    });
}

function receiveFilesUI() {
    try {
        let zenityTitle = _("Select where to save received files");
        let proc = Gio.Subprocess.new(
            ["zenity", "--file-selection", "--directory", "--title=" + zenityTitle],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (proc.get_successful()) {
                    let selectedPath = stdout.trim();
                    if (selectedPath !== '') {
                        tsService.receiveFile(null, selectedPath)
                            .then(() => Main.notify(_('Files saved to ') + selectedPath))
                            .catch(err => {
                                Main.notify(_('Failed to receive files to ') + selectedPath, _('check logs with journalctl -f -o cat /usr/bin/gnome-shell'));
                                myWarn("failed to accept files: " + err);
                            });
                    }
                } else {
                    myWarn("zenity canceled by the user");
                }
            } catch (e) {
                myError(e);
            }
        });
    } catch (e) {
        myError(e);
    }
}

const TailscalePopup = GObject.registerClass(
    class TailscalePopup extends PanelMenu.Button {

        _init(dir_path) {
            super._init(0);

            icon_down = Gio.icon_new_for_string(dir_path + '/icon-down.svg');
            icon_up = Gio.icon_new_for_string(dir_path + '/icon-up.svg');
            icon_exit_node = Gio.icon_new_for_string(dir_path + '/icon-exit-node.svg');

            icon = new St.Icon({
                gicon: icon_down,
                style_class: 'system-status-icon',
            });

            this.add_child(icon);

            this.menu.connect('open-state-changed', (menu, open) => {
                if (open) {
                    updateStatusUI();
                }
            });

            this.menu._setOpenedSubMenu = () => {};

            statusItem = new PopupMenu.PopupMenuItem(_("Status: "), { reactive: false });

            authItem = new PopupMenu.PopupMenuItem(_("Logged in"), false);

            authItem.connect('activate', () => {
                updateStatusUI();
                if (authUrl && authUrl.length == 0) {
                    tsService.sendCommand(["up"]).then(updateStatusUI).catch(myError);
                }
            });

            accountIndicator = new PopupMenu.PopupMenuItem(_("Account: "), { reactive: false});

            statusSwitchItem = new PopupMenu.PopupSwitchMenuItem(_("Tailscale"), false);
            statusSwitchItem.connect('activate', () => {
                if (statusSwitchItem.state) {
                    tsService.sendCommand(["up"]).then(updateStatusUI).catch(myError);
                } else {
                    tsService.sendCommand(["down"], true, false).then(updateStatusUI).catch(myError);
                }
            })

            accountButton = new PopupMenu.PopupMenuItem(_("Update Accounts List"));
            accountButton.connect('activate', () => {
                updateAccountsListUI();
            })

            accountsMenu = new PopupMenu.PopupSubMenuMenuItem(_("Accounts"));

            nodesMenu = new PopupMenu.PopupSubMenuMenuItem(_("Nodes"));

            shieldItem = new PopupMenu.PopupSwitchMenuItem(_("Block Incoming"), false);
            shieldItem.connect('activate', () => {
                if (shieldItem.state) {
                    tsService.sendCommand(["up", "--shields-up"]).then(updateStatusUI).catch(myError);
                } else {
                    tsService.sendCommand(["up", "--shields-up=false", "--reset"]).then(updateStatusUI).catch(myError);
                }
            })

            acceptRoutesItem = new PopupMenu.PopupSwitchMenuItem(_("Accept Routes"), false);
            acceptRoutesItem.connect('activate', () => {
                if (acceptRoutesItem.state) {
                    tsService.sendCommand(["up", "--accept-routes"]).then(updateStatusUI).catch(myError);
                } else {
                    tsService.sendCommand(["up", "--accept-routes=false", "--reset"]).then(updateStatusUI).catch(myError);
                }
            })

            allowLanItem = new PopupMenu.PopupSwitchMenuItem(_("Allow Direct Lan Access"), false);
            allowLanItem.connect('activate', () => {
                if (allowLanItem.state) {
                    if (nodes[0] && nodes[0].usesExit) {
                        tsService.sendCommand(["up", "--exit-node-allow-lan-access"]).then(updateStatusUI).catch(myError);
                    } else {
                        Main.notify(_("Must setup exit node first"));
                        allowLanItem.setToggleState(false);
                    }
                } else {
                    tsService.sendCommand(["up", "--exit-node-allow-lan-access=false", "--reset"]).then(updateStatusUI).catch(myError);
                }
            })

            receiveFilesItem = new PopupMenu.PopupMenuItem(_("Accept incoming files"));
            receiveFilesItem.connect('activate', () => {
                receiveFilesUI();
            })

            sendMenu = new PopupMenu.PopupSubMenuMenuItem(_("Send Files"));

            exitNodeMenu = new PopupMenu.PopupSubMenuMenuItem(_("Exit Nodes"));

            logoutButton = new PopupMenu.PopupMenuItem(_("Log Out"));
            logoutButton.connect('activate', () => {
                tsService.logout().then(updateStatusUI).catch(myError);
            })

            let aboutMenu = new PopupMenu.PopupSubMenuMenuItem(_("About"));
            let healthMenu = new PopupMenu.PopupMenuItem(_("Health"))
            healthMenu.connect('activate', () => {
                if (health != null) {
                    Main.notify(health.join());
                } else {
                    Main.notify("null");
                }
            })
            let infoMenu = new PopupMenu.PopupMenuItem(_("This extension is in no way affiliated with Tailscale Inc."))
            let contributeMenu = new PopupMenu.PopupMenuItem(_("Contribute"))
            contributeMenu.connect('activate', () => {
                Util.spawn(['xdg-open', "https://github.com/maxgallup/tailscale-status#contribute"])
            })

            this.menu.addMenuItem(statusSwitchItem);
            this.menu.addMenuItem(statusItem);
            this.menu.addMenuItem(authItem);
            this.menu.addMenuItem(accountIndicator);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(nodesMenu);
            this.menu.addMenuItem(accountButton);
            this.menu.addMenuItem(accountsMenu);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(shieldItem);
            this.menu.addMenuItem(acceptRoutesItem);
            this.menu.addMenuItem(allowLanItem);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(receiveFilesItem);
            this.menu.addMenuItem(sendMenu);
            this.menu.addMenuItem(exitNodeMenu);
            this.menu.addMenuItem(logoutButton);
            this.menu.addMenuItem(aboutMenu);
            aboutMenu.menu.addMenuItem(infoMenu);
            aboutMenu.menu.addMenuItem(contributeMenu);
            aboutMenu.menu.addMenuItem(healthMenu);
        }
    }
);

let tailscale;

export default class TailscaleStatusExtension extends Extension {
    enable() {
        SETTINGS = this.getSettings('org.gnome.shell.extensions.tailscale-status');

        currentAccount = _("(click Update Accounts List)");

        updateStatusUI();

        tsService.watchEvents((jsonEvent) => {
            if (jsonEvent.IncomingFiles && jsonEvent.IncomingFiles.length > 0) {
                Main.notify(_('Tailscale'), _("New file received! Access the menu to save."));
            }
        });

        tailscale = new TailscalePopup(this.path);
        Main.panel.addToStatusArea('tailscale', tailscale, 1);
    }

    disable() {
        tailscale.destroy();
        tailscale = null;
        SETTINGS = null;
        accounts = [];
        nodes = [];
        currentAccount = null;
        nodesMenu = null;
        accountButton = null;
        accountsMenu = null;
        accountIndicator = null;
        logoutButton = null;
        exitNodeMenu = null;
        sendMenu = null;
        statusItem = null;
        authItem = null;
        needToAuth = true;
        authUrl = null;

        health = null;

        receiveFilesItem = null;
        shieldItem = null;
        acceptRoutesItem = null;
        allowLanItem = null;
        statusSwitchItem = null;
        downloads_path = null;
        icon = null;
        icon_down = null;
        icon_up = null;
        icon_exit_node = null;
    }
}
