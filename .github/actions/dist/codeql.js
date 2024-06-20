"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueryPackQueries = exports.getQueryPackInfo = exports.getDatabaseMetadata = exports.getBqrsResultCount = exports.getSarifResultCount = exports.injectVersionControlInfo = exports.getSarifOutputType = exports.getBqrsInfo = exports.downloadDatabase = exports.runQuery = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const deserialize_1 = require("./deserialize");
const download_1 = require("./download");
const http_error_1 = require("./http-error");
const json_validation_1 = require("./json-validation");
const query_run_memory_1 = require("./query-run-memory");
const yaml_1 = require("./yaml");
/**
 * Run a query. Will operate on the current working directory and create the following directories:
 * - query/    (query.ql and any other supporting files)
 * - results/  (results.{bqrs,sarif})
 *
 * @param     codeql                    A runner of the CodeQL CLI to execute commands
 * @param     database                  The path to the bundled database zip file
 * @param     nwo                       The name of the repository
 * @param     queryPackPath             The path to the query pack
 * @returns   Promise<RunQueryResult>   Resolves when the query has finished running. Returns information
 * about the query result and paths to the result files.
 */
async function runQuery(codeql, database, nwo, queryPack) {
    fs_1.default.mkdirSync("results");
    const databasePath = path_1.default.resolve("db");
    await codeql.run([
        "database",
        "unbundle",
        database,
        `--name=${path_1.default.basename(databasePath)}`,
        `--target=${path_1.default.dirname(databasePath)}`,
    ]);
    const dbMetadata = getDatabaseMetadata(databasePath);
    console.log(`This database was created using CodeQL CLI version ${dbMetadata.creationMetadata?.cliVersion}`);
    const databaseSHA = dbMetadata.creationMetadata?.sha?.toString();
    await codeql.run([
        "database",
        "run-queries",
        `--ram=${(0, query_run_memory_1.getMemoryFlagValue)().toString()}`,
        "--additional-packs",
        queryPack.path,
        "--",
        databasePath,
        queryPack.name,
    ]);
    // Calculate query run information like BQRS file paths, etc.
    const queryPackRunResults = await getQueryPackRunResults(codeql, databasePath, queryPack);
    const sourceLocationPrefix = await getSourceLocationPrefix(codeql, databasePath);
    const shouldGenerateSarif = queryPackSupportsSarif(queryPackRunResults);
    let resultCount;
    let sarifFilePath;
    if (shouldGenerateSarif) {
        const sarif = await generateSarif(codeql, nwo, databasePath, queryPack.path, databaseSHA);
        resultCount = getSarifResultCount(sarif);
        sarifFilePath = path_1.default.resolve("results", "results.sarif");
        fs_1.default.writeFileSync(sarifFilePath, JSON.stringify(sarif));
    }
    else {
        resultCount = queryPackRunResults.totalResultsCount;
    }
    const bqrsFilePaths = await adjustBqrsFiles(queryPackRunResults);
    return {
        resultCount,
        databaseSHA,
        sourceLocationPrefix,
        bqrsFilePaths,
        sarifFilePath,
    };
}
exports.runQuery = runQuery;
async function adjustBqrsFiles(queryPackRunResults) {
    if (queryPackRunResults.queries.length === 1) {
        // If we have a single query, move the BQRS file to "results.bqrs" in order to
        // maintain backwards compatibility with the VS Code extension, since it expects
        // the BQRS file to be at the top level and be called "results.bqrs".
        const currentBqrsFilePath = path_1.default.join(queryPackRunResults.resultsBasePath, queryPackRunResults.queries[0].relativeBqrsFilePath);
        const newBqrsFilePath = path_1.default.resolve("results", "results.bqrs");
        await fs_1.default.promises.rename(currentBqrsFilePath, newBqrsFilePath);
        return { basePath: "results", relativeFilePaths: ["results.bqrs"] };
    }
    return {
        basePath: queryPackRunResults.resultsBasePath,
        relativeFilePaths: queryPackRunResults.queries.map((q) => q.relativeBqrsFilePath),
    };
}
async function downloadDatabase(repoId, repoName, language, pat) {
    let authHeader = undefined;
    if (pat) {
        authHeader = `token ${pat}`;
    }
    try {
        return await (0, download_1.download)(`${process.env.GITHUB_API_URL || "https://api.github.com"}/repos/${repoName}/code-scanning/codeql/databases/${language}`, `${repoId}.zip`, authHeader, "application/zip");
    }
    catch (error) {
        console.log("Error while downloading database");
        if (error instanceof http_error_1.HTTPError &&
            error.httpStatusCode === 404 &&
            error.httpMessage.includes("No database available for")) {
            throw new Error(`Language mismatch: The query targets ${language}, but the repository "${repoName}" has no CodeQL database available for that language.`);
        }
        else {
            throw error;
        }
    }
}
exports.downloadDatabase = downloadDatabase;
// Calls `resolve metadata` for the given query file and returns JSON output
async function getQueryMetadata(codeql, query) {
    const queryMetadataOutput = await codeql.run([
        "resolve",
        "metadata",
        "--format=json",
        query,
    ]);
    if (queryMetadataOutput.exitCode !== 0) {
        throw new Error(`Unable to run codeql resolve metadata. Exit code: ${queryMetadataOutput.exitCode}`);
    }
    return (0, json_validation_1.validateObject)(JSON.parse(queryMetadataOutput.stdout, deserialize_1.camelize), "queryMetadata");
}
// Calls `bqrs info` for the given bqrs file and returns JSON output
async function getBqrsInfo(codeql, bqrs) {
    const bqrsInfoOutput = await codeql.run([
        "bqrs",
        "info",
        "--format=json",
        bqrs,
    ]);
    if (bqrsInfoOutput.exitCode !== 0) {
        throw new Error(`Unable to run codeql bqrs info. Exit code: ${bqrsInfoOutput.exitCode}`);
    }
    return (0, json_validation_1.validateObject)(JSON.parse(bqrsInfoOutput.stdout, deserialize_1.camelize), "bqrsInfo");
}
exports.getBqrsInfo = getBqrsInfo;
async function getSourceLocationPrefix(codeql, databasePath) {
    const resolveDbOutput = await codeql.run([
        "resolve",
        "database",
        databasePath,
    ]);
    const resolvedDatabase = (0, json_validation_1.validateObject)(JSON.parse(resolveDbOutput.stdout), "resolvedDatabase");
    return resolvedDatabase.sourceLocationPrefix;
}
async function getQueryPackRunResults(codeql, databasePath, queryPack) {
    // This is where results are saved, according to
    // https://codeql.github.com/docs/codeql-cli/manual/database-run-queries/
    const resultsBasePath = path_1.default.resolve(databasePath, "results");
    const queries = [];
    let totalResultsCount = 0;
    for (const [queryPath, queryMetadata] of Object.entries(queryPack.queries)) {
        // Calculate the BQRS file path
        const queryPackRelativePath = path_1.default.relative(queryPack.path, queryPath);
        const parsedQueryPath = path_1.default.parse(queryPackRelativePath);
        const relativeBqrsFilePath = path_1.default.join(queryPack.name, parsedQueryPath.dir, `${parsedQueryPath.name}.bqrs`);
        const bqrsFilePath = path_1.default.join(resultsBasePath, relativeBqrsFilePath);
        if (!fs_1.default.existsSync(bqrsFilePath)) {
            throw new Error(`Could not find BQRS file for query ${queryPath} at ${bqrsFilePath}`);
        }
        const bqrsInfo = await getBqrsInfo(codeql, bqrsFilePath);
        queries.push({
            queryPath,
            queryMetadata,
            relativeBqrsFilePath,
            bqrsInfo,
        });
        totalResultsCount += getBqrsResultCount(bqrsInfo);
    }
    return {
        totalResultsCount,
        resultsBasePath,
        queries,
    };
}
function querySupportsSarif(queryMetadata, bqrsInfo) {
    const sarifOutputType = getSarifOutputType(queryMetadata, bqrsInfo.compatibleQueryKinds);
    return sarifOutputType !== undefined;
}
/**
 * All queries in the pack must support SARIF in order
 * for the query pack to support SARIF.
 */
