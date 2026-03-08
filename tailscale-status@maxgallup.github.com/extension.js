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


const statusString = "Status: ";
const enabledString = "🟢";
const disabledString = "⚫";
const ownConnectionString = "💻";

let EXT_VERSION = "dev";
let EXT_UUID = "unknown";

class TailscaleNode {
    /**
     * @param {boolean} _isMullvadExitNode
     * @param {string[]} _groupPath - e.g. ["Mullvad", "Norway", "Oslo"]
     */
    constructor(_name, _address, _online, _offersExit, _usesExit, _isSelf, _isMullvadExitNode, _groupPath) {
        this.name = _name;
        this.address = _address;
        this.online = _online;
        this.offersExit = _offersExit;
        this.usesExit = _usesExit;
        this.isSelf = _isSelf;
        /** We probably want to ignore these for anything that's not picking an exit node. */
        this.isMullvadExitNode = _isMullvadExitNode;
        /** Currently just used to group the Mullvad exit nodes, but code is structured to take arbitrary groupings. */
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

/** @type {TailscaleNode[]} */
let nodes = [];
/** @typedef {{nodes: TailscaleNode[], subTrees: {[k: string]: NodesTree}}} NodesTree */
/** @type {NodesTree} */
let nodesTree = { nodes: [], subTrees: {} }
let accounts = [];
let currentAccount = "(click Update Accounts List)";
let currentProfileId = null;
let switchListInFlight = false;
let switchProfileInFlight = false;

const LOCALAPI_HOST = "local-tailscaled.sock";
const LOCALAPI_BASE = "http://" + LOCALAPI_HOST;
const LOCALAPI_SOCKET_CANDIDATES = [
    "/run/tailscale/tailscaled.sock",
    "/var/run/tailscale/tailscaled.sock",
];

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
    console.log("🟡 [tailscale-status " + EXT_VERSION + "]: " + string);
}

function myError(string) {
    console.log("🔴 [tailscale-status " + EXT_VERSION + "]: " + string);
}

function localApiSocketPath() {
    for (const path of LOCALAPI_SOCKET_CANDIDATES) {
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            return path;
        }
    }
    return null;
}

function localApiCurl({ method, path, jsonBody = null, inputFile = null, outputFile = null, extraHeaders = [], usePkexec = false }, onSuccess, onError) {
    const socketPath = localApiSocketPath();
    if (!socketPath) {
        const msg = "tailscaled socket not found";
        myError(msg);
        if (onError) {
            onError(msg);
        }
        return;
    }

    const url = LOCALAPI_BASE + path;
    let args = [
        "curl",
        "--silent",
        "--show-error",
        "--unix-socket",
        socketPath,
        "--request",
        method,
        "--header",
        "Host: " + LOCALAPI_HOST,
        "--write-out",
        "\n__HTTP_STATUS__:%{http_code}\n",
    ];

    for (const header of extraHeaders) {
        args.push("--header", header);
    }

    if (jsonBody !== null) {
        args.push("--header", "Content-Type: application/json");
        args.push("--data-binary", JSON.stringify(jsonBody));
    }

    if (inputFile !== null) {
        args.push("--header", "Content-Type: application/octet-stream");
        args.push("--data-binary", "@" + inputFile);
    }

    if (outputFile !== null) {
        args.push("--output", outputFile);
    }

    args.push(url);

    if (usePkexec) {
        args = ["/usr/bin/pkexec"].concat(args);
    }

    try {
        let proc = Gio.Subprocess.new(
            args,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                const marker = "\n__HTTP_STATUS__:";
                let status = 0;
                let body = stdout;
                const idx = stdout.lastIndexOf(marker);
                if (idx >= 0) {
                    body = stdout.slice(0, idx);
                    const statusText = stdout.slice(idx + marker.length).trim();
                    status = parseInt(statusText, 10) || 0;
                }
                if (proc.get_successful() && status > 0 && status < 400) {
                    onSuccess(body, status);
                } else {
                    const msg = (body && body.trim().length > 0) ? body.trim() : (stderr || "").trim();
                    myWarn(msg.length > 0 ? msg : "localapi request failed");
                    if (onError) {
                        onError(msg, status);
                    }
                }
            } catch (e) {
                myError(e);
                if (onError) {
                    onError(e);
                }
            }
        });
    } catch (e) {
        myError(e);
        if (onError) {
            onError(e);
        }
    }
}

