const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;


let loop = GLib.MainLoop.new(null, false);


// This function reads a line from `stdout`, then queues another read/write

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

