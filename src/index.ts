import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  DeploymentResponse,
  DryRunResponse,
  VersionResponse,
  ErrorResponse,
} from './types';

async function createGithubRelease(
  githubToken: string,
  tag: string
): Promise<void> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  core.info(`Creating GitHub release: ${tag}`);

  try {
    await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
      name: tag,
      generate_release_notes: true,
    });
    core.info(`GitHub release created: https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(tag)}`);
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
    // Get inputs
    const token = core.getInput('token', { required: true });
    const environment = core.getInput('environment', { required: true });
    const version = core.getInput('version');
    const bump = core.getInput('bump') || 'patch';
    const apiUrl = core.getInput('api-url');
    const dryRun = core.getInput('dry-run') === 'true';
    const getVersion = core.getInput('get-version') === 'true';
    const skipGithubRelease = core.getInput('skip-github-release') === 'true';
    const releasePrefix = core.getInput('release-prefix');
    const githubToken = core.getInput('github-token');

    const commitHash = core.getInput('commit-hash') || github.context.sha;
    const commitMessage = core.getInput('commit-message') ||
      github.context.payload.head_commit?.message || '';
    const deployedBy = core.getInput('deployed-by');

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

    // Mode 2: Dry run - just get next version, skip post
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

      // Signal post to skip
      core.saveState('skip', 'true');
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
        await createGithubRelease(githubToken, gitTag);
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

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();