function localApiJsonRequest(method, path, jsonBody, onSuccess, onError, usePkexec = false) {
    localApiCurl({ method, path, jsonBody, usePkexec }, (body) => {
        if (body == null || body.trim().length === 0) {
            onSuccess(null);
            return;
        }
        try {
            const parsed = JSON.parse(body);
            onSuccess(parsed);
        } catch (e) {
            myError(e);
            if (onError) {
                onError(e);
            }
        }
    }, onError);
}

function localApiJsonRequestWithFallback(method, path, jsonBody, onSuccess, onError, allowPkexec = true) {
    localApiJsonRequest(method, path, jsonBody, onSuccess, (msg, status) => {
        if (allowPkexec && (status === 401 || status === 403)) {
            localApiJsonRequest(method, path, jsonBody, onSuccess, onError, true);
        } else if (onError) {
            onError(msg, status);
        }
    });
}

function localApiCurlWithFallback(params, onSuccess, onError, allowPkexec = true) {
    localApiCurl({ ...params, usePkexec: false }, onSuccess, (msg, status) => {
        if (allowPkexec && (status === 401 || status === 403)) {
            localApiCurl({ ...params, usePkexec: true }, onSuccess, onError);
        } else if (onError) {
            onError(msg, status);
        }
    });
}


function extractNodeInfo(json) {
    nodes = [];
    nodesTree = { nodes: [], subTrees: {} };

    var me = json.Self;
    if (me.TailscaleIPs != null) {
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
    for (let p in json.Peer) {
        var n = json.Peer[p];
        let isMullvad = false;
        let groupPath = [];
        // We special-case these guys. Tailscale clients sometimes refer to "Location-based exit nodes",
        // perhaps in future it should be done by nodes with a .Location instead?
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
    nodes.sort(combineSort(sortProp('isSelf'), sortProp('online', 'desc'), sortArrProp('groupPath'), sortProp('name')))

    for (const n of nodes) {
        let t = nodesTree;
        // recurse into / initialize the tree, one level per entry in groupPath
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
/** @param {'desc' | undefined} desc - descending sort */
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
            // else this sorter considers them equal, try the next one.
        }
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
    if (!authItem || !statusItem || !accountIndicator || !statusSwitchItem) {
        return;
    }
    authItem.label.text = "Logged in: " + getUsername(json);
    accountIndicator.label.text = "Account: " + currentAccount;
    authItem.sensitive = false;
    health = json.Health
    switch (json.BackendState) {
        case "Running":
            needToAuth = true
            icon.gicon = icon_up;
            statusSwitchItem.setToggleState(true);
            statusItem.label.text = statusString + "up (no exit-node)";
            nodes.forEach((node) => {
                if (node.usesExit) {
                    statusItem.label.text = statusString + "up (exit-node: " + node.name + ")";
                    icon.gicon = icon_exit_node;
                }
            })
            setAllItems(true);
            break;
        case "Stopped":
            needToAuth = true
            icon.gicon = icon_down;
            statusSwitchItem.setToggleState(false);
            statusItem.label.text = statusString + "down";
            nodes = [];
            setAllItems(false);
            statusSwitchItem.sensitive = true;
            break;
        case "NeedsLogin":
            icon.gicon = icon_down;
            statusSwitchItem.setToggleState(false);
            authUrl = json.AuthURL;
            if (authUrl.length > 0 && needToAuth) {
                Util.spawn(['xdg-open', authUrl])
                needToAuth = false
            }

            authItem.sensitive = true;
            statusItem.label.text = statusString + "needs login";
            authItem.label.text = "Click to Login"

            setAllItems(false);
            nodes = [];
            break;

        default:
            statusItem.label.text = statusString + (json.BackendState || "unknown");
            setAllItems(false);
    }
}

function applyPrefsToUi(prefs) {
    if (!prefs || !shieldItem || !acceptRoutesItem || !allowLanItem) {
        return;
    }
    if (typeof prefs.ShieldsUp === "boolean") {
        shieldItem.setToggleState(prefs.ShieldsUp);
    }
    if (typeof prefs.RouteAll === "boolean") {
        acceptRoutesItem.setToggleState(prefs.RouteAll);
    }
    if (typeof prefs.ExitNodeAllowLANAccess === "boolean") {
        allowLanItem.setToggleState(prefs.ExitNodeAllowLANAccess);
    }
}

function setAllItems(b) {
    if (!shieldItem || !acceptRoutesItem || !allowLanItem || !statusSwitchItem) {
        return;
    }
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
            Main.notify("Copied " + node.address + " to clipboard! (" + node.name + ")");
        });
        nodesMenu.menu.addMenuItem(item);
    };
}

