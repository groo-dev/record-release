import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { DefaultArtifactClient } from '@actions/artifact';
import { DeploymentResponse, ErrorResponse, SessionData } from './types';

import { randomUUID } from 'crypto';

const SESSION_ARTIFACT_NAME = 'record-release-session';
const ARTIFACTS_ARTIFACT_PREFIX = 'record-release-artifacts-';
const SESSION_FILE_PATH = '/tmp/record-release-session.json';

function generateArtifactName(): string {
  return `${ARTIFACTS_ARTIFACT_PREFIX}${randomUUID()}`;
}

async function uploadSession(sessionData: SessionData): Promise<void> {
  const artifact = new DefaultArtifactClient();

  // Write session to temp file
  const sessionDir = path.dirname(SESSION_FILE_PATH);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const sessionFile = path.join(sessionDir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));

  core.info('Uploading session artifact...');

  await artifact.uploadArtifact(SESSION_ARTIFACT_NAME, [sessionFile], sessionDir);

  core.info(`Session uploaded: version=${sessionData.version}, environment=${sessionData.environment}`);
}

async function uploadArtifactsToStorage(patterns: string): Promise<void> {
  const artifact = new DefaultArtifactClient();

  const patternList = patterns.split('\n').map(p => p.trim()).filter(p => p);
  const filesToUpload: string[] = [];

  for (const pattern of patternList) {
    const files = await glob(pattern);
    if (files.length === 0) {
      core.warning(`No files matched pattern: ${pattern}`);
    } else {
      filesToUpload.push(...files);
    }
  }

  if (filesToUpload.length === 0) {
    core.warning('No artifacts found to upload');
    return;
  }

  core.info(`Uploading ${filesToUpload.length} artifact(s) to storage...`);

  const rootDir = process.cwd();
  const artifactName = generateArtifactName();

  await artifact.uploadArtifact(artifactName, filesToUpload, rootDir);
  core.info(`Uploaded to artifact: ${artifactName}`);

  core.info('Artifacts uploaded successfully');
  for (const file of filesToUpload) {
    core.info(`  - ${path.basename(file)}`);
  }
}

interface ReleaseOptions {
  githubToken: string;
  tag: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  artifacts?: string;
}

async function createGithubRelease(options: ReleaseOptions): Promise<void> {
  const { githubToken, tag, body, draft, prerelease, artifacts } = options;
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  core.info(`Creating GitHub release: ${tag}`);

  try {
    // Create the release
    const release = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
      name: tag,
      body: body || undefined,
      draft: draft || false,
      prerelease: prerelease || false,
      generate_release_notes: !body, // Only auto-generate if no custom body
    });

    core.info(`GitHub release created: ${release.data.html_url}`);

    // Upload artifacts if specified
    if (artifacts) {
      const patterns = artifacts.split('\n').map(p => p.trim()).filter(p => p);

      for (const pattern of patterns) {
        const files = await glob(pattern);

        if (files.length === 0) {
          core.warning(`No files matched pattern: ${pattern}`);
          continue;
        }

        for (const file of files) {
          const fileName = path.basename(file);
          const fileContent = fs.readFileSync(file);

          core.info(`Uploading artifact: ${fileName}`);

          await octokit.rest.repos.uploadReleaseAsset({
            owner,
            repo,
            release_id: release.data.id,
            name: fileName,
            data: fileContent as unknown as string,
          });
        }
      }
    }

  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Failed to create GitHub release: ${error.message}`);
    }
  }
}

async function run(): Promise<void> {
  try {
    // Check if we should skip
    const skip = core.getState('skip');
    if (skip === 'true') {
      core.info('Skipping post run');
      return;
    }

    // Check mode
    const mode = core.getState('mode');

    // Mode: Upload session (for dry-run/init in multi-job workflow)
    if (mode === 'upload-session') {
      const sessionJson = core.getState('session');
      if (sessionJson) {
        const sessionData = JSON.parse(sessionJson) as SessionData;
        await uploadSession(sessionData);
      }

      // Also upload artifacts if specified
      const artifacts = core.getState('artifacts');
      if (artifacts) {
        await uploadArtifactsToStorage(artifacts);
      }
      return;
    }

    // Mode: Upload artifacts only (for parallel build jobs)
    if (mode === 'upload-artifacts') {
      const artifacts = core.getState('artifacts');
      if (artifacts) {
        await uploadArtifactsToStorage(artifacts);
      }
      return;
    }

    // Mode: Record release and create GitHub release (single job)
    const token = core.getState('token');
    const apiUrl = core.getState('apiUrl');
    const environment = core.getState('environment');
    const version = core.getState('version');
    const applicationName = core.getState('applicationName');
    const commitHash = core.getState('commitHash');
    const commitMessage = core.getState('commitMessage');
    const deployedBy = core.getState('deployedBy');
    const skipGithubRelease = core.getState('skipGithubRelease') === 'true';
    const releasePrefix = core.getState('releasePrefix');
    const githubToken = core.getState('githubToken');
    const body = core.getState('body');
    const draft = core.getState('draft') === 'true';
    const prerelease = core.getState('prerelease') === 'true';
    const artifacts = core.getState('artifacts');

    if (!token || !version) {
      core.info('No state found, skipping post run');
      return;
    }

    // Construct git tag
    const prefix = releasePrefix || applicationName;
    const gitTag = `${prefix}-v${version}`;

    core.info(`Recording release ${version} to ${environment}...`);

    // Record release to Groo Ops
    const response = await fetch(`${apiUrl}/webhook/deploy`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        environment,
        version,
        commitHash,
        commitMessage,
        deployedBy,
        gitTag,
      }),
    });

    const data = await response.json() as DeploymentResponse | ErrorResponse;

    if (!response.ok) {
      const error = data as ErrorResponse;
      throw new Error(`API error (${error.code}): ${error.error}`);
    }

    const result = data as DeploymentResponse;

    core.info(`Release recorded!`);
    core.info(`  Application: ${result.deployment.applicationName}`);
    core.info(`  Version: ${result.deployment.version}`);
    core.info(`  Environment: ${result.deployment.environment}`);
    core.info(`  Tag: ${gitTag}`);

    // Create GitHub release
    if (!skipGithubRelease && githubToken) {
      await createGithubRelease({
        githubToken,
        tag: gitTag,
        body: body || undefined,
        draft,
        prerelease,
        artifacts,
      });
    }

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();
