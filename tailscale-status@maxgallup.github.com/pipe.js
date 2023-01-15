// Downloaded 2023-01-15 from https://github.com/ubunatic/gjs-pipe under MIT

/** super simple logger with extra object args support */
let gjslog = (msg, ...o) => {
    if (o.length > 0) msg = `${msg} ` + o.map(v => `${v}`).join(', ')
    log(`[gjspipe] ${msg}`)
}

gi = imports.gi
const { Gio, GLib, GObject } = gi

const SIGTERM = 15  // can be ignored
const SIGKILL = 9   // cannot be ignored

const GioError = (status) => {
    return new Gio.IOErrorEnum({
        code: Gio.io_error_from_errno(status),
        message: GLib.strerror(status),
    })
}

var isCancelled = (err) => (
    err instanceof Gio.IOErrorEnum &&
    err.code == Gio.IOErrorEnum.CANCELLED
)

// spawns subprocesses with predefined flags
const launcher = new Gio.SubprocessLauncher({
    flags: Gio.SubprocessFlags.STDOUT_PIPE
})

/** callback-recursive handler to read UTF-8 lines from a stream
 * @param {Gio.Cancellable} ctx
 * @param {Gio.InputStream} stdout
 * @param {function(string)} onLine
 * @param {function(Error|null)} onFinished
*/
function readLine(ctx, stdout, onLine, onFinished) {
    stdout.read_line_async(GLib.PRIORITY_LOW, ctx, (_, res) => {
        try {
            let line = stdout.read_line_finish_utf8(res)[0]
            if (line == null) return onFinished()
            onLine(line)
            readLine(ctx, stdout, onLine, onFinished)
        } catch (e) {
            if (isCancelled(e)) onFinished()
            else                onFinished(e)
        }
    })
}

var clearTimeout = GLib.source_remove
var setTimeout = (func, timeout_ms, ...args) => {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout_ms, () => {
        func(...args)
        return GLib.SOURCE_REMOVE
    })
}

/** returns a new `Promise` to be resolved or rejected with the result or error
 *  produced by calling `func` after a `delay_ms` timeout.
*/
function asyncTimeout(func, timeout_ms=0, ...args) {
    return new Promise((resolve, reject) => {
        const resolveOnTimeout = () => {
            try       { resolve(func(...args)) }
            catch (e) { reject(e) }
        }
        return setTimeout(resolveOnTimeout, timeout_ms)
    })
}

/** returns a new `Promise` to be resolved or rejected with the result or error
 *  produced by calling `func` asynchronously.
 */
function makeAsync(func, ...args) {
    return new Promise((resolve, reject) => {
        try       { resolve(func(...args)) }
        catch (e) { reject(e) }
    })
}

/**
 * @callback glibAsyncStart     function to implement the GLib async call
 * @param  {function}  finish   internal GLib callback (created by `glibAsync`)
 *                              to pass GLib callback arguments to the custom
 *                              `glibAsync.finish_fn` function
 *
 * In this function you should write your GLib code and use `finish` as regular
 * callback function to your GLib `<func>_async` call.
 *
 * @see {glibAsync}
*/

/**
 * returns a new `Promise` to be resolved or rejected with the result or error
 * produced by first calling `async_fn` asynchronously and then handling the
 * async result with `finish_fn`.
 *
 * @param {glibAsyncStart} start_fn   function to implement GLib start logic
 * @param {function}       finish_fn  function to implement GLib finish logic
 *
 * The `async_fn` will receive the internal `glibAsyncStart.finish` function
 * that must be used as callback for the custom GLib start code.
 * This creates the actual async callback chain between start and finish
 * (without requiring to write nested GLib callback logic).
 *
 * This may sound more complicated than it is.
 * Here is some typical `glibAsync` usage that shows how it works.
 *
 * @example
 * ok = await glibAsync(
 *     (finish) => proc.wait_check_async(null, finish),  // GLib start code
 *     (_, res) => proc.wait_check_finish(res),          // GLib finish code
 * )
 * // Awaiting a failed Promise will throw any of the errors from the GLib calls.
 * // The errors can the be catched synchronously.
 *
 * try       { ok = await glibAsync(start, finish) }
 * catch (e) { log(`Wow! Nice (a)sync catch!`) }
 *
 */
function glibAsync(start_fn, finish_fn) {
    return new Promise((resolve, reject) => {
        try {
            start_fn((...args) => {
                try       { resolve(finish_fn(...args)) }
                catch (e) { reject(e) }
            })
        } catch (e) {
            reject(e)
        }
    })
}

var AGG_LINES = 'AGG_LINES'
var AGG_JSON  = 'AGG_JSON'

/** @readonly @enum {string} */
var AGG = {
    LINES: AGG_LINES,
    JSON:  AGG_JSON,
}

/**
 * Pipe is a user-friendly and safe command runner.
 */
