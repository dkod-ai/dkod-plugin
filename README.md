<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/hero-dark.svg">
    <img src="assets/readme/hero-light.svg" width="100%" alt="DKOD plugin for Claude Code, Cursor, Codex and Copilot. Keep your AI agent. Ship by your rules.">
  </picture>
</p>

<h2 id="install"><sub><picture><img src="assets/readme/dot-cyan.svg" width="18" height="10" alt=""></picture>Quick install</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-install-dark.svg"><img src="assets/readme/h-install-light.svg" alt="One line, any agent."></picture></h2>

**Recommended for everyone.** On macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | sh
```

On Windows, in PowerShell (needs [Git for Windows](https://git-scm.com/download/win)):

```powershell
irm https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.ps1 | iex
```

It installs `dk`, asks which agents get the plugin (Claude Code, Cursor, Codex, Copilot CLI), then says what to restart and how to sign in.

<p align="center">
  <a href="LICENSE"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/badge-license-dark.svg"><img src="assets/readme/badge-license-light.svg" alt="License: MIT"></picture></a>
  <a href="https://github.com/dkod-ai/dkod-plugin/commits/main"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/badge-version-dark.svg"><img src="assets/readme/badge-version-light.svg" alt="Plugin version"></picture></a>
  <a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/badge-agents-dark.svg"><img src="assets/readme/badge-agents-light.svg" alt="Works in Claude Code, Cursor, Codex and Copilot"></picture></a>
  <a href="#what-the-rules-check"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/badge-events-dark.svg"><img src="assets/readme/badge-events-light.svg" alt="Events: none sent"></picture></a>
  <a href="https://dashboard.dkod.app/docs"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/badge-docs-dark.svg"><img src="assets/readme/badge-docs-light.svg" alt="Docs: in the DKOD dashboard"></picture></a>
</p>

<p align="center">
  <a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-install-dark.svg"><img src="assets/readme/nav-install-light.svg" alt="Quick install"></picture></a>
  <a href="#what-it-adds"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-adds-dark.svg"><img src="assets/readme/nav-adds-light.svg" alt="What it adds"></picture></a>
  <a href="#cursor-admin"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-cursor-admin-dark.svg"><img src="assets/readme/nav-cursor-admin-light.svg" alt="Cursor admin"></picture></a>
  <a href="#claude-admin"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-claude-admin-dark.svg"><img src="assets/readme/nav-claude-admin-light.svg" alt="Anthropic admin"></picture></a>
  <a href="#cursor"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-cursor-dark.svg"><img src="assets/readme/nav-cursor-light.svg" alt="Cursor builder"></picture></a>
  <a href="#claude"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-claude-dark.svg"><img src="assets/readme/nav-claude-light.svg" alt="Claude Code builder"></picture></a>
  <a href="#codex"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-codex-dark.svg"><img src="assets/readme/nav-codex-light.svg" alt="Codex builder"></picture></a>
  <a href="#copilot"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-copilot-dark.svg"><img src="assets/readme/nav-copilot-light.svg" alt="Copilot builder"></picture></a>
  <a href="#dkoder-and-guard"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-guard-dark.svg"><img src="assets/readme/nav-guard-light.svg" alt="Dkoder and Guard"></picture></a>
  <a href="#what-the-rules-check"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-rules-dark.svg"><img src="assets/readme/nav-rules-light.svg" alt="What the rules check"></picture></a>
  <a href="#limits"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-limits-dark.svg"><img src="assets/readme/nav-limits-light.svg" alt="Limits"></picture></a>
</p>

### `dk` does the rest

| Command | What it does |
| -- | -- |
| `dk install` | Install or upgrade the plugin, per agent |
| `dk upgrade` | Upgrade `dk` and the plugin |
| `dk channel` | Switch channel: `stable` (latest release, default) or `nightly` (newest build) |
| `dk config` | Agent settings: `cursor-allow` (no approval prompts in Cursor), `cursor-cli` (dkod in `cursor-agent`). `off` undoes |
| `dk doctor` | Check the setup and name each issue |
| `dk uninstall` | Remove what you pick. `--all` removes everything |

In a script: `curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | DKOD_AGENT=claude,codex DKOD_CHANNEL=stable sh` (`claude`, `cursor`, `codex`, `copilot` or `all`).

**graphify** (recommended, `dk` offers it): the DKOD skill maps your project into a [graphify](https://github.com/Graphify-Labs/graphify) code graph and asks it instead of reading file after file. Fewer tokens, faster work. It runs on your device only: no telemetry, no AI service.

<h2 id="what-it-adds"><sub><picture><img src="assets/readme/dot-yellow.svg" width="18" height="10" alt=""></picture>What it adds</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-adds-dark.svg"><img src="assets/readme/h-adds-light.svg" alt="Three parts, one plugin."></picture></h2>

- **MCP server** `dkod`: your org's policy, templates, Deploy and Deliver.
- **Skills**: the DKOD steps, in order.
- **Dkoder**: the rules on every command and file write, and in Claude Code a band above the prompt.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/band-dark.svg">
  <img src="assets/readme/band-light.svg" width="100%" alt="The Dkoder band above the Claude Code prompt. Before you sign in it is yellow and says: Sign in to DKOD for Deliver and your organization's Guard rules: type /mcp, pick dkod, then Authenticate. Signed in, it is cyan and says: on, Guard on, refund-admin, Deliver required.">
</picture>

<h3>Other ways to install</h3>

| You are | You want | Read |
| -- | -- | -- |
| <picture><img src="assets/readme/agent-cursor.svg" width="22" height="16" alt=""></picture>A Cursor team admin | The plugin for every member of your Cursor team, with no step on their side | [Cursor org admin](#cursor-admin) |
| <picture><img src="assets/readme/agent-claude.svg" width="22" height="16" alt=""></picture>An admin of a Claude Team or Enterprise org | The plugin in every Claude Code of your company, and the DKOD server in claude.ai | [Anthropic org admin](#claude-admin) |
| <picture><img src="assets/readme/agent-cursor.svg" width="22" height="16" alt=""></picture>A builder who uses Cursor | The plugin in your own Cursor, with no admin | [Cursor builder](#cursor) |
| <picture><img src="assets/readme/agent-claude.svg" width="22" height="16" alt=""></picture>A builder who uses Claude Code | The plugin in your own Claude Code, with no admin | [Claude Code builder](#claude) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/agent-codex-dark.svg"><img src="assets/readme/agent-codex-light.svg" width="22" height="16" alt=""></picture>A builder who uses Codex | The plugin in your own Codex CLI, with no admin | [Codex builder](#codex) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/agent-copilot-dark.svg"><img src="assets/readme/agent-copilot-light.svg" width="22" height="16" alt=""></picture>A builder who uses GitHub Copilot CLI | The plugin in your own Copilot CLI, with no admin | [Copilot builder](#copilot) |

<h2 id="cursor-admin"><sub><picture><img src="assets/readme/agent-cursor.svg" width="22" height="16" alt=""></picture>Cursor org admin</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-cursor-admin-dark.svg"><img src="assets/readme/h-cursor-admin-light.svg" alt="Your whole team, in Cursor."></picture></h2>

For your own device, use the [quick install](#install), the recommended way. For your whole team:

1. In the Cursor dashboard, import `dkod-ai/dkod-plugin` as a team marketplace and turn on **Enable Auto Refresh**.
2. For cloud agents: **Dashboard → Integrations & MCP**, add `https://dashboard.dkod.app/api/v1/dkoder/mcp`.
3. Members restart Cursor, then **Settings → MCP → DKOD → Connect**.

