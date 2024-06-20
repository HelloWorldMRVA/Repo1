"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupCodeQLBundle = void 0;
const path_1 = require("path");
const perf_hooks_1 = require("perf_hooks");
const core_1 = require("@actions/core");
const io_1 = require("@actions/io");
const tool_cache_1 = require("@actions/tool-cache");
const uuid_1 = require("uuid");
function getCodeQLBundleName() {
    let platform;
    if (process.platform === "win32") {
        platform = "win64";
    }
    else if (process.platform === "linux") {
        platform = "linux64";
    }
    else if (process.platform === "darwin") {
        platform = "osx64";
    }
    else {
        return "codeql-bundle.tar.gz";
    }
    return `codeql-bundle-${platform}.tar.gz`;
}
/**
 * Returns the path to the CodeQL bundle after finding or downloading it.
 *
 * @param tempDir A temporary directory to download the bundle to.
 * @param cliVersion The version of the CLI to use.
 */
async function setupCodeQLBundle(tempDir, cliVersion) {
    const source = getCodeQLSource(cliVersion);
    let codeqlFolder;
    switch (source.sourceType) {
        case "toolcache":
            codeqlFolder = source.codeqlFolder;
            (0, core_1.debug)(`CodeQL found in cache ${codeqlFolder}`);
            break;
        case "download": {
            codeqlFolder = await downloadCodeQL(cliVersion, source.codeqlURL, tempDir);
            break;
        }
    }
    return codeqlFolder;
}
exports.setupCodeQLBundle = setupCodeQLBundle;
/**
 * Determine where to find the CodeQL tools. This will check the tool cache
 * first, and if the tools are not found there, it will provide a download
 * URL for the tools.
 *
 * @param cliVersion The CLI version of the CodeQL bundle to find
 */
function getCodeQLSource(cliVersion) {
    // If we find the specified CLI version, we always use that.
    const codeqlFolder = (0, tool_cache_1.find)("CodeQL", cliVersion);
    if (codeqlFolder) {
        (0, core_1.info)(`Found CodeQL tools version ${cliVersion} in the toolcache.`);
        return {
            codeqlFolder,
            sourceType: "toolcache",
        };
    }
    (0, core_1.info)(`Did not find CodeQL tools version ${cliVersion} in the toolcache.`);
    /** Tag name of the CodeQL bundle, for example `codeql-bundle-v2.17.1`. */
    const tagName = `codeql-bundle-v${cliVersion}`;
    const url = `https://github.com/github/codeql-action/releases/download/${tagName}/${getCodeQLBundleName()}`;
    return {
        codeqlURL: url,
        sourceType: "download",
    };
}
/**
 * @param cliVersion The CLI version of the CodeQL bundle to download
 * @param codeqlURL The URL to download the CodeQL bundle from
 * @param tempDir The temporary directory to download the CodeQL bundle to
 * @return the path to the downloaded CodeQL tools folder
 */
async function downloadCodeQL(cliVersion, codeqlURL, tempDir) {
    const headers = {
        accept: "application/octet-stream",
    };
    (0, core_1.info)(`Downloading CodeQL tools from ${codeqlURL} . This may take a while.`);
    const dest = (0, path_1.join)(tempDir, (0, uuid_1.v4)());
    const finalHeaders = Object.assign(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    { "User-Agent": "CodeQL Variant Analysis Action" }, headers);
    const toolsDownloadStart = perf_hooks_1.performance.now();
    const archivedBundlePath = await (0, tool_cache_1.downloadTool)(codeqlURL, dest, undefined, finalHeaders);
    const toolsDownloadDurationMs = Math.round(perf_hooks_1.performance.now() - toolsDownloadStart);
    (0, core_1.debug)(`Finished downloading CodeQL bundle to ${archivedBundlePath} (${toolsDownloadDurationMs} ms).`);
    (0, core_1.debug)("Extracting CodeQL bundle.");
    const extractionStart = perf_hooks_1.performance.now();
    const extractedBundlePath = await (0, tool_cache_1.extractTar)(archivedBundlePath);
    const extractionMs = Math.round(perf_hooks_1.performance.now() - extractionStart);
    (0, core_1.debug)(`Finished extracting CodeQL bundle to ${extractedBundlePath} (${extractionMs} ms).`);
    await (0, io_1.rmRF)(archivedBundlePath);
    (0, core_1.debug)("Caching CodeQL bundle.");
    const toolcachedBundlePath = await (0, tool_cache_1.cacheDir)(extractedBundlePath, "CodeQL", cliVersion);
    // Defensive check: we expect `cacheDir` to copy the bundle to a new location.
    if (toolcachedBundlePath !== extractedBundlePath) {
        await (0, io_1.rmRF)(extractedBundlePath);
    }
    return toolcachedBundlePath;
}
