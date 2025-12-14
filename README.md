# Record Release

A GitHub Action to record deployments and releases to [Groo Ops Dashboard](https://ops.groo.dev).

## Features

- Record releases to Groo Ops Dashboard
- Automatically create GitHub releases
- Support for single-job and multi-job workflows
- Semantic version bumping (major, minor, patch)
- Upload release artifacts (with automatic transfer in multi-job workflows)
- Custom release notes (inline or from file)
- Draft and prerelease support

## Usage

### Single Job Workflow (Recommended)

The action automatically records the release and creates a GitHub release after your job completes successfully.

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: write  # Required for creating GitHub releases

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Get next version and set up post-job recording
      - name: Record release
        id: release
        uses: groo-dev/record-release@v1
        with:
          token: ${{ secrets.OPS_API_TOKEN }}
          environment: production
          bump: patch

      # Use the version in your build/deploy steps
      - name: Build
        run: |
          echo "Building version ${{ steps.release.outputs.version }}"
          npm version ${{ steps.release.outputs.version }} --no-git-tag-version
          npm run build

      - name: Deploy
        run: |
          # Your deploy commands here

      # Release is automatically recorded after job succeeds!
```

### Multi-Job Workflow

For workflows with multiple jobs, use `dry-run` in the first job and explicit `version` in the last job.

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

permissions:
  contents: write  # Required for creating GitHub releases

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.release.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      # Get next version (dry-run skips post-job recording)
      - name: Get version
        id: release
        uses: groo-dev/record-release@v1
        with:
          token: ${{ secrets.OPS_API_TOKEN }}
          environment: production
          bump: patch
          dry-run: true

      - name: Build
        run: npm run build

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy
        run: echo "Deploying..."

      # Record release with explicit version (triggers immediately)
      - name: Record release
        uses: groo-dev/record-release@v1
        with:
          token: ${{ secrets.OPS_API_TOKEN }}
          environment: production
          version: ${{ needs.build.outputs.version }}
```

### Skip GitHub Release

```yaml
- name: Record release
  uses: groo-dev/record-release@v1
  with:
    token: ${{ secrets.OPS_API_TOKEN }}
    environment: production
    skip-github-release: true
```

### Custom Release Prefix

By default, the GitHub release tag uses `{applicationName}-v{version}`. Override with `release-prefix`:

```yaml
- name: Record release
  uses: groo-dev/record-release@v1
  with:
    token: ${{ secrets.OPS_API_TOKEN }}
    environment: production
    release-prefix: "myapp"  # Tag: myapp-v1.0.0
```

### Get Current Version

```yaml
- name: Get current version
  id: current
  uses: groo-dev/record-release@v1
  with:
    token: ${{ secrets.OPS_API_TOKEN }}
    environment: production
    get-version: true

- run: echo "Current version is ${{ steps.current.outputs.version }}"
```

### Release with Artifacts

Upload files to the GitHub release:

```yaml
- name: Record release
  uses: groo-dev/record-release@v1
  with:
    token: ${{ secrets.OPS_API_TOKEN }}
    environment: production
    artifacts: |
      dist/*.zip
      dist/*.tar.gz
```

### Multi-Job with Artifacts

Artifacts are automatically transferred between jobs - no need for `actions/upload-artifact` or `actions/download-artifact`:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.release.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - name: Get version
        id: release
        uses: groo-dev/record-release@v1
        with:
          token: ${{ secrets.OPS_API_TOKEN }}
          environment: production
          dry-run: true
          artifacts: dist/*.zip  # Specify pattern upfront

      - name: Build
        run: npm run build  # Creates dist/app.zip

      # Post-run: Automatically uploads artifacts to storage

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy
        run: echo "Deploying..."

      - name: Record release
        uses: groo-dev/record-release@v1
        with:
          token: ${{ secrets.OPS_API_TOKEN }}
          environment: production
          version: ${{ needs.build.outputs.version }}
          # Automatically downloads artifacts from build job
```

### Custom Release Notes

Inline release notes:

```yaml
- name: Record release
  uses: groo-dev/record-release@v1
  with:
    token: ${{ secrets.OPS_API_TOKEN }}
    environment: production
    body: |
      ## What's Changed
      - New feature X
      - Bug fix Y
```

Or from a file:

```yaml
- name: Record release
  uses: groo-dev/record-release@v1
  with:
    token: ${{ secrets.OPS_API_TOKEN }}
    environment: production
    body-file: CHANGELOG.md
```

### Draft and Prerelease

```yaml
- name: Record release
  uses: groo-dev/record-release@v1
  with:
    token: ${{ secrets.OPS_API_TOKEN }}
    environment: staging
    prerelease: true  # Mark as prerelease

- name: Record release
  uses: groo-dev/record-release@v1
  with:
    token: ${{ secrets.OPS_API_TOKEN }}
    environment: production
    draft: true  # Create as draft for review
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | Yes | - | Groo Ops API token |
| `environment` | Yes | - | `production`, `staging`, or `development` |
| `version` | No | - | Explicit semver (e.g., `1.2.3`). Records immediately. |
| `bump` | No | `patch` | Version bump type: `major`, `minor`, `patch` |
| `dry-run` | No | `false` | Get next version without recording |
| `get-version` | No | `false` | Get current deployed version |
| `skip-github-release` | No | `false` | Skip creating GitHub release |
| `release-prefix` | No | `applicationName` | Prefix for GitHub release tag |
| `github-token` | No | `github.token` | GitHub token for creating releases |
| `body` | No | - | Release notes content |
| `body-file` | No | - | Path to file containing release notes |
| `draft` | No | `false` | Create release as draft |
| `prerelease` | No | `false` | Mark release as prerelease |
| `artifacts` | No | - | Glob patterns for release assets (one per line) |
| `commit-hash` | No | `github.sha` | Git commit SHA |
| `commit-message` | No | from event | Commit message |
| `deployed-by` | No | `github-actions` | Deployer identifier |
| `api-url` | No | `https://ops.groo.dev/v1` | API base URL |

## Outputs

| Output | Description |
|--------|-------------|
| `version` | The recorded/current version |
| `id` | The deployment record ID |
| `deployed-at` | Deployment timestamp (get-version mode only) |
| `commit-hash` | Commit hash of deployment (get-version mode only) |

## How It Works

### Single Job Mode
1. **Main step**: Gets next version via dry-run API, outputs version for your steps
2. **Your steps**: Build, test, deploy using the version
3. **Post step**: Records release to Groo Ops + creates GitHub release (if job succeeded)

### Multi-Job / Explicit Version Mode
1. **Main step**: Records release immediately + creates GitHub release
2. **Post step**: Skipped (already recorded)

### Dry-Run Mode
1. **Main step**: Gets next version via API
2. **Post step**: Skipped

## Permissions

To create GitHub releases, your workflow needs `contents: write` permission:

```yaml
permissions:
  contents: write
```

Without this, you'll see: `Resource not accessible by integration`

## Getting an API Token

1. Go to [ops.groo.dev](https://ops.groo.dev)
2. Select your application
3. Go to **Settings** → **API Tokens**
4. Create a new token
5. Add it as a repository secret named `OPS_API_TOKEN`

## License

MIT
