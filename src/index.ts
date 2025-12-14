import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { DefaultArtifactClient } from '@actions/artifact';
import {
  DeploymentResponse,
  DryRunResponse,
  VersionResponse,
  ErrorResponse,
  SessionData,
} from './types';

const SESSION_ARTIFACT_NAME = 'record-release-session';
const ARTIFACTS_ARTIFACT_NAME = 'record-release-artifacts';
const SESSION_DOWNLOAD_PATH = '/tmp/record-release-session';
const ARTIFACTS_DOWNLOAD_PATH = '/tmp/record-release-artifacts';

async function downloadSession(): Promise<SessionData | null> {
  const artifact = new DefaultArtifactClient();

  try {
    const { artifacts } = await artifact.listArtifacts();
    const sessionArtifact = artifacts.find(a => a.name === SESSION_ARTIFACT_NAME);

    if (!sessionArtifact) {
      core.debug('No session artifact found');
      return null;
    }

    core.info('Downloading session from previous job...');

    if (fs.existsSync(SESSION_DOWNLOAD_PATH)) {
      fs.rmSync(SESSION_DOWNLOAD_PATH, { recursive: true });
    }

    const { downloadPath } = await artifact.downloadArtifact(sessionArtifact.id, {
      path: SESSION_DOWNLOAD_PATH,
    });

    if (!downloadPath) {
      core.warning('Failed to download session artifact');
      return null;
    }

    const sessionFile = path.join(downloadPath, 'session.json');
    if (!fs.existsSync(sessionFile)) {
      core.warning('Session file not found in artifact');
      return null;
    }

    const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf-8')) as SessionData;
    core.info(`Session loaded: version=${sessionData.version}, environment=${sessionData.environment}`);

    return sessionData;
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Failed to download session: ${error.message}`);
    }
    return null;
  }
}

async function downloadStoredArtifacts(): Promise<string[]> {
  const artifact = new DefaultArtifactClient();

  try {
    const { artifacts } = await artifact.listArtifacts();
    const buildArtifact = artifacts.find(a => a.name === ARTIFACTS_ARTIFACT_NAME);

    if (!buildArtifact) {
      core.debug('No stored artifacts found');
      return [];
    }

    core.info('Downloading stored artifacts from previous job...');

    if (fs.existsSync(ARTIFACTS_DOWNLOAD_PATH)) {
      fs.rmSync(ARTIFACTS_DOWNLOAD_PATH, { recursive: true });
    }

    const { downloadPath } = await artifact.downloadArtifact(buildArtifact.id, {
      path: ARTIFACTS_DOWNLOAD_PATH,
    });

    if (!downloadPath) {
      core.debug('Failed to download artifacts');
      return [];
    }

    const files = await glob(`${downloadPath}/**/*`, { nodir: true });
    core.info(`Downloaded ${files.length} artifact(s)`);

    return files;
  } catch (error) {
    if (error instanceof Error) {
      core.debug(`Failed to download artifacts: ${error.message}`);
    }
    return [];
  }
}

interface ReleaseOptions {
  githubToken: string;
  tag: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  artifacts?: string;
  artifactFiles?: string[];
}

async function createGithubRelease(options: ReleaseOptions): Promise<void> {
  const { githubToken, tag, body, draft, prerelease, artifacts, artifactFiles } = options;
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

    // Collect all files to upload
    const filesToUpload: string[] = [];

    // Add files from glob patterns
    if (artifacts) {
      const patterns = artifacts.split('\n').map(p => p.trim()).filter(p => p);
      for (const pattern of patterns) {
        const files = await glob(pattern);
        if (files.length === 0) {
          core.warning(`No files matched pattern: ${pattern}`);
        } else {
          filesToUpload.push(...files);
        }
      }
    }

    // Add pre-resolved files (from artifact storage)
    if (artifactFiles) {
      filesToUpload.push(...artifactFiles);
    }

    // Upload all files
    for (const file of filesToUpload) {
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

  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Failed to create GitHub release: ${error.message}`);
    }
  }
}

