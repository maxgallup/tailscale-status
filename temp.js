try {
  let proc = Gio.Subprocess.new(
      ['/bin/bash', '-c', `echo ${new_threshold} | ${threshold_command}`],
      Gio.SubprocessFlags.STDERR_PIPE
  );
  proc.communicate_utf8_async(null, null, (proc, res) => {
      try {
          let [, , stderr] = proc.communicate_utf8_finish(res);
          if (!proc.get_successful())
              throw new Error(stderr);

          this.get_threshold()
          if (this.threshold == new_threshold) {
              Main.notify(_(`Battery threshold set to ${this.threshold}%`));
              this.textBox.set_text(`Battery threshold: ${this.threshold}%`);
          }
      } catch (e) {
          logError(e);
      }
  });
} catch (e) {
  logError(e);
}