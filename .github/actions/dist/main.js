"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const os_1 = require("os");
const path_1 = __importDefault(require("path"));
const process_1 = require("process");
const core_1 = require("@actions/core");
const github_1 = require("@actions/github");
const tool_cache_1 = require("@actions/tool-cache");
const jszip_1 = __importDefault(require("jszip"));
const codeql_1 = require("./codeql");
const codeql_cli_1 = require("./codeql-cli");
const codeql_setup_1 = require("./codeql-setup");
const download_1 = require("./download");
const gh_api_client_1 = require("./gh-api-client");
const shutdownHandlers = [];
async function run() {
    const controllerRepoId = parseInt((0, core_1.getInput)("controller_repo_id", { required: true }));
    const dbUrl = (0, core_1.getInput)("db_url");
    const queryPackUrl = (0, core_1.getInput)("query_pack_url", { required: true });
    const language = (0, core_1.getInput)("language", { required: true });
    const repo = {
        id: 1,
        nwo: path_1.default.join(github_1.context.repo.owner, github_1.context.repo.repo),
    };
    const variantAnalysisId = parseInt((0, core_1.getInput)("variant_analysis_id", { required: true }));
    // const instructions = await getInstructions(); // NOTE not needed
    if (repo.downloadUrl) {
        (0, core_1.setSecret)(repo.downloadUrl);
    }
    if (repo.pat) {
        (0, core_1.setSecret)(repo.pat);
    }
    let codeqlBundlePath;
    const cliVersion = "2.17.5"; // NOTE hardcoded. (Is this syntax correct?)
    /* NOTE Removed conditional and just setup CodeQL bundle unconditionally */
    codeqlBundlePath = await (0, codeql_setup_1.setupCodeQLBundle)(process.env.RUNNER_TEMP ?? (0, os_1.tmpdir)(), cliVersion);
    let codeqlCmd = path_1.default.join(codeqlBundlePath, "codeql", "codeql");
    if (process.platform === "win32") {
        codeqlCmd += ".exe";
    }
    const curDir = (0, process_1.cwd)();
    let queryPackPath;
    try {
        /* Download and extract the query pack. */
        console.log("Getting query pack");
        const queryPackArchive = await (0, download_1.download)(queryPackUrl, "query_pack.tar.gz");
        queryPackPath = await (0, tool_cache_1.extractTar)(queryPackArchive);
    }
    catch (e) {
        console.error(e);
        const errorMessage = e instanceof Error ? e.message : `${e}`;
        if (e instanceof tool_cache_1.HTTPError && e.httpStatusCode === 403) {
            (0, core_1.setFailed)(`${errorMessage}. The query pack is only available for 24 hours. To retry, create a new variant analysis.`);
        }
        else {
            (0, core_1.setFailed)(errorMessage);
        }
        // Consider all repos to have failed
        await (0, gh_api_client_1.setVariantAnalysisFailed)(controllerRepoId, variantAnalysisId, repo.id, errorMessage);
        return;
    }
    const codeqlCli = new codeql_cli_1.CodeqlCliServer(codeqlCmd);
    shutdownHandlers.push(() => {
        codeqlCli.shutdown();
    });
    const codeqlVersionInfo = await codeqlCli.run(["version", "--format=json"]);
    console.log(codeqlVersionInfo.stdout);
    const queryPackInfo = await (0, codeql_1.getQueryPackInfo)(codeqlCli, queryPackPath);
    // Create a new directory to contain all files created during analysis of this repo.
    const workDir = createTempRepoDir(curDir, repo);
    // Change into the new directory to further ensure that all created files go in there.
    (0, process_1.chdir)(workDir);
    try {
        await (0, gh_api_client_1.setVariantAnalysisRepoInProgress)(controllerRepoId, variantAnalysisId, repo.id);
        const dbZip = await (0, download_1.download)(dbUrl, language);
        const dbZipPath = path_1.default.resolve(dbZip);
        console.log("Running query");
        /* ========== Run the analysis ========== */
        const runQueryResult = await (0, codeql_1.runQuery)(codeqlCli, dbZipPath, repo.nwo, queryPackInfo);
        if (runQueryResult.resultCount > 0) {
            const bufferToWrite = await getArtifactContentsForUpload(runQueryResult);
            const pathToSave = path_1.default.join((0, process_1.cwd)(), "results", "results.zip");
            fs_1.default.writeFile(pathToSave, bufferToWrite, (err) => {
                if (err)
                    throw err;
                console.log(`Results saved as ${pathToSave}.`);
            });
            (0, core_1.setOutput)("results-path", runQueryResult);
        }
        await (0, gh_api_client_1.setVariantAnalysisRepoSucceeded)(controllerRepoId, variantAnalysisId, repo.id, runQueryResult.sourceLocationPrefix, runQueryResult.resultCount, runQueryResult.databaseSHA || "HEAD");
    }
    catch (e) {
        console.error(e);
        const errorMessage = e instanceof Error ? e.message : `${e}`;
        if (e instanceof tool_cache_1.HTTPError && e.httpStatusCode === 403) {
            (0, core_1.setFailed)(`${errorMessage}. Database downloads are only available for 24 hours. To retry, create a new variant analysis.`);
        }
        else {
            (0, core_1.setFailed)(errorMessage);
        }
        await (0, gh_api_client_1.setVariantAnalysisFailed)(controllerRepoId, variantAnalysisId, repo.id, errorMessage);
    }
    // We can now delete the work dir. All required files have already been uploaded.
    (0, process_1.chdir)(curDir);
    fs_1.default.rmSync(workDir, { recursive: true });
}
/**
 * Creates a temporary directory for a given repository.
 * @param curDir The current directory.
 * @param repo The repository to create a temporary directory for.
 * @returns The path to the temporary directory.
 */
function createTempRepoDir(curDir, repo) {
    const workDir = fs_1.default.mkdtempSync(path_1.default.join(curDir, repo.id.toString()));
    return workDir;
}
void run().finally(() => {
    for (const handler of shutdownHandlers) {
        handler();
    }
});
async function getArtifactContentsForUpload(runQueryResult) {
    const zip = new jszip_1.default();
    if (runQueryResult.sarifFilePath) {
        const sarifFileContents = fs_1.default.createReadStream(runQueryResult.sarifFilePath);
        zip.file("results.sarif", sarifFileContents);
    }
    for (const relativePath of runQueryResult.bqrsFilePaths.relativeFilePaths) {
        const fullPath = path_1.default.join(runQueryResult.bqrsFilePaths.basePath, relativePath);
        const bqrsFileContents = fs_1.default.createReadStream(fullPath);
        zip.file(relativePath, bqrsFileContents);
    }
    return await zip.generateAsync({
        compression: "DEFLATE",
        type: "nodebuffer",
    });
}
