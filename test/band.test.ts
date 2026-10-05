// Run with: claude plugin test packages/dkoder-plugin/claude/plugins/dkod
// The band above the prompt, drawn by the built mod on the terminal and on the desktop: the DKOD
// wordmark in cyan while signed in, yellow with how to sign in while the DKOD MCP server asks for
// authentication, and the Guard icon that pulses in the decision's color when Guard judges an action.
import { expect, mock, test } from 'claude-code/testing'

const CONFIG = { owners: ['dkod-demo'], governanceRepo: 'dkod-demo/dkod-governance', appRepos: ['dkod-demo/rc-news-app'] }
const CYAN = '#22d3ee'
const YELLOW = '#facc15'
const CORAL = '#fb7185'

function host(on: any, mcp: 'ok' | 'auth') {
  mock.store(on, {})
  on('fs.read', ($: any, e: any) => (e.path.endsWith('/dkoder.json') ? { value: JSON.stringify(CONFIG) } : { deny: 'ENOENT' }))
  on('fs.exists', ($: any, e: any) => ({ value: e.path.startsWith('/w/app') }))
  on('session.cwd', () => ({ value: '/w/app' }))
  on('mcp.connect', () => ({ value: mcp === 'ok' ? { isConnected: true, server: 'plugin:dkod:dkod' } : { isConnected: false, reason: 'auth', message: 'dkod needs authentication' } }))
  on('process.run', ($: any, e: any) => {
    const args = e.argv.slice(3).join(' ')
    const remote = 'git@github.com:dkod-demo/rc-news-app.git'
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (args === 'remote -v') return ok(`origin\t${remote} (fetch)\norigin\t${remote} (push)\n`)
    if (args === 'rev-parse --show-toplevel') return ok('/w/app\n')
    if (args.startsWith('remote get-url') || args.startsWith('ls-remote --get-url')) return ok(`${remote}\n`)
    return { value: { exitCode: 1, stdout: '', stderr: 'no', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', () => ({ result: { stdout: 'ran', stderr: '', interrupted: false } }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  // The engine's own band beneath Guard's: nothing to draw.
  on('ui.render', ($: any, e: any) => (globalThis as any).h($.ui.resolve(e).Box, { key: 'engine-band' }))
}

const band = (surface: 'terminal' | 'desktop') => ({
  plugin: 'dkod',
  surface,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as any,
})

async function letters(ui: any) {
  const found = []
  for (const ch of ['D', 'K', 'O']) found.push(await ui.find({ type: 'Text', text: new RegExp(`^${ch}$`) }))
  return found
}

test('signed in: the DKOD wordmark is cyan and the sweep lights one letter at a time', async ($: any, on: any) => {
  host(on, 'ok')
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/w/app', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    const [d, k] = await letters(ui)
    expect(d?.props.color).toBe(CYAN)
    expect(k?.props.color).toBe(CYAN)
    expect((await ui.find({ type: 'Text', text: /Deliver required/ }))).toBeDefined()
    // Within one sweep a letter is lit, lighter than the rest, and the sweep moves on.
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      await clock.advance(120)
      const lit = (await letters(ui)).findIndex((t) => t?.props.color !== CYAN)
      if (lit >= 0) seen.add(String(lit))
    }
    expect(seen.size).toBeGreaterThan(1)
    await ui.unmount()
  }
})

test('not signed in: the wordmark turns yellow and the line says how to sign in', async ($: any, on: any) => {
  host(on, 'auth')
  mock.clock(on)
  await $.session.start({ cwd: '/w/app', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    const [d] = await letters(ui)
    expect(d?.props.color).toBe(YELLOW)
    expect(await ui.find({ type: 'Text', text: /Sign in to DKOD for Deliver and your organization's Guard rules: type \/mcp/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a blocked push makes the Guard icon pulse coral and names what was blocked, never the command', async ($: any, on: any) => {
  host(on, 'ok')
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/w/app', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    const r = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD:feat' })
    expect(r.text ?? r.deny ?? '').toContain('Deliver')
    await clock.advance(120)
    const line = await ui.find({ type: 'Text', text: /blocked push · dkod-demo\/rc-news-app/ })
    expect(line?.props.color).toBe(CORAL)
    expect(await ui.find({ type: 'Text', text: /HEAD:feat/ })).toBeUndefined()
    const icon = await ui.find({ type: 'Text', text: /[◇◈◆]/ })
    expect(icon?.props.color).toBe(CORAL)
    // The pulse settles and the line goes back to the status.
    await clock.advance(9000)
    expect(await ui.find({ type: 'Text', text: /blocked push/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /[◇◈◆]/ }))?.props.color).toBe(CYAN)
    await ui.unmount()
  }
})

test('session start writes the backstop heartbeat for this session, and the clock keeps it fresh', async ($: any, on: any) => {
  host(on, 'ok')
  mock.env(on, { HOME: '/home/dev' })
  const clock = mock.clock(on)
  on('session.id', () => ({ value: 'sess-123' }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', ($: any, e: any) => { writes.push({ path: e.path, text: e.text }); return { value: undefined } })
  await $.session.start({ cwd: '/w/app', surface: 'terminal', isInteractive: true })
  expect(writes.map((w) => w.path)).toContain('/home/dev/.dkoder/heartbeat/sess-123')
  const first = writes.length
  await clock.advance(6000)
  expect(writes.length).toBeGreaterThan(first)
  expect(writes[writes.length - 1]!.text).toMatch(/^\d+$/)
})