/**
 * This is a PopupSubMenuMenuItem with some patches to make nested submenus work,
 * by default they don't work at all.
 */
const FixedSubMenuMenuItem = GObject.registerClass(
class FixedSubMenuMenuItem extends PopupMenu.PopupSubMenuMenuItem {
    _init(name, rootScroller) {
        super._init(name);
        this.rootScroller = rootScroller;

        // Monkey-patch scrolling - we'll leave scrolling to the rootScroller.
        // Disable scrolling on our own menu's ScrollBox.
        this.menu._needsScrollbar = () => false;
        this.menu.actor.set_mouse_scrolling(false);
    }

    _subMenuOpenStateChanged(menu, open) {
        super._subMenuOpenStateChanged(menu, open);

        // we've changed the height of a submenu. Gnome doesn't handle this properly,
        // so we need to go and tell the rootScroller that its height has changed.
        // Copy-paste from PopupSubMenu.open().
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

/**
 * @param {PopupMenu.PopupMenuBase} menu
 * @param {NodesTree} t
 * @param {string} indent
 * @param {PopupMenu.PopupMenuBase | null} rootScroller
 *   we need to keep track of the ExitNodes popupmenu so we can fix Gnome's buggy handling of nested
 *   submenus.
 */
function _refreshExitNodesMenu(menu, t, indent = '', rootScroller = null) {
    let usesExit = false;

    // Add any nodes to this level of the tree
    for (const node of t.nodes) {
        if (!node.offersExit) {
            continue;
        }

        const item = new PopupMenu.PopupMenuItem(indent+node.name)
        item.connect('activate', () => {
            setExitNode(node.address)
        });
        item.setOrnament(node.usesExit ? 1 : 0)
        menu.addMenuItem(item);
        usesExit ||= node.usesExit;
    }

    rootScroller = rootScroller || menu;

    // Add any subtress to this level of the tree
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

    var noneItem = new PopupMenu.PopupMenuItem('None');
    noneItem.connect('activate', () => {
        clearExitNode();
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
            sendFiles(node.address);
        });
        sendMenu.menu.addMenuItem(item);
    }
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
                        const files = stdout.trim().split("|")
                        localApiSendFiles(files, dest)
                    }
                } else {
                    myError("zenity failed");
                }
            } catch (e) {
                myError(e);
            }
        });
    } catch (e) {
        myError(e);
    }
}

function localApiFindFileTarget(targets, destAddress) {
    for (const target of targets) {
        const node = target.Node || {};
        const addresses = target.Addresses || node.Addresses || [];
        if (addresses.includes(destAddress)) {
            return target;
        }
    }
    return null;
}

function localApiSendFiles(files, destAddress) {
    localApiJsonRequestWithFallback("GET", "/localapi/v0/file-targets", null, (targets) => {
        if (!targets || targets.length === 0) {
            myWarn("no file targets available");
            return;
        }
        const target = localApiFindFileTarget(targets, destAddress);
        if (!target) {
            myWarn("no matching file target for " + destAddress);
            Main.notify("No file target for " + destAddress);
            return;
        }
        const node = target.Node || {};
        const stableId = node.StableID || node.StableId || target.StableID || target.StableId;
        if (!stableId) {
            myWarn("file target missing stable ID");
            return;
        }
        localApiSendNextFile(stableId, files, 0);
    });
}