function queryPackSupportsSarif(queriesResultInfo) {
    return queriesResultInfo.queries.every((q) => querySupportsSarif(q.queryMetadata, q.bqrsInfo));
}
/**
 * Checks if the query kind is compatible with SARIF output.
 */
function getSarifOutputType(queryMetadata, compatibleQueryKinds) {
    const queryKind = queryMetadata.kind;
    if (
    // path-alert is an alias of path-problem
    (queryKind === "path-problem" || queryKind === "path-alert") &&
        compatibleQueryKinds.includes("PathProblem")) {
        return "path-problem";
    }
    else if (
    // alert is an alias of problem
    (queryKind === "problem" || queryKind === "alert") &&
        compatibleQueryKinds.includes("Problem")) {
        return "problem";
    }
    else {
        return undefined;
    }
}
exports.getSarifOutputType = getSarifOutputType;
// Generates sarif from the given bqrs file, if query kind supports it
async function generateSarif(codeql, nwo, databasePath, queryPackPath, databaseSHA) {
    const sarifFile = path_1.default.resolve("results", "results.sarif");
    await codeql.run([
        "database",
        "interpret-results",
        "--format=sarif-latest",
        `--output=${sarifFile}`,
        "--sarif-add-snippets",
        "--no-group-results",
        databasePath,
        queryPackPath,
    ]);
    const sarif = (0, json_validation_1.validateObject)(JSON.parse(fs_1.default.readFileSync(sarifFile, "utf8")), "sarif");
    injectVersionControlInfo(sarif, nwo, databaseSHA);
    return sarif;
}
/**
 * Injects the GitHub repository URL and, if available, the commit SHA into the
 * SARIF `versionControlProvenance` property.
 */