To skip approval prompts, members run `dk config cursor-allow`, or you set the same allowlists in the team dashboard.

<h2 id="claude-admin"><sub><picture><img src="assets/readme/agent-claude.svg" width="22" height="16" alt=""></picture>Anthropic org admin</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-claude-admin-dark.svg"><img src="assets/readme/h-claude-admin-light.svg" alt="Your whole org, in Claude."></picture></h2>

For your own device, use the [quick install](#install), the recommended way. For your whole org, pick one:

- **Dkoder on the devices (recommended):** install it from the DKOD dashboard with your device management. It cannot be turned off and updates itself.
- **Managed settings:** add this to `managed-settings.json` (`/Library/Application Support/ClaudeCode/` on macOS, `/etc/claude-code/` on Linux):

  ```json
  {
    "extraKnownMarketplaces": {
      "dkod-ai": {
        "source": { "source": "github", "repo": "dkod-ai/dkod-plugin", "ref": "stable" }
      }
    },
    "enabledPlugins": { "dkod@dkod-ai": true }
  }
  ```

  Members then run `/mcp`, pick `dkod`, **Authenticate**.

**claude.ai and cloud sessions:** an Owner adds a custom connector with `https://dashboard.dkod.app/api/v1/dkoder/mcp` under **Connectors**.

<h2 id="cursor"><sub><picture><img src="assets/readme/agent-cursor.svg" width="22" height="16" alt=""></picture>Cursor builder</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-cursor-dark.svg"><img src="assets/readme/h-cursor-light.svg" alt="Just you, in Cursor."></picture></h2>

1. Install it with `dk`:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | DKOD_AGENT=cursor sh
   ```

   On Windows, in PowerShell:

   ```powershell
   $env:DKOD_AGENT = "cursor"; irm https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.ps1 | iex
   ```

2. Quit Cursor fully and open it again.
3. **Settings → MCP → DKOD → Connect**.
4. No approval prompts: `dk config cursor-allow`.

**Cursor CLI:** `dk config cursor-cli` adds dkod to `~/.cursor/mcp.json`. Sign-in is per project folder: run `cursor-agent mcp login dkod` in each one.

**Cloud agents:** add `https://dashboard.dkod.app/api/v1/dkoder/mcp` at [cursor.com/agents](https://cursor.com/agents).

**Updates:** `dk upgrade`, or the agent updates it from dashboard.dkod.app by itself. Also `dk channel`, `dk doctor`, `dk uninstall`.

<h2 id="claude"><sub><picture><img src="assets/readme/agent-claude.svg" width="22" height="16" alt=""></picture>Claude Code builder</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-claude-dark.svg"><img src="assets/readme/h-claude-light.svg" alt="Just you, in Claude Code."></picture></h2>

1. Install it with `dk`:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | DKOD_AGENT=claude sh
   ```

2. Restart Claude Code.
3. `/mcp`, pick `dkod`, **Authenticate**. The band turns from yellow to cyan.

**Updates:** `dk upgrade`, then restart. Also `dk channel`, `dk doctor`, `dk uninstall`.

**claude.ai:** **Settings → Connectors**, add `https://dashboard.dkod.app/api/v1/dkoder/mcp`.

<h2 id="codex"><sub><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/agent-codex-dark.svg"><img src="assets/readme/agent-codex-light.svg" width="22" height="16" alt=""></picture>Codex builder</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-codex-dark.svg"><img src="assets/readme/h-codex-light.svg" alt="Just you, in Codex."></picture></h2>

1. Install it with `dk`:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | DKOD_AGENT=codex sh
   ```

2. Restart Codex. Trust the DKOD hook when asked.
3. `codex mcp login dkod`.

**Updates:** `dk upgrade`, then restart. Also `dk channel`, `dk doctor`, `dk uninstall`.

<h2 id="copilot"><sub><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/agent-copilot-dark.svg"><img src="assets/readme/agent-copilot-light.svg" width="22" height="16" alt=""></picture>Copilot builder</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-copilot-dark.svg"><img src="assets/readme/h-copilot-light.svg" alt="Just you, in Copilot."></picture></h2>

1. Install it with `dk`:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | DKOD_AGENT=copilot sh
   ```

2. Restart Copilot CLI.
3. `/mcp`, check `dkod`, sign in when asked. If your org's Copilot policy blocks third-party MCP servers, ask your GitHub admin.

**Updates:** `dk upgrade`, then restart. Also `dk channel`, `dk doctor`, `dk uninstall`.

<h2 id="dkoder-and-guard"><sub><picture><img src="assets/readme/dot-mint.svg" width="18" height="10" alt=""></picture>Dkoder and Guard</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-guard-dark.svg"><img src="assets/readme/h-guard-light.svg" alt="The floor, plus your rules."></picture></h2>

| | Dkoder | Guard |
| -- | -- | -- |
| What | This plugin | Your org's policy, as rules |
| Rules | DKOD's floor, same for every org | Your org's own, from its governance repo |
| Needs | Nothing | Sign-in, or your company's device install |

<h2 id="what-the-rules-check"><sub><picture><img src="assets/readme/dot-pink.svg" width="18" height="10" alt=""></picture>What the rules check</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-rules-dark.svg"><img src="assets/readme/h-rules-light.svg" alt="App code ships through Deliver."></picture></h2>

In your org's repositories, the floor refuses:

- `git push`, `gh pr merge` and GitHub API writes to an app repo. App code ships through Deliver.
- A secret written into a file.
- Skipped git hooks (`--no-verify`, `core.hooksPath`).

Guard adds your org's own rules. Before sign-in, repos with a remote are left alone; the secret check still runs. No events are sent.

<h2 id="limits"><sub><picture><img src="assets/readme/dot-coral.svg" width="18" height="10" alt=""></picture>Limits</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-limits-dark.svg"><img src="assets/readme/h-limits-light.svg" alt="Guide rails, not a lock."></picture></h2>

> [!IMPORTANT]
> The rules keep the agent on the Deliver path. They are not a security boundary against a person.

To block direct pushes for real, protect the app repo on GitHub (branch protection or rulesets).

<p align="center">
  <a href="https://dkod.ai"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/dkod-dark.svg"><img src="assets/readme/dkod-light.svg" height="30" alt="DKOD"></picture></a>
</p>

<p align="center"><a href="https://dkod.ai">dkod.ai</a> · <a href="https://dashboard.dkod.app/docs">Docs</a>, in the DKOD dashboard for signed-in users · <a href="LICENSE">MIT License</a></p>

<p align="center"><sub>This repository is generated from DKOD's source. Do not edit it here: changes are overwritten by the next release.</sub></p>
