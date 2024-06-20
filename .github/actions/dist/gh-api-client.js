"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setVariantAnalysisFailed = exports.setVariantAnalysisRepoSucceeded = exports.setVariantAnalysisRepoInProgress = exports.userAgent = void 0;
/* eslint-disable @typescript-eslint/naming-convention */
const action_1 = require("@octokit/action");
exports.userAgent = "GitHub multi-repository variant analysis action";
async function setVariantAnalysisRepoInProgress(controllerRepoId, variantAnalysisId, repoId) {
    await updateVariantAnalysisStatus(controllerRepoId, variantAnalysisId, repoId, {
        status: "in_progress",
    });
}
exports.setVariantAnalysisRepoInProgress = setVariantAnalysisRepoInProgress;
async function setVariantAnalysisRepoSucceeded(controllerRepoId, variantAnalysisId, repoId, sourceLocationPrefix, resultCount, databaseCommitSha) {
    await updateVariantAnalysisStatus(controllerRepoId, variantAnalysisId, repoId, {
        status: "succeeded",
        source_location_prefix: sourceLocationPrefix,
        result_count: resultCount,
        database_commit_sha: databaseCommitSha,
    });
}
exports.setVariantAnalysisRepoSucceeded = setVariantAnalysisRepoSucceeded;
async function setVariantAnalysisFailed(controllerRepoId, variantAnalysisId, repoId, failureMessage) {
    await updateVariantAnalysisStatus(controllerRepoId, variantAnalysisId, repoId, {
        status: "failed",
        failure_message: failureMessage,
    });
}
exports.setVariantAnalysisFailed = setVariantAnalysisFailed;
async function updateVariantAnalysisStatus(controllerRepoId, variantAnalysisId, repoId, data) {
    const octokit = new action_1.Octokit();
    const url = `PATCH /repositories/${controllerRepoId}/code-scanning/codeql/variant-analyses/${variantAnalysisId}/repositories/${repoId}/status`;
    await octokit.request(url, { data });
}