function injectVersionControlInfo(sarif, nwo, databaseSHA) {
    for (const run of sarif.runs) {
        run.versionControlProvenance = run.versionControlProvenance || [];
        const repositoryUri = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${nwo}`;
        if (databaseSHA) {
            run.versionControlProvenance.push({
                repositoryUri,
                revisionId: databaseSHA,
            });
        }
        else {
            run.versionControlProvenance.push({
                repositoryUri,
            });
        }
    }
}
exports.injectVersionControlInfo = injectVersionControlInfo;
/**
 * Gets the number of results in the given SARIF data.
 */
function getSarifResultCount(sarif) {
    let count = 0;
    for (const run of sarif.runs) {
        count = count + run.results.length;
    }
    return count;
}
exports.getSarifResultCount = getSarifResultCount;
/**
 * Names of result sets that can be considered the "default" result set
 * and should be used when calculating number of results and when showing
 * results to users.
 * Will check result sets in this order and use the first one that exists.
 */
const KNOWN_RESULT_SET_NAMES = ["#select", "problems"];
/**
 * Gets the number of results in the given BQRS data.
 */
function getBqrsResultCount(bqrsInfo) {
    for (const name of KNOWN_RESULT_SET_NAMES) {
        const resultSet = bqrsInfo.resultSets.find((r) => r.name === name);
        if (resultSet !== undefined) {
            return resultSet.rows;
        }
    }
    const resultSetNames = bqrsInfo.resultSets.map((r) => r.name);
    throw new Error(`BQRS does not contain any result sets matching known names. Expected one of ${KNOWN_RESULT_SET_NAMES.join(" or ")} but found ${resultSetNames.join(", ")}`);
}
exports.getBqrsResultCount = getBqrsResultCount;
/**
 * Gets (a subset of) the database metadata from a CodeQL database. In the
 * future this information may be available using `codeql resolve database`
 * instead. Because this information is only used for enhancing the output we
 * catch errors for now. The caller must decide what to do in the case of
 * missing information.
 *
 * @param databasePath The path to the database.
 * @returns The database metadata.
 */
function getDatabaseMetadata(databasePath) {
    try {
        return (0, yaml_1.parseYamlFromFile)(path_1.default.join(databasePath, "codeql-database.yml"));
    }
    catch (error) {
        console.log(`Unable to read codeql-database.yml: ${error}`);
        return {};
    }
}
exports.getDatabaseMetadata = getDatabaseMetadata;
async function getQueryPackInfo(codeql, queryPackPath) {
    queryPackPath = path_1.default.resolve(queryPackPath);
    const name = getQueryPackName(queryPackPath);
    const queryPaths = await getQueryPackQueries(codeql, queryPackPath, name);
    const queries = {};
    for (const queryPath of queryPaths) {
        const queryMetadata = await getQueryMetadata(codeql, queryPath);
        queries[queryPath] = queryMetadata;
    }
    return {
        path: queryPackPath,
        name,
        queries,
    };
}
exports.getQueryPackInfo = getQueryPackInfo;
/**
 * Gets the queries for a pack.
 *
 * @param codeql The path to the codeql CLI
 * @param queryPackPath The path to the query pack on disk.
 * @returns The path to a query file.
 */
async function getQueryPackQueries(codeql, queryPackPath, queryPackName) {
    const output = await codeql.run([
        "resolve",
        "queries",
        "--format=json",
        "--additional-packs",
        queryPackPath,
        queryPackName,
    ]);
    return (0, json_validation_1.validateObject)(JSON.parse(output.stdout), "resolvedQueries");
}
exports.getQueryPackQueries = getQueryPackQueries;
function getQueryPackName(queryPackPath) {
    const qlpackFile = path_1.default.join(queryPackPath, "qlpack.yml");
    const codeqlpackFile = path_1.default.join(queryPackPath, "codeql-pack.yml");
    let packFile;
    if (fs_1.default
        .statSync(qlpackFile, {
        throwIfNoEntry: false,
    })
        ?.isFile()) {
        packFile = qlpackFile;
    }
    else if (fs_1.default
        .statSync(codeqlpackFile, {
        throwIfNoEntry: false,
    })
        ?.isFile()) {
        packFile = codeqlpackFile;
    }
    else {
        throw new Error(`Path '${queryPackPath}' is missing a qlpack file.`);
    }
    const packContents = (0, yaml_1.parseYamlFromFile)(packFile);
    return packContents.name;
}
