// Content checks for the skill and the manifests. They sit outside test/ because the plugin test
// loader there refuses .md and .json imports and node:fs. Run with `bun test ./checks`.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const text = (p: string) => readFileSync(join(root, p), 'utf8')
const json = (p: string) => JSON.parse(text(p))

const SKILL = text('skills/dkod/SKILL.md')
const WIZARD = SKILL.slice(SKILL.indexOf('## New app: the wizard'))

test('the wizard section hands the attached spec to the first questions call and sends pre-filled answers', () => {
  expect(WIZARD).toContain('When the chat has an attached spec file, send its text as `spec`')
  expect(WIZARD).toContain('comes back pre-filled')
  expect(WIZARD).toContain('send the answer the user confirmed or changed')
})

test('the wizard still never answers for the user and asks every question the spec leaves open', () => {
  expect(WIZARD).toContain('Never answer a question for the user, and never skip one.')
  expect(WIZARD).toContain('Ask every question the spec does not answer.')
})

test('the skill steps stay in order: session, wizard questions, PRD, approval', () => {
  const marks = ['dkoder.session.start', 'dkoder.wizard.questions', 'dkoder.wizard.prd', 'dkoder.wizard.approve'].map((m) => SKILL.indexOf(m))
  expect(marks.every((i) => i >= 0)).toBe(true)
  expect(marks).toEqual([...marks].sort((a, b) => a - b))
  expect(SKILL.indexOf('## New app: the wizard')).toBeGreaterThan(marks[0])
})

test('pluginVersion in the skill is 0.17.0 and matches both plugin.json and both marketplace.json', () => {
  const v = /pluginVersion: "([^"]+)"/.exec(SKILL)?.[1]
  expect(v).toBe('0.17.0')
  expect(json('.claude-plugin/plugin.json').version).toBe(v)
  expect(json('.cursor-plugin/plugin.json').version).toBe(v)
  for (const f of ['.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json']) {
    for (const p of json(f).plugins) expect(p.version).toBe(v)
  }
})
