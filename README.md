# DKOD plugin for Claude Code

Build and deploy apps through your company's DKOD from Claude Code.

It adds three things:

- **MCP server** `dkod`: your org's policy, templates, Deploy questions, Deploy, build answers, Deliver and Remove.
- **Skill** `dkod`: tells Claude how to use them, in the right order.
- **Push guard**: a hook that stops `git push` to the app repository until Deliver has run.

## Install

```
/plugin marketplace add dkod-ai/dkod-plugin
/plugin install dkod@dkod-ai
```

Then run `/mcp`, pick `dkod` and choose **Authenticate**. You sign in with your company's own sign-in. DKOD never sees a password.

## How the push guard works

When Claude runs `git push`, the hook finds the remote and checks two files in the repository's git dir:

- `dkoder/session`: written after `dkoder.session.start`. It names the app remote and the governance remote.
- `dkoder/deliver`: written after `dkoder.deliver` returns ok.

A push to the app remote is refused unless a deliver stamp for the same session and remote exists. Pushes to the governance remote, and pushes in repositories with no DKOD session, are not touched.

The hook reads its input with `jq`, `python3` or `node`, whichever is installed.

### Limits

The push guard is a guardrail that keeps Claude on the Deliver path. It is not a security boundary.

- The session and deliver files are plain files that the agent writes. Anyone who can write the git dir can write a stamp.
- The hook reads the Bash command as text. A push hidden in a script, an alias, `bash -c` or `eval` is not seen.

To stop direct pushes for real, protect the app repository on GitHub (branch protection or rulesets). DKOD's Deliver does not need a person to push.

## Docs

https://dkod.ai/docs

## License

MIT