function localApiSendNextFile(stableId, files, index) {
    if (index >= files.length) {
        Main.notify("Files sent");
        return;
    }
    const filePath = files[index];
    const baseName = GLib.path_get_basename(filePath);
    const path = "/localapi/v0/file-put/" + encodeURIComponent(stableId) + "/" + encodeURIComponent(baseName);
    localApiCurlWithFallback({ method: "PUT", path, inputFile: filePath }, () => {
        localApiSendNextFile(stableId, files, index + 1);
    }, () => {
        Main.notify("Failed to send " + baseName);
    });
}


function localApiStartWithPrefs(prefs) {
    localApiJsonRequestWithFallback("POST", "/localapi/v0/start", { UpdatePrefs: prefs }, () => {
        cmdTailscaleStatus();
    }, null, true);
}

function localApiEditPrefs(maskedPrefs) {
    localApiJsonRequestWithFallback("PATCH", "/localapi/v0/prefs", maskedPrefs, () => {
        cmdTailscaleStatus();
    }, null, true);
}

function localApiLogout() {
    localApiCurlWithFallback({ method: "POST", path: "/localapi/v0/logout" }, () => {
        cmdTailscaleStatus();
    }, null, true);
}

function localApiLoginInteractive() {
    localApiCurlWithFallback({ method: "POST", path: "/localapi/v0/login-interactive" }, () => {
        cmdTailscaleStatus();
    }, null, true);
}

function setWantRunning(on) {
    if (on) {
        let prefs = {
            WantRunning: true,
            WantRunningSet: true,
        };
        const loginServer = SETTINGS.get_string('login-server');
        if (loginServer && loginServer.length > 0) {
            prefs.ControlURL = loginServer;
            prefs.ControlURLSet = true;
        }
        localApiStartWithPrefs(prefs);
    } else {
        localApiEditPrefs({
            WantRunning: false,
            WantRunningSet: true,
        });
    }
}

function setShieldsUp(on) {
    localApiEditPrefs({
        ShieldsUp: on,
        ShieldsUpSet: true,
    });
}

function setAcceptRoutes(on) {
    localApiEditPrefs({
        RouteAll: on,
        RouteAllSet: true,
    });
}

function setExitNodeAllowLanAccess(on) {
    localApiEditPrefs({
        ExitNodeAllowLANAccess: on,
        ExitNodeAllowLANAccessSet: true,
    });
}

function setExitNode(exitNodeIP) {
    localApiEditPrefs({
        ExitNodeID: "",
        ExitNodeIDSet: true,
        ExitNodeIP: exitNodeIP,
        ExitNodeIPSet: true,
    });
}

function clearExitNode() {
    localApiEditPrefs({
        ExitNodeID: "",
        ExitNodeIDSet: true,
        ExitNodeIP: "",
        ExitNodeIPSet: true,
    });
}

function cmdTailscaleSwitchList(allowPkexec = true) {
    if (switchListInFlight) {
        return;
    }
    switchListInFlight = true;
    if (accountButton) {
        accountButton.sensitive = false;
    }
    if (accountsMenu) {
        accountsMenu.sensitive = false;
    }
    localApiJsonRequestWithFallback("GET", "/localapi/v0/profiles/", null, (profiles) => {
        accounts = profiles || [];
        accountsMenu.menu.removeAll();

        let current = null;
        for (const profile of accounts) {
            if (profile.CurrentProfile || profile.IsCurrent || profile.Active) {
                current = profile;
                break;
            }
        }

        if (current) {
            currentProfileId = current.ID;
            currentAccount = current.Name || current.UserProfile?.LoginName || current.ID;
        } else if (currentProfileId) {
            const match = accounts.find((profile) => profile.ID === currentProfileId);
            if (match) {
                currentAccount = match.Name || match.UserProfile?.LoginName || match.ID;
            }
        } else if (!currentProfileId) {
            currentAccount = currentAccount || "(none)";
        }

        accounts.forEach((profile) => {
            const label = profile.Name || profile.UserProfile?.LoginName || profile.ID;
            let accountItem = new PopupMenu.PopupMenuItem(label);
            accountItem.connect('activate', () => {
                cmdTailscaleSwitch(profile.ID);
            });
            accountsMenu.menu.addMenuItem(accountItem);
        });
        switchListInFlight = false;
        if (accountButton) {
            accountButton.sensitive = true;
        }
        if (accountsMenu) {
            accountsMenu.sensitive = true;
        }
    }, () => {
        myWarn("failed to load profiles list");
        switchListInFlight = false;
        if (accountButton) {
            accountButton.sensitive = true;
        }
        if (accountsMenu) {
            accountsMenu.sensitive = true;
        }
    }, allowPkexec);
}

