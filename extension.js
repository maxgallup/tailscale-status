const {St, Clutter} = imports.gi;
const Main = imports.ui.main;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Me = imports.misc.extensionUtils.getCurrentExtension();




let testString = "some status";
let statusString = "Status: ";
let enabledString = "✅ ";
let disabledString = "❌";

class TailscaleNode {
  constructor(_name, _address, _status, _offersExit, _usesExit) {
    this.name = _name;
    this.address = _address;
    this.status = _status;
    this.offersExit = _offersExit;
    this.usesExit = _usesExit;
  }

  get line() {
    var statusIcon;
    switch (this.status) {
      case "idle;":
        statusIcon = "🟢"
        break;
      case "active;":
        statusIcon = "🟢"
        break;
      case "offline":
        statusIcon = disabledString;
        break;
      case "-":
        statusIcon = "💻"
        break;
      default:
        statusIcon = "X"
    }
    return statusIcon + " " + this.address + " " + this.name;
  }
}


let nodes = [];

let nodesMenu;
let exitNodeMenu;
let statusItem;
let output;

function parseOutput() {
  

  var lines = output.split("\n");
  lines.pop();
  nodes = []
  lines.forEach( (line) => {
    var splitLine = line.match(/\S+/g);
    var offersExit = splitLine.length >= 6;
    var usesExit = (offersExit) ? splitLine[5] == "exit" : false;
    nodes.push( new TailscaleNode(splitLine[1], splitLine[0], splitLine[4], offersExit, usesExit))
  })

  setUpStatus();
}

function setDownStatus() {
  statusItem.label.text = statusString + "down";
}

function setUpStatus() {
  statusItem.label.text = statusString + "up";
  nodes.forEach( (node) => {
    if (node.usesExit) {
      statusItem.label.text = statusString + "up with exit-node: " + node.name
    }
  })
}

function queryTailScaleStatus() {
  if (run_cmd(["tailscale", "status"])) {
    parseOutput();
  } else {
    setDownStatus();
  }
}

function refreshNodesMenu() {
  nodesMenu.removeAll();
  nodes.forEach( (node) => {
    nodesMenu.actor.add_child( new PopupMenu.PopupMenuItem(node.line) );
  });
}

function refreshExitNodesMenu() {
  exitNodeMenu.menu.removeAll();

  var uses_exit = false;
  
  nodes.forEach( (node) => {
    if (node.offersExit) {
      var item = new PopupMenu.PopupMenuItem(node.name)
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
  (uses_exit) ? noneItem.setOrnament(0) : noneItem.setOrnament(1);
  exitNodeMenu.menu.addMenuItem(noneItem, 0);
}

function enableTailscale() {
  // if (run_cmd(["pkexec", "tailscale", "up"])) {
    // if (run_cmd([ "sleep", "1", "&&", "echo", "hi", "&&", "sleep", "1", "&&", "echo", "hi" ])) {
  if (run_cmd(["sleep", "5"])) {
    setUpStatus();
  } else {
    setDownStatus();
  }
}

const MyPopup = GObject.registerClass(
    class MyPopup extends PanelMenu.Button {
    
      _init () {

        super._init(0);

        let icon = new St.Icon({
          gicon : Gio.icon_new_for_string( Me.dir.get_path() + '/icons/big2.svg' ),
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
          log("TODO: ", statusItem.label.text);
          enableTailscale();
          queryTailScaleStatus();
          refreshExitNodesMenu();
          refreshNodesMenu();

        });
        
        this.menu.addMenuItem(downItem, 3);
        downItem.connect('activate', () => {
          log("TODO: ", statusItem.label.text);
        });
        
        this.menu.connect('open-state-changed', (menu, open) => {
          if (open) {
            queryTailScaleStatus();
            refreshExitNodesMenu();
            refreshNodesMenu();
          }
        });
        
        this.menu.addMenuItem( new PopupMenu.PopupSeparatorMenuItem(), 4);
        this.menu.addMenuItem(nodesMenu, 5);
        this.menu.addMenuItem( new PopupMenu.PopupSeparatorMenuItem(), 6);
        this.menu.addMenuItem(exitNodeMenu, 7);
        exitNodeMenu.menu.addMenuItem( new PopupMenu.PopupMenuItem('None'), 0); // setOrnament(1)
        
        nodes.forEach( (node, index) => {
          nodesMenu.actor.add_child( new PopupMenu.PopupMenuItem(node.line) );
        });

        // nodesMenu.actor.add_child( new PopupMenu.PopupMenuItem('item 1') );
        // nodesMenu.actor.add_child( new PopupMenu.PopupMenuItem('item 2'), 0 );
        // exitNodeMenu.actor.add_child( new PopupMenu.PopupMenuItem('item 2'));
        
        // // section
        // let popupMenuSection = new PopupMenu.PopupMenuSection();
        // popupMenuSection.actor.add_child( new PopupMenu.PopupMenuItem('section') );
        // this.menu.addMenuItem(popupMenuSection);
        
        // // image item
        // let popupImageMenuItem = new PopupMenu.PopupImageMenuItem(
        //   'Menu Item with Icon',
        //   'security-high-symbolic',
        //   );
        //   this.menu.addMenuItem(popupImageMenuItem);
          
          
          // sub menu
        // you can close, open and toggle the menu with
        // this.menu.close();
        // this.menu.open();
        // this.menu.toggle();
      }
    
});
    



let timeout;


let loop = GLib.MainLoop.new(null, false);


function readOutput(stdout) {
  stdout.read_line_async(GLib.PRIORITY_LOW, null, (stdout, res) => {
    try {
      let line = stdout.read_line_finish_utf8(res)[0];

      if (line !== null) {
        log(`READ: ${line}`);
        readOutput(stdout);
      }
    } catch (e) {
      logError(e);
    }
  });
}

function run_cmd(argv) {
  try {
    let proc = Gio.Subprocess.new( argv, Gio.SubprocessFlags.STDOUT_PIPE );

    // Watch for the process to exit, like normal
    proc.wait_async(null, (proc, res) => {
      try {
        proc.wait_finish(res);
      } catch (e) {
        logError(e);
      } finally {
        loop.quit();
      }
    });

    
    let stdoutStream = new Gio.DataInputStream({
      base_stream: proc.get_stdout_pipe(),
      close_base_stream: true
    });
    readOutput(stdoutStream);
  } catch (e) {
    logError(e);
  }

  loop.run();
}



function init () {

}

function enable () {
  myPopup = new MyPopup();
  Main.panel.addToStatusArea('myPopup', myPopup, 1);
}

function disable () {
  myPopup.destroy();
}

