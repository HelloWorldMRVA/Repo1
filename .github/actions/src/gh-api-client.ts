/* eslint-disable @typescript-eslint/naming-convention */
import { Octokit } from "@octokit/action";
import { RequestError } from "@octokit/types";

export const userAgent = "GitHub multi-repository variant analysis action";

interface InProgressAnalysis {
  status: "in_progress";
}

interface SuccessfulAnalysis {
  status: "succeeded";
  source_location_prefix: string;
  result_count: number;
  database_commit_sha: string;
}

interface FailedAnalysis {
  status: "failed";
  failure_message: string;
}

interface CanceledAnalysis {
  status: "canceled";
}

type UpdateVariantAnalysis =
  | InProgressAnalysis
  | SuccessfulAnalysis
  | FailedAnalysis
  | CanceledAnalysis;

export async function setVariantAnalysisRepoInProgress(
  controllerRepoId: number,
  variantAnalysisId: number,
  repoId: number
): Promise<void> {
  await updateVariantAnalysisStatus(
    controllerRepoId,
    variantAnalysisId,
    repoId,
    {
      status: "in_progress",
    }
  );
}

export async function setVariantAnalysisRepoSucceeded(
  controllerRepoId: number,
  variantAnalysisId: number,
  repoId: number,
  sourceLocationPrefix: string,
  resultCount: number,
  databaseCommitSha: string
): Promise<void> {
  await updateVariantAnalysisStatus(
    controllerRepoId,
    variantAnalysisId,
    repoId,
    {
      status: "succeeded",
      source_location_prefix: sourceLocationPrefix,
      result_count: resultCount,
      database_commit_sha: databaseCommitSha,
    }
  );
}

export async function setVariantAnalysisFailed(
  controllerRepoId: number,
  variantAnalysisId: number,
  repoId: number,
  failureMessage: string
): Promise<void> {
  await updateVariantAnalysisStatus(
    controllerRepoId,
    variantAnalysisId,
    repoId,
    {
      status: "failed",
      failure_message: failureMessage,
    }
  );
}

async function updateVariantAnalysisStatus(
  controllerRepoId: number,
  variantAnalysisId: number,
  repoId: number,
  data: UpdateVariantAnalysis
): Promise<void> {
  const octokit = new Octokit();

  const url = `PATCH /repositories/${controllerRepoId}/code-scanning/codeql/variant-analyses/${variantAnalysisId}/repositories/${repoId}/status`;
  await octokit.request(url, { data });
}
