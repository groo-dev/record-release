import * as core from '@actions/core';
import * as github from '@actions/github';
import { DeploymentResponse, ErrorResponse } from './types';

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

async function run(): Promise<void> {
  try {
    // Check if we should skip
    const skip = core.getState('skip');
    if (skip === 'true') {
      core.info('Skipping post run');
      return;
    }

    // Get state from main
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
      await createGithubRelease(githubToken, gitTag);
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
