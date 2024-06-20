import fs from "fs";
import { tmpdir } from "os";
import path from "path";
import { chdir, cwd } from "process";

import { getInput, setFailed, setOutput, setSecret } from "@actions/core";
import { context } from "@actions/github";
import { HTTPError, extractTar } from "@actions/tool-cache";
import JSZip from "jszip";

import { getQueryPackInfo, runQuery, RunQueryResult } from "./codeql";
import { CodeqlCliServer } from "./codeql-cli";
import { setupCodeQLBundle } from "./codeql-setup";
import { download } from "./download";
import {
  setVariantAnalysisFailed,
  setVariantAnalysisRepoInProgress,
  setVariantAnalysisRepoSucceeded,
} from "./gh-api-client";

const shutdownHandlers: Array<() => void> = [];

interface Repo {
  id: number;
  nwo: string;
  downloadUrl?: string;
  pat?: string;
}
async function run(): Promise<void> {
  const controllerRepoId = parseInt(
    getInput("controller_repo_id", { required: true })
  );
  const dbUrl = getInput("db_url");
  const queryPackUrl = getInput("query_pack_url", { required: true });
  const language = getInput("language", { required: true });
  const repo: Repo = {
    id: 1,
    nwo: path.join(context.repo.owner, context.repo.repo),
  };
  const variantAnalysisId = parseInt(
    getInput("variant_analysis_id", { required: true })
  );
  // const instructions = await getInstructions(); // NOTE not needed

  if (repo.downloadUrl) {
    setSecret(repo.downloadUrl);
  }
  if (repo.pat) {
    setSecret(repo.pat);
  }

  let codeqlBundlePath: string | undefined;

  const cliVersion = "2.17.5"; // NOTE hardcoded. (Is this syntax correct?)
  /* NOTE Removed conditional and just setup CodeQL bundle unconditionally */
  codeqlBundlePath = await setupCodeQLBundle(
    process.env.RUNNER_TEMP ?? tmpdir(),
    cliVersion
  );

  let codeqlCmd = path.join(codeqlBundlePath, "codeql", "codeql");
  if (process.platform === "win32") {
    codeqlCmd += ".exe";
  }

  const curDir = cwd();

  let queryPackPath: string;
  try {
    /* Download and extract the query pack. */
    console.log("Getting query pack");
    const queryPackArchive = await download(queryPackUrl, "query_pack.tar.gz");
    queryPackPath = await extractTar(queryPackArchive);
  } catch (e: unknown) {
    console.error(e);
    const errorMessage = e instanceof Error ? e.message : `${e}`;
    if (e instanceof HTTPError && e.httpStatusCode === 403) {
      setFailed(
        `${errorMessage}. The query pack is only available for 24 hours. To retry, create a new variant analysis.`
      );
    } else {
      setFailed(errorMessage);
    }
    // Consider all repos to have failed
    // await setVariantAnalysisFailed(
    //   controllerRepoId,
    //   variantAnalysisId,
    //   repo.id,
    //   errorMessage
    // );
    return;
  }

  const codeqlCli = new CodeqlCliServer(codeqlCmd);

  shutdownHandlers.push(() => {
    codeqlCli.shutdown();
  });

  const codeqlVersionInfo = await codeqlCli.run(["version", "--format=json"]);
  console.log(codeqlVersionInfo.stdout);

  const queryPackInfo = await getQueryPackInfo(codeqlCli, queryPackPath);

  // Create a new directory to contain all files created during analysis of this repo.
  const workDir = createTempRepoDir(curDir, repo);
  // Change into the new directory to further ensure that all created files go in there.
  chdir(workDir);

  try {
    // await setVariantAnalysisRepoInProgress(
    //   controllerRepoId,
    //   variantAnalysisId,
    //   repo.id
    // );

    const dbZip = await download(dbUrl, language);
    const dbZipPath = path.resolve(dbZip);

    console.log(`DB Zip Path 1: ${dbZip}`);
    console.log(`DB Zip Path 2: ${dbZipPath}`);

    const fs = require("node:fs");

    fs.stat(dbZipPath, (err: Error, stats: any) => {
      if (err) {
        console.error(err);
        return;
      }

      console.log(stats.isFile());
      console.log(stats.isDirectory());
      console.log(stats.isSymbolicLink());
      console.log(stats.size);
    });

    console.log("Running query");
    /* ========== Run the analysis ========== */
    const runQueryResult = await runQuery(
      codeqlCli,
      dbZipPath,
      repo.nwo,
      queryPackInfo
    );

    if (runQueryResult.resultCount > 0) {
      const bufferToWrite = await getArtifactContentsForUpload(runQueryResult);
      const pathToSave = path.join(cwd(), "results", "results.zip");
      fs.writeFile(pathToSave, bufferToWrite, (err: Error) => {
        if (err) throw err;
        console.log(`Results saved as ${pathToSave}.`);
      });
      setOutput("results-path", runQueryResult);
    }

    // await setVariantAnalysisRepoSucceeded(
    //   controllerRepoId,
    //   variantAnalysisId,
    //   repo.id,
    //   runQueryResult.sourceLocationPrefix,
    //   runQueryResult.resultCount,
    //   runQueryResult.databaseSHA || "HEAD"
    // );
  } catch (e: any) {
    console.error(e);
    const errorMessage = e instanceof Error ? e.message : `${e}`;
    if (e instanceof HTTPError && e.httpStatusCode === 403) {
      setFailed(
        `${errorMessage}. Database downloads are only available for 24 hours. To retry, create a new variant analysis.`
      );
    } else {
      setFailed(errorMessage);
    }

    // await setVariantAnalysisFailed(
    //   controllerRepoId,
    //   variantAnalysisId,
    //   repo.id,
    //   errorMessage
    // );
  }
  // We can now delete the work dir. All required files have already been uploaded.
  chdir(curDir);
  fs.rmSync(workDir, { recursive: true });
}

/**
 * Creates a temporary directory for a given repository.
 * @param curDir The current directory.
 * @param repo The repository to create a temporary directory for.
 * @returns The path to the temporary directory.
 */
function createTempRepoDir(curDir: string, repo: Repo): string {
  const workDir = fs.mkdtempSync(path.join(curDir, repo.id.toString()));
  return workDir;
}

void run().finally(() => {
  for (const handler of shutdownHandlers) {
    handler();
  }
});

async function getArtifactContentsForUpload(
  runQueryResult: RunQueryResult
): Promise<Buffer> {
  const zip = new JSZip();

  if (runQueryResult.sarifFilePath) {
    const sarifFileContents = fs.createReadStream(runQueryResult.sarifFilePath);
    zip.file("results.sarif", sarifFileContents);
  }

  for (const relativePath of runQueryResult.bqrsFilePaths.relativeFilePaths) {
    const fullPath = path.join(
      runQueryResult.bqrsFilePaths.basePath,
      relativePath
    );
    const bqrsFileContents = fs.createReadStream(fullPath);
    zip.file(relativePath, bqrsFileContents);
  }

  return await zip.generateAsync({
    compression: "DEFLATE",
    type: "nodebuffer",
  });
}