function cmdTailscaleSwitch(profileId) {
    if (switchProfileInFlight) {
        return;
    }
    if (currentProfileId == profileId) {
        Main.notify("Already logged in with " + currentAccount);
        return;
    } else {
        Main.notify("Switching account");
        currentProfileId = profileId;
    }
    switchProfileInFlight = true;
    if (accountButton) {
        accountButton.sensitive = false;
    }
    if (accountsMenu) {
        accountsMenu.sensitive = false;
    }
    localApiCurl({ method: "POST", path: "/localapi/v0/profiles/" + encodeURIComponent(profileId), usePkexec: true }, () => {
        cmdTailscaleStatus();
        cmdTailscaleSwitchList(true);
        switchProfileInFlight = false;
        if (accountButton) {
            accountButton.sensitive = true;
        }
        if (accountsMenu) {
            accountsMenu.sensitive = true;
        }
    }, () => {
        switchProfileInFlight = false;
        if (accountButton) {
            accountButton.sensitive = true;
        }
        if (accountsMenu) {
            accountsMenu.sensitive = true;
        }
    });
}

function cmdTailscaleStatus() {
    localApiJsonRequest("GET", "/localapi/v0/status", null, (j) => {
        if (!j) {
            return;
        }
        extractNodeInfo(j);
        setStatus(j);
        localApiJsonRequest("GET", "/localapi/v0/prefs", null, (prefs) => {
            applyPrefsToUi(prefs);
        }, (msg, status) => {
            myWarn("prefs sync failed" + (status ? " (" + status + ")" : ""));
        });
        refreshExitNodesMenu();
        refreshSendMenu();
        refreshNodesMenu();
    }, () => {
        myWarn("failed to fetch status");
    });
}

function cmdTailscaleRecFiles() {
    localApiJsonRequestWithFallback("GET", "/localapi/v0/files/", null, (files) => {
        if (!files || files.length === 0) {
            Main.notify("No files waiting");
            return;
        }
        localApiReceiveNextFile(files, 0);
    }, null, true);
}

