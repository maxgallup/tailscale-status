













// ---
// OLD
// ---

function run_cmd(argv) {
  try {
    let proc = Gio.Subprocess.new(
      argv,
      Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    );
    proc.communicate_utf8_async(null, null, (proc, res) => {
      try {
        let [, stdout, stderr] = proc.communicate_utf8_finish(res);
        if (proc.get_successful()) {
          output = stdout;
        } else {
          output = "error"
          return false;
        }
      } catch (e) {
        logError(e);
        return false;
      } finally {
        loop.quit();
      }
    });
  } catch (e) {
    logError(e);
    return false;
  }

  log("before " + argv);
  loop.run();
  log("after " + argv);

  return output != "error";
}
