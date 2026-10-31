<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/hero-dark.svg">
    <img src="assets/readme/hero-light.svg" width="100%" alt="DKOD plugin for Claude Code and Cursor. Keep your AI agent. Ship by your rules.">
  </picture>
</p>

<p align="center">Keep using the AI agent you prefer.<br>This plugin brings your company's DKOD into Claude Code and Cursor.</p>

<p align="center">
  <a href="#claude"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/install-claude-code-dark.svg"><img src="assets/readme/install-claude-code-light.svg" height="76" alt="Install in Claude Code"></picture></a>
  <a href="#cursor"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/install-cursor-dark.svg"><img src="assets/readme/install-cursor-light.svg" height="76" alt="Install in Cursor"></picture></a>
  <a href="https://dkod.ai"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/dkod-ai-dark.svg"><img src="assets/readme/dkod-ai-light.svg" height="76" alt="dkod.ai"></picture></a>
</p>

<p align="center">
  <a href="LICENSE"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/badge-license-dark.svg"><img src="assets/readme/badge-license-light.svg" alt="License: MIT"></picture></a>
  <a href="https://github.com/dkod-ai/dkod-plugin/commits/main"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/badge-version-dark.svg"><img src="assets/readme/badge-version-light.svg" alt="Plugin version"></picture></a>
  <a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/badge-agents-dark.svg"><img src="assets/readme/badge-agents-light.svg" alt="Works in Claude Code and Cursor"></picture></a>
  <a href="#what-the-rules-check"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/badge-events-dark.svg"><img src="assets/readme/badge-events-light.svg" alt="Events: none sent"></picture></a>
  <a href="https://dashboard.dkod.app/docs"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/badge-docs-dark.svg"><img src="assets/readme/badge-docs-light.svg" alt="Docs: in the DKOD dashboard"></picture></a>
</p>

<p align="center">
  <a href="#what-it-adds"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-adds-dark.svg"><img src="assets/readme/nav-adds-light.svg" alt="What it adds"></picture></a>
  <a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-install-dark.svg"><img src="assets/readme/nav-install-light.svg" alt="Quick install"></picture></a>
  <a href="#cursor-admin"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-cursor-admin-dark.svg"><img src="assets/readme/nav-cursor-admin-light.svg" alt="Cursor admin"></picture></a>
  <a href="#claude-admin"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-claude-admin-dark.svg"><img src="assets/readme/nav-claude-admin-light.svg" alt="Anthropic admin"></picture></a>
  <a href="#cursor"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-cursor-dark.svg"><img src="assets/readme/nav-cursor-light.svg" alt="Cursor builder"></picture></a>
  <a href="#claude"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-claude-dark.svg"><img src="assets/readme/nav-claude-light.svg" alt="Claude Code builder"></picture></a>
  <a href="#dkoder-and-guard"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-guard-dark.svg"><img src="assets/readme/nav-guard-light.svg" alt="Dkoder and Guard"></picture></a>
  <a href="#what-the-rules-check"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-rules-dark.svg"><img src="assets/readme/nav-rules-light.svg" alt="What the rules check"></picture></a>
  <a href="#limits"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-limits-dark.svg"><img src="assets/readme/nav-limits-light.svg" alt="Limits"></picture></a>
</p>

<h2 id="what-it-adds"><sub><picture><img src="assets/readme/dot-yellow.svg" width="18" height="10" alt=""></picture>What it adds</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-adds-dark.svg"><img src="assets/readme/h-adds-light.svg" alt="Three parts, one plugin."></picture></h2>

- **MCP server** `dkod`: your org's policy, templates, Deploy questions, Deploy, build answers, Deliver and Remove.
- **Skill** `dkod`: tells Claude how to use them, in the right order.
- **Dkoder band and rules**: a band above the prompt shows whether you are signed in to DKOD.<br>DKOD's floor checks every command and file write, and once you sign in, so do your organization's Guard&nbsp;rules.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/band-dark.svg">
  <img src="assets/readme/band-light.svg" width="100%" alt="The Dkoder band above the Claude Code prompt. Before you sign in it is yellow and says: Sign in to DKOD for Deliver and your organization's Guard rules: type /mcp, pick dkod, then Authenticate. Signed in, it is cyan and says: on, Guard on, refund-admin, Deliver required.">