async function recordRelease(
  apiUrl: string,
  token: string,
  body: Record<string, unknown>
): Promise<DeploymentResponse> {
  const response = await fetch(`${apiUrl}/webhook/deploy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json() as DeploymentResponse | ErrorResponse;

  if (!response.ok) {
    const error = data as ErrorResponse;
    throw new Error(`API error (${error.code}): ${error.error}`);
  }

  return data as DeploymentResponse;
}

async function run(): Promise<void> {
  try {
    // Get inputs (environment and token not required - depends on mode)
    const token = core.getInput('token');
    const environment = core.getInput('environment');
    const version = core.getInput('version');
    const bump = core.getInput('bump') || 'patch';
    const apiUrl = core.getInput('api-url');
    const dryRun = core.getInput('dry-run') === 'true';
    const getVersion = core.getInput('get-version') === 'true';
    const skipGithubRelease = core.getInput('skip-github-release') === 'true';
    const releasePrefix = core.getInput('release-prefix');
    const githubToken = core.getInput('github-token');

    // GitHub release options
    const body = core.getInput('body');
    const bodyFile = core.getInput('body-file');
    const draft = core.getInput('draft') === 'true';
    const prerelease = core.getInput('prerelease') === 'true';
    const artifacts = core.getInput('artifacts');

    // Get release body from file if specified
    let releaseBody = body;
    if (!releaseBody && bodyFile) {
      try {
        releaseBody = fs.readFileSync(bodyFile, 'utf-8');
      } catch (error) {
        core.warning(`Failed to read body file: ${bodyFile}`);
      }
    }

    const commitHash = core.getInput('commit-hash') || github.context.sha;
    const commitMessage = core.getInput('commit-message') ||
      github.context.payload.head_commit?.message || '';
    const deployedBy = core.getInput('deployed-by');

    // Mode: Upload only (artifacts without token) - for parallel build jobs
    if (!token && artifacts) {
      core.info('Upload mode: Will upload artifacts in post-run');
      core.saveState('skip', 'false');
      core.saveState('mode', 'upload-artifacts');
      core.saveState('artifacts', artifacts);
      return;
    }

    // Token is required for all other modes
    if (!token) {
      throw new Error('token is required');
    }

    // Mode: Finalize (token without environment/version/dry-run/get-version)
    if (!environment && !version && !dryRun && !getVersion) {
      core.info('Finalize mode: Loading session from previous job...');

      const session = await downloadSession();
      if (!session) {
        throw new Error('No session found. Run with environment and dry-run: true first.');
      }

      // Download artifacts from previous jobs
      const storedArtifacts = await downloadStoredArtifacts();

      // Construct git tag
      const prefix = session.releasePrefix || session.applicationName;
      const gitTag = `${prefix}-v${session.version}`;

      // Record release
      core.info(`Recording release ${session.version} to ${session.environment}...`);

      const result = await recordRelease(session.apiUrl, token, {
        environment: session.environment,
        version: session.version,
        commitHash: session.commitHash,
        commitMessage: session.commitMessage,
        deployedBy: session.deployedBy,
        gitTag,
      });

      core.info(`Release recorded!`);
      core.info(`  Application: ${result.deployment.applicationName}`);
      core.info(`  Version: ${result.deployment.version}`);
      core.info(`  Environment: ${result.deployment.environment}`);
      core.info(`  Tag: ${gitTag}`);

      core.setOutput('version', result.deployment.version);
      core.setOutput('id', result.deployment.id);

      // Create GitHub release
      if (!session.skipGithubRelease && githubToken) {
        await createGithubRelease({
          githubToken,
          tag: gitTag,
          body: session.body,
          draft: session.draft,
          prerelease: session.prerelease,
          artifactFiles: storedArtifacts,
        });
      }

      // Signal post to skip
      core.saveState('skip', 'true');
      return;
    }

    // Environment is required for remaining modes
    if (!environment) {
      throw new Error('environment is required');
    }

    // Validate environment
    const validEnvs = ['production', 'staging', 'development'];
    if (!validEnvs.includes(environment)) {
      throw new Error(`Invalid environment: ${environment}. Must be one of: ${validEnvs.join(', ')}`);
    }

    // Mode 1: Get current version
    if (getVersion) {
      core.info(`Getting current version for ${environment}...`);

      const response = await fetch(`${apiUrl}/webhook/version?environment=${environment}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json() as VersionResponse | ErrorResponse;

      if (!response.ok) {
        const error = data as ErrorResponse;
        throw new Error(`API error (${error.code}): ${error.error}`);
      }

      const result = data as VersionResponse;
      core.info(`Current version: ${result.version}`);
      core.setOutput('version', result.version);
      core.setOutput('deployed-at', result.deployedAt);
      core.setOutput('commit-hash', result.commitHash);

      // Signal post to skip
      core.saveState('skip', 'true');
      return;
    }

    // Validate bump if no version provided
    if (!version) {
      const validBumps = ['major', 'minor', 'patch'];
      if (!validBumps.includes(bump)) {
        throw new Error(`Invalid bump: ${bump}. Must be one of: ${validBumps.join(', ')}`);
      }
    }

    // Mode 2: Dry run (Init) - get next version, save session for post
    if (dryRun) {
      core.info(`Getting next version for ${environment} (dry run)...`);

      const response = await fetch(`${apiUrl}/webhook/deploy`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          environment,
          bump,
          dryRun: true,
        }),
      });

      const data = await response.json() as DryRunResponse | ErrorResponse;

      if (!response.ok) {
        const error = data as ErrorResponse;
        throw new Error(`API error (${error.code}): ${error.error}`);
      }

      const result = data as DryRunResponse;
      core.info(`Next version: ${result.version}`);
      core.setOutput('version', result.version);

      // Save session data for post-run (will be uploaded as artifact)
      const sessionData: SessionData = {
        environment,
        version: result.version,
        applicationName: result.applicationName,
        apiUrl,
        releasePrefix: releasePrefix || undefined,
        skipGithubRelease,
        body: releaseBody || undefined,
        draft,
        prerelease,
        commitHash,
        commitMessage: commitMessage.split('\n')[0],
        deployedBy,
      };

      core.saveState('skip', 'false');
      core.saveState('mode', 'upload-session');
      core.saveState('session', JSON.stringify(sessionData));
      core.saveState('artifacts', artifacts || '');

      core.info('Session will be uploaded in post-run for multi-job workflow');
      return;
    }

    // Mode 3: Explicit version - record immediately, skip post
    if (version) {
      core.info(`Recording release ${version} to ${environment}...`);

      // Get application name first (via dry-run) for tag construction
      const dryRunResponse = await fetch(`${apiUrl}/webhook/deploy`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          environment,
          version,
          dryRun: true,
        }),
      });

      const dryRunData = await dryRunResponse.json() as DryRunResponse | ErrorResponse;

      if (!dryRunResponse.ok) {
        const error = dryRunData as ErrorResponse;
        throw new Error(`API error (${error.code}): ${error.error}`);
      }

      const dryRunResult = dryRunData as DryRunResponse;
      const applicationName = dryRunResult.applicationName;
      const prefix = releasePrefix || applicationName;
      const gitTag = `${prefix}-v${version}`;

      // Record release with gitTag
      const result = await recordRelease(apiUrl, token, {
        environment,
        version,
        commitHash,
        commitMessage: commitMessage.split('\n')[0],
        deployedBy,
        gitTag,
      });

      core.info(`Release recorded!`);
      core.info(`  Application: ${result.deployment.applicationName}`);
      core.info(`  Version: ${result.deployment.version}`);
      core.info(`  Environment: ${result.deployment.environment}`);
      core.info(`  Tag: ${gitTag}`);

      core.setOutput('version', result.deployment.version);
      core.setOutput('id', result.deployment.id);

      // Create GitHub release
      if (!skipGithubRelease && githubToken) {
        // Try to download artifacts from storage (from previous dry-run job)
        const storedArtifacts = await downloadStoredArtifacts();

        await createGithubRelease({
          githubToken,
          tag: gitTag,
          body: releaseBody,
          draft,
          prerelease,
          artifacts,
          artifactFiles: storedArtifacts,
        });
      }

      // Signal post to skip
      core.saveState('skip', 'true');
      return;
    }

    // Mode 4: Single job - get next version, save state for post
    core.info(`Getting next version for ${environment}...`);

    const response = await fetch(`${apiUrl}/webhook/deploy`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        environment,
        bump,
        dryRun: true,
      }),
    });

    const data = await response.json() as DryRunResponse | ErrorResponse;

    if (!response.ok) {
      const error = data as ErrorResponse;
      throw new Error(`API error (${error.code}): ${error.error}`);
    }

    const result = data as DryRunResponse;
    core.info(`Next version: ${result.version}`);
    core.setOutput('version', result.version);

    // Save state for post
    core.saveState('skip', 'false');
    core.saveState('token', token);
    core.saveState('apiUrl', apiUrl);
    core.saveState('environment', environment);
    core.saveState('version', result.version);
    core.saveState('applicationName', result.applicationName);
    core.saveState('commitHash', commitHash);
    core.saveState('commitMessage', commitMessage.split('\n')[0]);
    core.saveState('deployedBy', deployedBy);
    core.saveState('skipGithubRelease', skipGithubRelease.toString());
    core.saveState('releasePrefix', releasePrefix);
    core.saveState('githubToken', githubToken);
    core.saveState('body', releaseBody || '');
    core.saveState('draft', draft.toString());
    core.saveState('prerelease', prerelease.toString());
    core.saveState('artifacts', artifacts);

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();
