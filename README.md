# flisk.sh

Short install URL and JSON schema host for [Flisk CLI](https://github.com/flisk-sh/flisk).

## Install

```sh
curl -fsSL https://flisk.sh/install.sh | sh
```

The script downloads the latest binary from [flisk-sh/releases](https://github.com/flisk-sh/releases/releases/latest). Prefer npm? `npm install -g flisk`.

### Windows AMD64: CLI inspection

The latest release includes `flisk-windows-amd64.exe` and its bundled runtime assets. Install the CLI from PowerShell:

```powershell
irm https://flisk.sh/install.ps1 | iex
```

Or download and inspect the script first:

```powershell
Invoke-WebRequest https://flisk.sh/install.ps1 -OutFile install-flisk.ps1
powershell -ExecutionPolicy Bypass -File .\install-flisk.ps1
```

After installing, open a new PowerShell window and run:

```powershell
flisk --version
flisk runtime --check-assets
flisk doctor
```

Native Windows supports CLI inspection only. `flisk doctor` explains that running a landscape requires Ubuntu in WSL2; use the [WSL2 setup guide](https://github.com/flisk-sh/flisk/blob/main/docs/wsl2.md) for `flisk project` and `flisk up`. Windows ARM64 is not supported.

## JSON Schema

Resource config schema, referenced from every `service.json` via `$schema`:

- https://flisk.sh/schema.service.json

Source of truth is [`engine/schemas/service-schema.json`](https://github.com/flisk-sh/flisk/blob/main/engine/schemas/service-schema.json) in flisk; copy changes here to republish.

### VS Code: validation and autocomplete for `service.json`

VS Code's built-in JSON support can validate `service.json` files against this schema and autocomplete their fields — no extension required.

**Option A — per file.** Add a `$schema` key to the top of any `service.json`:

```json
{
  "$schema": "https://flisk.sh/schema.service.json",
  "appName": "my-service"
}
```

**Option B — whole workspace.** Most generated `service.json` files don't include `$schema`, so map the filename once instead. Add to `.vscode/settings.json`:

```json
{
  "json.schemas": [
    {
      "fileMatch": ["**/service.json"],
      "url": "https://flisk.sh/schema.service.json"
    }
  ]
}
```

Reopen (or just click into) a `service.json` file and VS Code will underline invalid fields and suggest valid ones on <kbd>Ctrl</kbd>+<kbd>Space</kbd>.

---

⭐ **Using Flisk?** [Star flisk](https://github.com/flisk-sh/flisk) so other developers can find it.

## Use Cilytics for your org

[Cilytics](https://flisk-sh.github.io/checks/) shows CI health for every active public repo of a GitHub org or user: red workflows, pass rate, flaky and slow runs, GEL guards. It reads the GitHub API only. To run it on your own account, add this workflow to any repo you own (a `ci-dashboard` repo works well):

```yaml
# .github/workflows/cilytics.yml
name: Cilytics
on:
  schedule:
    - cron: "17 * * * *"
  workflow_dispatch:

permissions:
  contents: write # lets the action update the cilytics-data branch of this repo

jobs:
  cilytics:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: flisk-sh/flisk-sh.github.io@<full commit SHA of the version you trust>
        with:
          org: your-org-or-username # optional, defaults to this repo's owner
```

The action replaces `data.json`, `history.json` and `index.html` on the `cilytics-data` branch of your repo with one new commit each run. Turn on GitHub Pages for that branch (Settings, Pages, Deploy from a branch) and the page is at `https://<owner>.github.io/<repo>/`. The Flisk-hosted page can also show your data with `?src=owner/repo`, for example `https://flisk-sh.github.io/checks/?src=your-org/ci-dashboard`.

Inputs: `org` (an org or a user; when you run `scripts/cilytics/collect.mjs` yourself, set `CILYTICS_ORG`), `branch`, `max-repos`, `publish` (`false` for a dry run) and `token`. The default token reads public repos only. Pin the action to a commit SHA, as above.
