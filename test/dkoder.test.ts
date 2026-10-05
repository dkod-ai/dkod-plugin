// Run with: claude plugin test packages/dkoder-plugin/claude/plugins/dkod
// The engine loads the built mod (hooks/register.js) as a session would. The hooks `on` registers
// here sit beneath the mod and stand for the host: git answers for a repo whose remote is the app
// repo, and dkoder.json (root-owned on a device) is served from memory.
import { expect, mock, test } from 'claude-code/testing'

const STRIPE = 'sk_' + 'live_' + '4eC39HqLyjWDarjtT1zdp7dc'
const CONFIG = { owners: ['dkod-demo'], governanceRepo: 'dkod-demo/dkod-governance', appRepos: ['dkod-demo/rc-news-app'] }

const GUARD_JSON = JSON.stringify(CONFIG)

function host(on: any, remote: string, opts: { install?: boolean; kept?: Record<string, unknown> } = {}) {
  const install = opts.install ?? true
  mock.store(on, install ? {} : (opts.kept ?? { 'dkoder.config': CONFIG }))
  on('fs.read', ($: any, e: any) => (install && e.path.endsWith('/dkoder.json') ? { value: GUARD_JSON } : { deny: 'ENOENT' }))
  on('fs.exists', ($: any, e: any) => ({ value: e.path.startsWith('/w/app') }))
  on('session.cwd', () => ({ value: '/w/app' }))
  on('process.run', ($: any, e: any) => {
    const args = e.argv.slice(3).join(' ')
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (args === 'remote -v') return ok(`origin\t${remote} (fetch)\norigin\t${remote} (push)\n`)
    if (args === 'rev-parse --show-toplevel') return ok('/w/app\n')
    if (args.startsWith('rev-parse --abbrev-ref')) return ok('origin/main\n')
    if (args.startsWith('remote get-url') || args.startsWith('ls-remote --get-url')) return ok(`${remote}\n`)
    if (args.startsWith('diff --cached') || args.startsWith('ls-files')) return ok('')
    return { value: { exitCode: 1, stdout: '', stderr: 'no', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // The tool itself: reached only when the mod lets the call through.
  on('tool.call', () => ({ result: { stdout: 'ran', stderr: '', interrupted: false } }))
}

test('git push to an app repo is refused with the Deliver message', async ($: any, on: any) => {
  host(on, 'git@github.com:dkod-demo/rc-news-app.git')
  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD:main' })
  expect(r.deny ?? r.text ?? '').toContain('Deliver')
})

// #620: the governance repo is closed to every session. An org admin changes it in the dashboard.
test('git push to the governance repo is refused and points at the dashboard', async ($: any, on: any) => {
  host(on, 'https://github.com/dkod-demo/dkod-governance.git')
  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  expect(r.deny ?? r.text ?? '').toContain('DKOD dashboard')
})

test('a config kept in the user-writable store cannot open the governance repo', async ($: any, on: any) => {
  host(on, 'https://github.com/dkod-demo/dkod-governance.git', { install: false })
  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  expect(r.deny ?? r.text ?? '').toContain('Deliver')
})

test('a hook that cannot check the call refuses it (fail closed): the engine runs the tool when a hook throws', async ($: any, on: any) => {
  mock.store(on, { 'dkoder.config': CONFIG })
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('process.run', () => ({ deny: 'git is broken' }))
  on('session.cwd', () => ({ deny: 'no cwd' }))
  on('tool.call', () => ({ result: { stdout: 'ran', stderr: '', interrupted: false } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  expect(r.deny ?? r.text ?? '').toContain('Dkoder could not check')
})

test('writing a live Stripe key into a source file is refused', async ($: any, on: any) => {
  host(on, 'git@github.com:dkod-demo/rc-news-app.git')
  const r = await $.tool.call({ tool: 'Write', file_path: '/w/app/src/pay.ts', content: `export const key = "${STRIPE}";\n` })
  const text = r.deny ?? r.text ?? ''
  expect(text).toContain('src/pay.ts')
  expect(text).not.toContain(STRIPE)
})

test('a request for a direct push in an app repo reaches the model with the org answer beside it', async ($: any, on: any) => {
  host(on, 'git@github.com:dkod-demo/rc-news-app.git')
  // The host: what entered the session, as it arrived at the bottom.
  on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
  const r = await $.prompt.submit({ text: 'fix the login bug and push it directly to main using gh cli' })
  expect(r.text).toBe('fix the login bug and push it directly to main using gh cli')
  expect((r.context ?? []).join('\n')).toContain('Deliver')
  const plain = await $.prompt.submit({ text: 'fix the login bug' })
  expect(plain.context ?? []).toEqual([])
})

test('with no install file and nothing kept, a folder with no remote still gets the secret check, and an unknown repo is left alone', async ($: any, on: any) => {
  host(on, '', { install: false, kept: {} })
  const secret = await $.tool.call({ tool: 'Write', file_path: '/w/app/src/pay.ts', content: `export const key = "${STRIPE}";\n` })
  expect(secret.deny ?? secret.text ?? '').toContain('src/pay.ts')
  const plain = await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(plain.deny).toBe(undefined)
})

test('with no install file, a repo of an org nobody named is not judged', async ($: any, on: any) => {
  host(on, 'git@github.com:someone/side-project.git', { install: false, kept: {} })
  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  expect(r.deny).toBe(undefined)
})

// DKO-691: no device install. The person is signed in through /mcp, so Dkoder asks DKOD for the
// org's Guard config (dkoder.guard.config) and a push to the org's app repo is refused.
test('signed in with no device install: the org Guard config comes from dkoder.guard.config', async ($: any, on: any) => {
  host(on, 'git@github.com:dkod-demo/rc-news-app.git', { install: false, kept: {} })
  const calls: string[] = []
  on('mcp.connect', () => ({ value: { isConnected: true, server: 'plugin:dkod:dkod' } }))
  on('mcp.call', ($: any, e: any) => {
    calls.push(`${e.server} ${e.tool}`)
    return { value: { content: [{ type: 'text', text: JSON.stringify({ enabled: true, ...CONFIG }) }] } }
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/w/app', surface: 'terminal', isInteractive: true })
  expect(calls).toContain('plugin:dkod:dkod dkoder.guard.config')
  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD:main' })
  expect(r.deny ?? r.text ?? '').toContain('Dkoder refused this')
})