function localApiReceiveNextFile(files, index) {
    if (index >= files.length) {
        Main.notify("Saved files to " + downloads_path);
        return;
    }
    const entry = files[index] || {};
    const name = entry.Name || entry.name;
    if (!name) {
        localApiReceiveNextFile(files, index + 1);
        return;
    }
    const destPath = GLib.build_filenamev([downloads_path, name]);
    const path = "/localapi/v0/files/" + encodeURIComponent(name);
    localApiCurlWithFallback({ method: "GET", path, outputFile: destPath }, () => {
        localApiCurlWithFallback({ method: "DELETE", path }, () => {
            localApiReceiveNextFile(files, index + 1);
        }, () => {
            localApiReceiveNextFile(files, index + 1);
        });
    }, () => {
        Main.notify("Unable to receive " + name);
        localApiReceiveNextFile(files, index + 1);
    });
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
                    cmdTailscaleStatus();
                }
            });

            // monkey-patch to nuke this property - it's buggy, if submenus are in a tree,
            // then it causes the parent to close when a child is opened, even though the parent
            // should stay open so you can see the child!
            this.menu._setOpenedSubMenu = () => {};

            // ------ MAIN STATUS ITEM ------
            statusItem = new PopupMenu.PopupMenuItem(statusString, { reactive: false });

            // ------ AUTH ITEM ------
            authItem = new PopupMenu.PopupMenuItem("Logged in", false);

            authItem.connect('activate', () => {
                cmdTailscaleStatus()
                if (authUrl.length == 0) {
                    try {
                        localApiLoginInteractive();
                    } catch (e) {
                        myError(e);
                    }
                }
            });


            // ------ ACCOUNT INDICATOR ------
            accountIndicator = new PopupMenu.PopupMenuItem("Account: ", { reactive: false});

            // ------ MAIN SWITCH ------
            statusSwitchItem = new PopupMenu.PopupSwitchMenuItem("Tailscale", false);
            statusSwitchItem.connect('activate', () => {
                if (statusSwitchItem.state) {
                    setWantRunning(true);
                } else {
                    setWantRunning(false);
                }
            })

            // ------ UPDATE ACCOUNTS ------
            accountButton = new PopupMenu.PopupMenuItem("Update Accounts List");
            accountButton.connect('activate', (item) => {
                cmdTailscaleSwitchList(true)
            })

            // ------ ACCOUNTS ------
            accountsMenu = new PopupMenu.PopupSubMenuMenuItem("Accounts");

            // ------ NODES ------
            nodesMenu = new PopupMenu.PopupSubMenuMenuItem("Nodes");
            nodes.forEach((node) => {
                nodesMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(node.line));
            });

            // ------ SHIELD ------
            shieldItem = new PopupMenu.PopupSwitchMenuItem("Block Incoming", false);
            shieldItem.connect('activate', () => {
                if (shieldItem.state) {
                    setShieldsUp(true);
                } else {
                    setShieldsUp(false);
                }
            })


            // ------ ACCEPT ROUTES ------
            acceptRoutesItem = new PopupMenu.PopupSwitchMenuItem("Accept Routes", false);
            acceptRoutesItem.connect('activate', () => {
                if (acceptRoutesItem.state) {
                    setAcceptRoutes(true);
                } else {
                    setAcceptRoutes(false);
                }
            })

            // ------ ALLOW DIRECT LAN ACCESS ------
            allowLanItem = new PopupMenu.PopupSwitchMenuItem("Allow Direct Lan Access", false);
            allowLanItem.connect('activate', () => {
                if (allowLanItem.state) {
                    if (nodes[0].usesExit) {
                        setExitNodeAllowLanAccess(true);
                    } else {
                        Main.notify("Must setup exit node first");
                        allowLanItem.setToggleState(false);
                    }
                } else {
                    setExitNodeAllowLanAccess(false);
                }
            })

            // ------ RECEIVE FILES MENU ------
            receiveFilesItem = new PopupMenu.PopupMenuItem("Accept incoming files");
            receiveFilesItem.connect('activate', () => {
                cmdTailscaleRecFiles();
            })

            // ------ SEND FILES MENU ------
            sendMenu = new PopupMenu.PopupSubMenuMenuItem("Send Files");

            // ------ EXIT NODES -------
            exitNodeMenu = new PopupMenu.PopupSubMenuMenuItem("Exit Nodes");

            // ------ LOG OUT -------
            logoutButton = new PopupMenu.PopupMenuItem("Log Out");
            logoutButton.connect('activate', () => {
                localApiLogout();
            })

            // ------ ABOUT MENU------
            let aboutMenu = new PopupMenu.PopupSubMenuMenuItem("About");
            let healthMenu = new PopupMenu.PopupMenuItem("Health")
            healthMenu.connect('activate', () => {
                if (health != null) {
                    Main.notify(health.join());

                } else {
                    Main.notify("null");
                }
            })
            let infoMenu = new PopupMenu.PopupMenuItem("This extension is in no way affiliated with Tailscale Inc.")
            let contributeMenu = new PopupMenu.PopupMenuItem("Contribute")
            contributeMenu.connect('activate', () => {
                Util.spawn(['xdg-open', "https://github.com/maxgallup/tailscale-status#contribute"])
            })


            // Order Matters!
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
        SETTINGS = this.getSettings('org.gnome.shell.extensions.tailscale-status-api');
        if (this.metadata) {
            EXT_VERSION = this.metadata.version ?? EXT_VERSION;
            EXT_UUID = this.metadata.uuid ?? EXT_UUID;
        }
        tailscale = new TailscalePopup(this.path);
        Main.panel.addToStatusArea('tailscale', tailscale, 1);
        cmdTailscaleStatus();
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