</picture>

<h3>Which part is for you</h3>

| You are | You want | Read |
| -- | -- | -- |
| <picture><img src="assets/readme/agent-cursor.svg" width="22" height="16" alt=""></picture> A Cursor team admin | The plugin for every member of your Cursor team, with no step on their side | [Cursor org admin](#cursor-admin) |
| <picture><img src="assets/readme/agent-claude.svg" width="22" height="16" alt=""></picture> An admin of a Claude Team or Enterprise org | The plugin in every Claude Code of your company, and the DKOD server in claude.ai | [Anthropic org admin](#claude-admin) |
| <picture><img src="assets/readme/agent-cursor.svg" width="22" height="16" alt=""></picture> A builder who uses Cursor | The plugin in your own Cursor, with no admin | [Cursor builder](#cursor) |
| <picture><img src="assets/readme/agent-claude.svg" width="22" height="16" alt=""></picture> A builder who uses Claude Code | The plugin in your own Claude Code, with no admin | [Claude Code builder](#claude) |

Not sure? Run the [quick install](#install). It asks the questions.

<h2 id="install"><sub><picture><img src="assets/readme/dot-cyan.svg" width="18" height="10" alt=""></picture>Quick install</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-install-dark.svg"><img src="assets/readme/h-install-light.svg" alt="One line, any agent."></picture></h2>

**For:** one builder on a Mac or Linux computer, in Claude Code, Cursor or both.

```sh
curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | sh
```

The script:

1. Finds the plugin where it is installed now, and upgrades it. It asks nothing for this step.
2. Asks which agent to install it in: Claude Code, Cursor or both.
3. Asks which channel to follow. Choose **stable**, the default.
4. Tells you what to restart, and how to sign in.

| Channel | What you get |
| -- | -- |
| `stable` (recommended) | The latest [GitHub release](https://github.com/dkod-ai/dkod-plugin/releases) |
| `nightly` | The newest commit on `main`, before it is released |

Run the same line again to upgrade. It never uses `sudo`, and it does not change a copy that your company or your Cursor team installed. To answer the questions in advance, for example in a script:

```sh
curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | DKOD_AGENT=both DKOD_CHANNEL=stable sh
```

`DKOD_AGENT` is `claude`, `cursor` or `both`. `DKOD_CHANNEL` is `stable` or `nightly`.

<h2 id="cursor-admin"><sub><picture><img src="assets/readme/agent-cursor.svg" width="22" height="16" alt=""></picture>Cursor org admin</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-cursor-admin-dark.svg"><img src="assets/readme/h-cursor-admin-light.svg" alt="Your whole team, in Cursor."></picture></h2>

**For:** the admin of a Cursor team. Every member gets the plugin from the team, and Cursor keeps it up to date. Members do not run the installer.

1. In the Cursor dashboard, import the GitHub repository `dkod-ai/dkod-plugin` as a team marketplace.
2. Turn on **Enable Auto Refresh**. Then a new release reaches your team by itself.
3. For Cursor cloud agents, open **Dashboard → Integrations & MCP** and add this MCP server for everyone:

   ```
   https://dashboard.dkod.app/api/v1/dkoder/mcp
   ```

4. Tell each member to restart Cursor, then open **Settings → MCP**, find `DKOD` and choose **Connect**. They sign in with your company's own sign-in.

In Cursor, the plugin gives the `dkod` MCP server, the `dkod` skill, an always-on DKOD rule and a hook that keeps a chat on the DKOD steps. The band and the Dkoder floor run only in Claude Code.

To let the dkod tools run without an approval each time, see [Run the dkod tools without approval](#cursor).

<h2 id="claude-admin"><sub><picture><img src="assets/readme/agent-claude.svg" width="22" height="16" alt=""></picture>Anthropic org admin</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-claude-admin-dark.svg"><img src="assets/readme/h-claude-admin-light.svg" alt="Your whole org, in Claude."></picture></h2>

**For:** the admin of a Claude Team or Enterprise organization. Every Claude Code in your company gets the plugin, and claude.ai gets the DKOD server. Members do not run the installer.

**Claude Code on your company's computers.** Choose one:

- **Dkoder on the devices (recommended).** Install it from the DKOD dashboard, with your device management. A person cannot turn that copy off, and it updates by itself.
- **The plugin, from managed settings.** Add this to the managed settings that your device management puts on each computer (`/Library/Application Support/ClaudeCode/managed-settings.json` on macOS, `/etc/claude-code/managed-settings.json` on Linux):

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

  `"ref": "stable"` follows the latest release. Each member then types `/mcp` in Claude Code, picks `dkod` and chooses **Authenticate**.

**Claude Code on the web, and the Desktop app's Cloud.** Plugins do not load in a cloud session. On claude.ai, an Owner adds a custom connector for the organization in the admin settings, under **Connectors**, with this URL:

```
https://dashboard.dkod.app/api/v1/dkoder/mcp
```

Members then connect it under **Settings → Connectors** and sign in. The server gives the agent the dkod skill and its scripts through the `dkoder.guide` tool. The default **Trusted** network reaches your organization's storage on AWS, Google Cloud and Cloudflare R2.

<h2 id="cursor"><sub><picture><img src="assets/readme/agent-cursor.svg" width="22" height="16" alt=""></picture>Cursor builder</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-cursor-dark.svg"><img src="assets/readme/h-cursor-light.svg" alt="Just you, in Cursor."></picture></h2>

**For:** one builder who uses Cursor, when your team admin did not install the plugin for the team. If the plugin shows in Cursor already, your team installed it: skip to step 2.

1. Install it. On macOS or Linux:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | DKOD_AGENT=cursor sh
   ```

   On Windows, in PowerShell:

   ```powershell
   curl.exe -fsSLo "$env:TEMP\dkod-plugin.tar.gz" https://github.com/dkod-ai/dkod-plugin/archive/refs/heads/stable.tar.gz
   mkdir -Force "$env:USERPROFILE\.cursor\plugins\local\dkod"
   tar.exe -xzf "$env:TEMP\dkod-plugin.tar.gz" --strip-components 1 -C "$env:USERPROFILE\.cursor\plugins\local\dkod"
   ```

   It needs no git. Do not run it with `sudo`: then root owns the folder, and the update cannot write to it.

2. Quit Cursor fully and open it again.
3. Open **Settings → MCP**, find `DKOD` and choose **Connect**. You sign in with your company's own sign-in.

**Cursor cloud agents:** add `https://dashboard.dkod.app/api/v1/dkoder/mcp` in the MCP list at [cursor.com/agents](https://cursor.com/agents).

### Cursor CLI

The plugin's MCP sign-in works only in the desktop app. For `cursor-agent`, add the dkod server to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "dkod": { "url": "https://<your DKOD dashboard>/api/v1/dkoder/mcp" }
  }
}
```

Then, from your project folder, run `cursor-agent mcp login dkod` and sign in with your company's own sign-in. The sign-in is per project folder: run it in each project.

<details>
<summary><b>Update the plugin</b></summary>

Cursor does not update a plugin in `~/.cursor/plugins/local`. Run the install line again: it upgrades your copy. The DKOD server also tells the agent when your copy is old, and the agent runs the update from your DKOD dashboard, with no git. To run that update by hand:

```sh
node ~/.cursor/plugins/local/dkod/skills/dkod/scripts/dkod-update.mjs ~/.cursor/plugins/local/dkod https://<your DKOD dashboard>/api/v1/dkoder/bundle/cursor.json
```

With Python and no Node, run `dkod-update.py` from the same folder with `python3` and the same two arguments. Cursor loads the new plugin by itself.

</details>

<details>
<summary><b>Run the dkod tools without approval</b></summary>

Cursor's Auto-review can stop each dkod tool call for approval. To allow the dkod tools, add them to `mcpAllowlist` in `~/.cursor/permissions.json`:

```json
{
  "mcpAllowlist": ["plugin-dkod-dkod:*", "dkod:*"]
}
```

This list replaces the MCP allowlist in Cursor's settings, so copy those entries into the file too. Run Mode must be Auto-review, Allowlist or Run Everything. See [Cursor permissions](https://cursor.com/docs/reference/permissions).

</details>

<h2 id="claude"><sub><picture><img src="assets/readme/agent-claude.svg" width="22" height="16" alt=""></picture>Claude Code builder</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-claude-dark.svg"><img src="assets/readme/h-claude-light.svg" alt="Just you, in Claude Code."></picture></h2>

**For:** one builder who uses Claude Code, when your company did not install DKOD on your computer.

1. Install it, with the script:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | DKOD_AGENT=claude sh
   ```

   Or in Claude Code, with two commands:

   ```
   /plugin marketplace add dkod-ai/dkod-plugin@stable
   ```

   ```
   /plugin install dkod@dkod-ai
   ```

2. Quit Claude Code and start it again.
3. Type `/mcp`, pick `dkod` and choose **Authenticate**. You sign in with your company's own sign-in. DKOD never sees a password.

Until you sign in, the band above the prompt is yellow. To upgrade, run the install line again, or run `claude plugin update dkod@dkod-ai` and restart Claude Code.

**Claude Code on the web, or the Desktop app's Cloud:** plugins do not load there. On claude.ai, open **Settings → Connectors**, add a custom connector with `https://dashboard.dkod.app/api/v1/dkoder/mcp` and sign in.

<h2 id="dkoder-and-guard"><sub><picture><img src="assets/readme/dot-mint.svg" width="18" height="10" alt=""></picture>Dkoder and Guard</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-guard-dark.svg"><img src="assets/readme/h-guard-light.svg" alt="The floor, plus your rules."></picture></h2>

| | Dkoder | Guard |
| -- | -- | -- |
| What | This plugin, in your agent | Your organization's policy, as rules |
| Rules | The floor, the same for every organization | Your organization's own, from its governance repository |
| Needs | Nothing. Works signed out; the band asks you to sign in | Sign-in through `/mcp`, or your company's device install |

<h2 id="what-the-rules-check"><sub><picture><img src="assets/readme/dot-pink.svg" width="18" height="10" alt=""></picture>What the rules check</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-rules-dark.svg"><img src="assets/readme/h-rules-light.svg" alt="App code ships through Deliver."></picture></h2>

The rules need to know your org: which GitHub owners are yours, which repository is the governance repository, and the org's own blocked commands. Dkoder gets those facts from DKOD when you sign in through `/mcp`, if your organization turned Guard on. Your company can also install Dkoder on its devices from the DKOD dashboard; that copy cannot be turned off. Then, in the org's repositories, the floor refuses:

- `git push`, `gh pr merge` and GitHub API writes to an app repository. App code ships through Deliver.
- A secret value (private keys, cloud keys, vendor tokens) written into a file.
- Skipped git hooks (`--no-verify`, `core.hooksPath`).

Guard adds your organization's own rules on top, such as blocked commands. A refusal says which one refused: the Dkoder floor, or a Guard rule of your organization.

Before you sign in, nothing names your org, so a repository with a remote is left alone. A folder with no remote still gets the secret check. This plugin sends no events and needs no install file.

<h2 id="limits"><sub><picture><img src="assets/readme/dot-coral.svg" width="18" height="10" alt=""></picture>Limits</sub><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/h-limits-dark.svg"><img src="assets/readme/h-limits-light.svg" alt="Guide rails, not a lock."></picture></h2>

> [!IMPORTANT]
> The rules keep Claude on the Deliver path. They are not a security boundary against a person.

To stop direct pushes for real, protect the app repository on GitHub (branch protection or rulesets). DKOD's Deliver does not need a person to push.

<br>

<p align="center">
  <a href="https://dkod.ai"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/dkod-dark.svg"><img src="assets/readme/dkod-light.svg" height="30" alt="DKOD"></picture></a>
</p>

<p align="center"><a href="https://dkod.ai">dkod.ai</a> · <a href="https://dashboard.dkod.app/docs">Docs</a>, in the DKOD dashboard for signed-in users · <a href="LICENSE">MIT License</a></p>

<p align="center"><sub>This repository is generated from DKOD's source. Do not edit it here: changes are overwritten by the next release.</sub></p>
