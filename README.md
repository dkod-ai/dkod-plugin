# DKOD plugin for Claude Code

Build and deploy apps through your company's DKOD from Claude Code.

It adds three things:

- **MCP server** `dkod`: your org's policy, templates, Deploy questions, Deploy, build answers, Deliver and Remove.
- **Skill** `dkod`: tells Claude how to use them, in the right order.
- **Dkoder band and rules**: a band above the prompt shows whether you are signed in to DKOD. DKOD's floor checks every command and file write, and once you sign in, so do your organization's Guard rules.

## Install

```
/plugin marketplace add dkod-ai/dkod-plugin
/plugin install dkod@dkod-ai
```

Then run `/mcp`, pick `dkod` and choose **Authenticate**. You sign in with your company's own sign-in. DKOD never sees a password. Until you sign in, the band above the prompt is yellow.

## Cursor

The same repository is a Cursor plugin. In Cursor you get the `dkod` MCP server and the `dkod` skill. You do not get the band or the rules: those run only in Claude Code.

Your team admin can import `dkod-ai/dkod-plugin` as a team marketplace in the Cursor dashboard. To install it for yourself only:

```
git clone https://github.com/dkod-ai/dkod-plugin ~/.cursor/plugins/local/dkod
```

Restart Cursor. Then open **Settings → MCP**, find `DKOD` and choose **Connect**. You sign in with your company's own sign-in.

Cursor does not update a plugin in `~/.cursor/plugins/local`. The DKOD server tells the agent when your copy is old, and the agent runs the update. To update by hand:

```
git -C ~/.cursor/plugins/local/dkod pull --ff-only
```

Then run **Developer: Reload Window** from the Command Palette. A team marketplace with **Enable Auto Refresh** on updates by itself.

Cursor's Auto-review can stop each dkod tool call for approval. To allow the dkod tools, add them to `mcpAllowlist` in `~/.cursor/permissions.json`:

```json
{ "mcpAllowlist": ["plugin-dkod-DKOD:*", "dkod:*"] }
```

This list replaces the MCP allowlist in Cursor's settings, so copy those entries into the file too. Run Mode must be Auto-review, Allowlist or Run Everything. See [Cursor permissions](https://cursor.com/docs/reference/permissions).

## Cloud sessions

Plugins do not load in a cloud session, so add the DKOD MCP server to the cloud itself. The server gives the agent the dkod skill and its scripts through the `dkoder.guide` tool.

- **Claude Code on the web, or the Desktop app's Cloud:** on claude.ai open **Settings → Connectors**, add a custom connector with `https://dashboard.dkod.app/api/v1/dkoder/mcp` and sign in. The default **Trusted** network reaches your organization's storage on AWS, Google Cloud and Cloudflare R2.
- **Cursor cloud agents:** add the same URL in the MCP list at [cursor.com/agents](https://cursor.com/agents). A team admin can add it for everyone under **Dashboard → Integrations & MCP**.

## Dkoder and Guard

| | Dkoder | Guard |
| -- | -- | -- |
| What | This plugin, in your agent | Your organization's policy, as rules |
| Rules | The floor, the same for every organization | Your organization's own, from its governance repository |
| Needs | Nothing. Works signed out; the band asks you to sign in | Sign-in through `/mcp`, or your company's device install |

## What the rules check

The rules need to know your org: which GitHub owners are yours, which repository is the governance repository, and the org's own blocked commands. Dkoder gets those facts from DKOD when you sign in through `/mcp`, if your organization turned Guard on. Your company can also install Dkoder on its devices from the DKOD dashboard; that copy cannot be turned off. Then, in the org's repositories, the floor refuses:

- `git push`, `gh pr merge` and GitHub API writes to an app repository. App code ships through Deliver.
- A secret value (private keys, cloud keys, vendor tokens) written into a file.
- Skipped git hooks (`--no-verify`, `core.hooksPath`).

Guard adds your organization's own rules on top, such as blocked commands. A refusal says which one refused: the Dkoder floor, or a Guard rule of your organization.

Before you sign in, nothing names your org, so a repository with a remote is left alone. A folder with no remote still gets the secret check. This plugin sends no events and needs no install file.

## Limits

The rules keep Claude on the Deliver path. They are not a security boundary against a person.

To stop direct pushes for real, protect the app repository on GitHub (branch protection or rulesets). DKOD's Deliver does not need a person to push.

## Source

This repository is generated from DKOD's source. Do not edit it here: changes are overwritten by the next release.

## Docs

https://dkod.ai/docs

## License

MIT
