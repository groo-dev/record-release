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
- **Secrets & Variables**: Fetch and decrypt environment config at deploy time

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

### Two-Job Workflow

For workflows with separate build and deploy jobs. Session and artifacts are automatically transferred.

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.release.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      # Init: Get version, save session for finalize job
      - name: Get version
        id: release
        uses: groo-dev/record-release@v1
        with:
          token: ${{ secrets.OPS_API_TOKEN }}
          environment: production
          dry-run: true
          artifacts: dist/*.zip  # Optional: upload artifacts too

      - name: Build
        run: npm run build  # Creates dist/app.zip

      # Post-run: Uploads session + artifacts

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy
        run: echo "Deploying..."

      # Finalize: Just token needed, everything else from session
      - name: Record release
        uses: groo-dev/record-release@v1
        with:
          token: ${{ secrets.OPS_API_TOKEN }}
          # environment, version, artifacts all loaded from session
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

### Release Tag Format

By default, the GitHub release tag is `v{version}`. For monorepos, use `release-prefix`:

```yaml
# Single repo: tag = v1.0.0
- name: Record release
  uses: groo-dev/record-release@v1
  with:
    token: ${{ secrets.OPS_API_TOKEN }}
    environment: production

# Monorepo: tag = myapp-v1.0.0
- name: Record release
  uses: groo-dev/record-release@v1
  with:
    token: ${{ secrets.OPS_API_TOKEN }}
    environment: production
    release-prefix: "myapp"
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

### Multi-Job with Parallel Builds

For workflows with parallel build jobs (e.g., multi-platform builds). Each build job uploads its artifacts, finalize job collects them all.

```yaml
jobs:
  version:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.release.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      # Init: Get version, save session
      - name: Get version
        id: release
        uses: groo-dev/record-release@v1
        with:
          token: ${{ secrets.OPS_API_TOKEN }}
          environment: production
          dry-run: true
          body: "Release notes here"

  build-linux:
    needs: version
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run build:linux  # Creates dist/app-linux.zip

      # Upload: Just artifacts, no token needed
      - uses: groo-dev/record-release@v1
        with:
          artifacts: dist/app-linux.zip

  build-macos:
    needs: version
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run build:macos

      - uses: groo-dev/record-release@v1
        with:
          artifacts: dist/app-macos.zip

  build-windows:
    needs: version
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run build:windows

      - uses: groo-dev/record-release@v1
        with:
          artifacts: dist/app-windows.zip

  release:
    needs: [version, build-linux, build-macos, build-windows]
    runs-on: ubuntu-latest
    steps:
      # Finalize: Downloads session + all artifacts, records + releases
      - uses: groo-dev/record-release@v1
        with:
          token: ${{ secrets.OPS_API_TOKEN }}
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

### Secrets & Variables

Fetch environment-specific secrets and variables from Groo Ops. Secrets are end-to-end encrypted and decrypted only in your workflow.

```yaml
- name: Record release
  id: release
  uses: groo-dev/record-release@v1
  with:
    token: ${{ secrets.OPS_API_TOKEN }}
    environment: production
    secret-key: ${{ secrets.OPS_SECRET_KEY_PRODUCTION }}

- name: Use secrets and variables
  run: |
    # Variables are exposed as var_NAME
    echo "API URL: ${{ steps.release.outputs.var_API_URL }}"

    # Secrets are exposed as secret_NAME (masked in logs)
    npm publish --token ${{ steps.release.outputs.secret_NPM_TOKEN }}
```

**Setup:**
1. In Groo Ops Dashboard, go to your app's **Config** section
2. Select an environment and click **Enable Secrets**
3. Copy the private key and add it as a GitHub secret (e.g., `OPS_SECRET_KEY_PRODUCTION`)
4. Add your secrets and variables in the dashboard

**Security:**
- Secrets are encrypted in the browser before being stored
- The server never sees plaintext secret values
- Only workflows with the private key can decrypt secrets
- Each environment has its own encryption key

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | Mode-dependent | - | Groo Ops API token. Required for init/finalize, not for upload-only. |
| `secret-key` | No | - | Private key for decrypting secrets. If provided, secrets are fetched and exposed as outputs. |
| `environment` | Mode-dependent | - | `production`, `staging`, or `development`. Required for init, auto-loaded for finalize. |
| `version` | No | - | Explicit semver (e.g., `1.2.3`). Records immediately. |
| `bump` | No | `patch` | Version bump type: `major`, `minor`, `patch` |
| `dry-run` | No | `false` | Init mode: get version and save session for finalize job |
| `get-version` | No | `false` | Get current deployed version |
| `skip-github-release` | No | `false` | Skip creating GitHub release |
| `release-prefix` | No | - | Prefix for tag. If set: `{prefix}-v{version}`. If not: `v{version}` |
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
| `var_*` | Variables from config (e.g., `var_API_URL`) |
| `secret_*` | Decrypted secrets from config (e.g., `secret_NPM_TOKEN`). Only available if `secret-key` is provided. Values are masked in logs. |

## How It Works

### Modes

The action automatically detects which mode to use based on inputs:

| Inputs | Mode | Behavior |
|--------|------|----------|
| `token` + `environment` | **Single Job** | Get version → your build steps → post records + releases |
| `token` + `environment` + `dry-run` | **Init** | Get version → post uploads session + artifacts |
| `artifacts` only | **Upload** | Post uploads artifacts to storage |
| `token` only | **Finalize** | Download session + artifacts → record + release |
| `token` + `version` | **Explicit** | Record + release immediately |

### Single Job Flow
1. **Main**: Gets next version, outputs for your steps
2. **Your steps**: Build, test, deploy
3. **Post**: Records to Ops + creates GitHub release

### Multi-Job Flow
1. **Init job**: Gets version, post uploads session (+ artifacts if specified)
2. **Build jobs** (optional): Post uploads artifacts
3. **Finalize job**: Downloads session + artifacts, records + releases

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
