import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeProjectRoots, claudeSkills, codexSkills, piSkills } from './skills'

const skillFile = (dir: string, name: string, body: string): void => {
  const folder = join(dir, '.claude', 'skills', name)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'SKILL.md'), body)
}

test('claude skills come from the project, then the user, and skip non-invocable ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'cerebro-skills-'))
  const home = mkdtempSync(join(tmpdir(), 'cerebro-skill-home-'))
  try {
    mkdirSync(join(root, '.git'))
    const nested = join(root, 'nested')
    mkdirSync(nested)
    skillFile(nested, 'review', '---\nname: review\ndescription: Review the diff\n---\n# Review\n')
    skillFile(root, 'ship', '---\nname: ship\ndescription: Ship it\n---\n')
    skillFile(root, 'hidden', '---\nname: hidden\ndescription: No\nuser-invocable: false\n---\n')
    skillFile(nested, 'ship', '---\nname: ship\ndescription: Nested ship\n---\n')
    mkdirSync(join(root, '.claude', 'commands'), { recursive: true })
    writeFileSync(
      join(root, '.claude', 'commands', 'deploy.md'),
      '---\ndescription: Deploy the app\n---\n'
    )
    skillFile(home, 'personal', '---\nname: personal\ndescription: Personal\n---\n')
    skillFile(home, 'ship', '---\nname: ship\ndescription: User ship\n---\n')
    const names = claudeSkills(nested, home).map((skill) => `${skill.name}:${skill.description}`)
    assert.deepEqual(names, [
      'deploy:Deploy the app',
      'personal:Personal',
      'review:Review the diff',
      'ship:Nested ship'
    ])
    assert.equal(
      claudeSkills(nested, home).find((skill) => skill.name === 'review')?.token,
      '@review'
    )
    assert.equal(
      claudeSkills(nested, home).find((skill) => skill.name === 'review')?.prompt,
      '/review'
    )
    const outside = mkdtempSync(join(tmpdir(), 'cerebro-skills-outside-'))
    try {
      skillFile(outside, 'only', '---\nname: only\ndescription: Only here\n---\n')
      assert.deepEqual(claudeProjectRoots(join(outside, 'child')), [join(outside, 'child')])
      assert.equal(
        claudeSkills(join(outside, 'child'), home).some((skill) => skill.name === 'only'),
        false
      )
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('codex and pi skill lists keep invocable skills and their prompt forms', () => {
  const codex = codexSkills(
    {
      data: [
        {
          cwd: '/repo',
          skills: [
            {
              name: 'review',
              description: 'Long description',
              enabled: true,
              path: '/repo/.agents/skills/review/SKILL.md',
              interface: { shortDescription: 'Review the change' }
            },
            { name: 'hidden', description: 'Off', enabled: false, path: '/hidden' }
          ]
        }
      ]
    },
    '/repo'
  )
  assert.deepEqual(
    codex.map((skill) => [skill.name, skill.token, skill.prompt, skill.description, skill.path]),
    [['review', '$review', '$review', 'Review the change', '/repo/.agents/skills/review/SKILL.md']]
  )
  const pi = piSkills({
    commands: [
      {
        name: 'skill:review',
        description: 'Review the change',
        source: 'skill',
        sourceInfo: { path: '/home/.pi/agent/skills/review/SKILL.md' }
      },
      { name: 'fix-tests', description: 'Not a skill', source: 'prompt', path: '/fix.md' }
    ]
  })
  assert.deepEqual(
    pi.map((skill) => [skill.name, skill.token, skill.prompt, skill.path]),
    [['review', '@review', '/skill:review', '/home/.pi/agent/skills/review/SKILL.md']]
  )
})
