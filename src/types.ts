export interface DeploymentResponse {
  deployment: {
    id: string;
    applicationId: string;
    version: string;
    environment: string;
    commitHash: string | null;
    commitMessage: string | null;
    gitTag: string | null;
    deployedBy: string;
    deployedAt: string;
    metadata: Record<string, unknown> | null;
    applicationName: string;
  };
}

export interface DryRunResponse {
  dryRun: true;
  version: string;
  environment: string;
  applicationId: string;
  applicationName: string;
}

export interface VersionResponse {
  version: string;
  environment: string;
  deployedAt: string;
  commitHash: string | null;
  deployedBy: string;
}

export interface ErrorResponse {
  error: string;
  code: string;
}

export interface SessionData {
  environment: string;
  version: string;
  applicationName: string;
  apiUrl: string;
  releasePrefix?: string;
  skipGithubRelease: boolean;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  commitHash?: string;
  commitMessage?: string;
  deployedBy?: string;
}
