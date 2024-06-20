"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeqlCliServer = void 0;
const node_child_process_1 = require("node:child_process");
const node_os_1 = require("node:os");
const node_stream_1 = require("node:stream");
const core_1 = require("@actions/core");
class CodeqlCliServer {
    codeqlPath;
    /**
     * The process for the cli server, or undefined if one doesn't exist yet
     */
    process;
    /**
     * Queue of future commands
     */
    commandQueue = [];
    /**
     * Whether a command is running
     */
    commandInProcess = false;
    /**
     * A buffer with a single null byte.
     */
    nullBuffer = Buffer.alloc(1);
    constructor(codeqlPath) {
        this.codeqlPath = codeqlPath;
    }
    run(args) {
        return new Promise((resolve, reject) => {
            const callback = () => {
                try {
                    // eslint-disable-next-line github/no-then -- we might not run immediately
                    this.runCommandImmediately(args).then(resolve, reject);
                }
                catch (err) {
                    reject(err);
                }
            };
            // If the server is not running a command, then run the given command immediately,
            // otherwise add to the queue
            if (this.commandInProcess) {
                this.commandQueue.push(callback);
            }
            else {
                callback();
            }
        });
    }
    shutdown() {
        this.killProcessIfRunning();
    }
    /**
     * Launch the cli server
     */
    launchProcess() {
        const args = ["execute", "cli-server"];
        // Start the server process.
        const argsString = args.join(" ");
        void (0, core_1.debug)(`Starting using CodeQL CLI: ${this.codeqlPath} ${argsString}`);
        const child = (0, node_child_process_1.spawn)(this.codeqlPath, args);
        if (!child || !child.pid) {
            throw new Error(`Failed to start using command ${this.codeqlPath} ${argsString}.`);
        }
        let lastStdout = undefined;
        child.stdout.on("data", (data) => {
            lastStdout = data;
        });
        // Set up event listeners.
        child.on("close", (code, signal) => {
            if (code !== null) {
                (0, core_1.debug)(`Child process exited with code ${code}`);
            }
            if (signal) {
                (0, core_1.debug)(`Child process exited due to receipt of signal ${signal}`);
            }
            // If the process exited abnormally, log the last stdout message,
            // It may be from the jvm.
            if (code !== 0 && lastStdout !== undefined) {
                (0, core_1.debug)(`Last stdout was "${lastStdout.toString()}"`);
            }
        });
        return child;
    }
    async runCommandImmediately(args) {
        const stderrBuffers = [];
        const parentProcess = process;
        if (this.commandInProcess) {
            throw new Error("runCommandImmediately called while command was in process");
        }
        this.commandInProcess = true;
        try {
            // Launch the process if it doesn't exist
            if (!this.process) {
                this.process = this.launchProcess();
            }
            const process = this.process;
            // The array of fragments of stdout
            const stdoutBuffers = [];
            void (0, core_1.debug)(`Running using CodeQL CLI: ${args.join(" ")}`);
            try {
                await new Promise((resolve, reject) => {
                    // Follow standard Actions behavior and print any lines to stdout/stderr immediately
                    let parentStdout;
                    if (parentProcess.stdout instanceof node_stream_1.Writable) {
                        parentStdout = parentProcess.stdout;
                    }
                    let parentStderr = undefined;
                    if (parentProcess.stderr instanceof node_stream_1.Writable) {
                        parentStderr = parentProcess.stderr;
                    }
                    // Start listening to stdout
                    process.stdout.addListener("data", (newData) => {
                        stdoutBuffers.push(newData);
                        if (newData.length > 0 &&
                            newData.readUInt8(newData.length - 1) === 0) {
                            if (newData.length > 1) {
                                parentStdout?.write(newData.subarray(0, newData.length - 1));
                            }
                        }
                        else {
                            parentStdout?.write(newData);
                        }
                        // If the buffer ends in '0' then exit.
                        // We don't have to check the middle as no output will be written after the null until
                        // the next command starts
                        if (newData.length > 0 &&
                            newData.readUInt8(newData.length - 1) === 0) {
                            resolve();
                        }
                    });
                    // Listen to stderr
                    process.stderr.addListener("data", (newData) => {
                        stderrBuffers.push(newData);
                        parentStderr?.write(newData);
                    });
                    // Listen for process exit.
                    process.addListener("close", (code) => reject(new Error(`The process ${this.codeqlPath} ${args.join(" ")} exited with code ${code}`)));
                    // Write the command followed by a null terminator.
                    process.stdin.write(JSON.stringify(args), "utf8");
                    process.stdin.write(this.nullBuffer);
                });
                void (0, core_1.debug)("CLI command succeeded.");
                const stdoutBuffer = Buffer.concat(stdoutBuffers);
                return {
                    exitCode: 0,
                    stdout: stdoutBuffer.toString("utf8", 0, stdoutBuffer.length - 1),
                    stderr: Buffer.concat(stderrBuffers).toString("utf8"),
                };
            }
            catch (err) {
                // Kill the process if it isn't already dead.
                this.killProcessIfRunning();
                if (stderrBuffers.length > 0) {
                    (0, core_1.error)(`Failed to run ${args.join(" ")}:${node_os_1.EOL} ${Buffer.concat(stderrBuffers).toString("utf8")}`);
                }
                throw err;
            }
            finally {
                (0, core_1.debug)(Buffer.concat(stderrBuffers).toString("utf8"));
                // Remove the listeners we set up.
                process.stdout.removeAllListeners("data");
                process.stderr.removeAllListeners("data");
                process.removeAllListeners("close");
            }
        }
        finally {
            this.commandInProcess = false;
            // start running the next command immediately
            this.runNext();
        }
    }
    /**
     * Run the next command in the queue
     */
    runNext() {
        const callback = this.commandQueue.shift();
        if (callback) {
            callback();
        }
    }
    killProcessIfRunning() {
        if (this.process) {
            // Tell the Java CLI server process to shut down.
            (0, core_1.debug)("Sending shutdown request");
            try {
                this.process.stdin.write(JSON.stringify(["shutdown"]), "utf8");
                this.process.stdin.write(this.nullBuffer);
                (0, core_1.debug)("Sent shutdown request");
            }
            catch (e) {
                // We are probably fine here, the process has already closed stdin.
                (0, core_1.debug)(`Shutdown request failed: process stdin may have already closed. The error was ${e}`);
                (0, core_1.debug)("Stopping the process anyway.");
            }
            // Close the stdin and stdout streams.
            // This is important on Windows where the child process may not die cleanly.
            this.process.stdin.end();
            this.process.kill();
            this.process.stdout.destroy();
            this.process.stderr.destroy();
            this.process = undefined;
        }
    }
}
exports.CodeqlCliServer = CodeqlCliServer;