var Pipe = class Pipe {
    /**
     * Create a new Pipe.
     * @param  {...string} cmd  the command to run
     *
     * @example
     * // start a loop in `bash`
     * let p = new Pipe('bash', '-c', 'while sleep 1; do echo "looping"; done')
     * let cancel = p.start(onResult, onExit)
     * // ... some time later ...
     * cancel()  // You must call cancel later to avoid zombies!
     *
     * @example
     * // start a simple command and read all output
     * let p = new Pipe('bash', '-c', 'echo 1')
     * p.start((l) => print(l), (ok) => print(ok? 'OK':'ERR'))
     *
     */
    constructor(...cmd) {
        this.command_line = cmd.join(' ')  // this is just used for logging
        this.args         = cmd.slice(1)   // for calling we use an args Array
        this.cmd          = cmd[0]         // and a single command string
        this.line         = ''             // the last line read by the pipe
        this.agg_err      = null           // the last aggregation error
        this.err          = null           // the last observed pipe error
        this.history      = []             // a line history if allowed to collect
        this._cancel      = null           // internal cancel function
        this.configure()
    }
    /**
     * Overrides all pipe parameters with defaults or given values
     * @param {Object}           opt
     * @param {number}           opt.read_timeout_ms
     * @param {function(string)} opt.aggregation_func  custom aggregation function
     * @param {AGG}              opt.agg_type          aggregation type for common aggregations
     * @param {boolean}          opt.verbose           set to `true` to show more logs
     * @param {number}           opt.keep              how many lines to keep in the history
     */
    configure({read_timeout_ms=0, aggregation_func=null, agg_type=null, verbose=false, keep=100}={}) {
        /** Defines how many lines to keep in the history */
        this.keep = keep

        /**
         * line aggregation function to produce aggregated results
         *
         * Default: `null` (no aggregation)
        */
        this.aggregation = aggregation_func
        if (aggregation_func != null && agg_type != null) {
            throw new Error(`cannot set agg_type=${agg_type} when custom aggregation is used`)
        }
        switch (agg_type) {
            case AGG.JSON:  this.aggregation = this.aggregateJSON;  break
            case AGG.LINES: this.aggregation = this.aggregateLines; break
        }

        /** set to `true` to show more logs */
        this.verbose = verbose

        /**
         * **This option is not yet implemented!**
         *
         * `read_timeout_ms` defines how long to wait for pending output after process termination.
         *
         * Default: `0` (no wait)
         */
        this.read_timeout_ms = read_timeout_ms
        return this
    }
    log(msg) {
        if (this.verbose) gjslog(msg)
    }
    /** collects a line history */
    aggregateLines(line) {
        const agg = this.history
        agg.push(line)
        if (agg.length >= this.keep * 2) {
            this.history = agg.slice(-this.keep)
            return this.history.slice(0)
        }
        return null
    }
    /** aggregates multi-line output from formatted JSON objects */
    aggregateJSON(line) {
        const agg = this.history
        if(line.match(/^},?$/)) {
            // Found a closing bracket at the root level which should close the
            // last root-level JSON object.
            // Note: This kind of data is sent by `intel_gpu_top -J`
            try {
                let data = JSON.parse(agg.join('\n') + '\n}')
                this.agg_err = null
                this.history = []
                return data
            } catch (e) {
                this.agg_err = e
                this.log(`resetting line history on multi-line JSON parse error: ${e.message}`)
                // since we are at the last line, the next line should start with a clean object
                // this way we may recover after parse errors
                this.history = []
                return null
            }
        }
        agg.push(line)
        if (agg.length > 1e6) {
            this.agg_err = new Error('aggregation buffer exceeds 1M lines')
            this.stop()
        }
        return null
    }
    stop() {
        if (this._cancel) {
            // stealing the cancel method to stop reading and exit the process
            this.log(`stopping previous pipe`)
            this._cancel()
            this._cancel = null
        }
        this.history = []
        this.line = ''
    }
    start(onResult=null, onExit=null, onError=logError) {
        this.stop()  // ensure we do run not more than once

        this.agg_err = null
        this.err = null

        let proc = null
        let ctx  = null

        // start the process and connect the stdout stream
        const spawn = () => {
            proc = launcher.spawnv([this.cmd, ...this.args])
            let stdout = new Gio.DataInputStream({
                base_stream: proc.get_stdout_pipe(),
                close_base_stream: true
            })
            ctx = new Gio.Cancellable()
            this.log(`starting pipe ${this.command_line}`)
            readLine(ctx, stdout, read, finish)
        }

        // wait for process termination and check exit status
        const finish = (pipe_error=null) => {
            if (pipe_error) onError(pipe_error)
            this.log(`terminating pipe ${this.command_line} termination_requested=${termination_requested}`)
            proc.wait_check_async(null, (_, res) => {
                let check_error = null
                let ok = true
                try         { ok = proc.wait_check_finish(res) }
                catch (err) { check_error = err }
                if (termination_requested) {
                    // context was cancelled by the user, unclean exit was expected
                    ok = (ok && pipe_error == null)
                } else {
                    // context was not cancelled manually, unclean exit was not expected
                    if (check_error) onError(check_error)
                    ok = (ok && pipe_error == null && check_error == null)
                }
                const exit_msg = `exit_status='${check_error? check_error.message : 'clean'}'`
                const read_msg = `read_status='${ pipe_error? pipe_error.message  : 'ok'}'`
                if (ok) this.log(`pipe finished cmd='${this.command_line}' ${exit_msg} ${read_msg}`)
                else    this.log(`pipe failed cmd='${this.command_line}' ${exit_msg} ${read_msg}`)
                if(onExit) onExit(ok)
            })
        }

        /** read single line and forward potential results
         * @param {string} line
        */
        const read = (line) => {
            let result = this.line = line
            if (this.aggregation) result = this.aggregation(line)
            if (result != null && onResult) onResult(result)
        }

        let terminated = false
        let termination_requested = false
        // allow internal and external cancellation
        let cancel = this._cancel = () => {
            if (terminated) return
            terminated = true
            if (this.err)     logError(this.err)
            if (this.agg_err) logError(this.agg_err)
            if (!ctx.is_cancelled()) {
                termination_requested = true
            }
            ctx.cancel()
            proc.force_exit()
        }

        // start the process, catch and handle sync errors
        try       { spawn() }
        catch (e) { cancel(); throw e }

        return cancel
    }
}

if (!this.module) this.module = {}
module.exports = {
    Pipe, AGG, AGG_LINES, AGG_JSON,
    setTimeout, clearTimeout, isCancelled,
    asyncTimeout, makeAsync, glibAsync
}