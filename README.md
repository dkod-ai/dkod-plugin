# DKOD plugin for Claude Code

Build and deploy apps through your company's DKOD from Claude Code.

It adds three things:

- **MCP server** `dkod`: your org's policy, templates, Deploy questions, Deploy, build answers, Deliver and Remove.
- **Skill** `dkod`: tells Claude how to use them, in the right order.
- **DKOD band and rules**: a band above the prompt shows whether you are signed in to DKOD, and the same rules DKOD Guard uses check every command and file write.

## Install

```
/plugin marketplace add dkod-ai/dkod-plugin
/plugin install dkod@dkod-ai
```

Then run `/mcp`, pick `dkod` and choose **Authenticate**. You sign in with your company's own sign-in. DKOD never sees a password. Until you sign in, the band above the prompt is yellow.

## What the rules check

The rules need to know your org: which GitHub owners are yours, which repository is the governance repository, and the org's own blocked commands. Your company gives the rules those facts when it installs DKOD Guard on its devices from the DKOD dashboard. Then, in the org's repositories, the rules refuse:

- `git push`, `gh pr merge` and GitHub API writes to an app repository. App code ships through Deliver.
- A secret value (private keys, cloud keys, vendor tokens) written into a file.
- Skipped git hooks (`--no-verify`, `core.hooksPath`).

With this plugin alone, nothing names your org, so a repository with a remote is left alone. A folder with no remote still gets the secret check. This plugin sends no events and needs no install file.

## Limits

The rules keep Claude on the Deliver path. They are not a security boundary against a person.

To stop direct pushes for real, protect the app repository on GitHub (branch protection or rulesets). DKOD's Deliver does not need a person to push.

## Source

This repository is generated from DKOD's source. Do not edit it here: changes are overwritten by the next release.

## Docs

https://dkod.ai/docs

## License

MIT
