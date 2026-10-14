import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claudeExposedSkills, codexSkills, piSkills } from './skills'

test('claude skills are the ones Claude Code exposed, including plugin skills', () => {
  const listed = claudeExposedSkills([
    {
      name: 'review',
      description: 'Review the diff',
      path: '/repo/.claude/skills/review/SKILL.md'
    },
    { name: 'formatter:lint', description: 'Lint with the plugin' },
    { name: 'apps/web:deploy', description: 'Deploy the web app' },
    { name: 'hidden', description: 'No', userInvocable: false },
    { name: 'help', description: 'Built-in help', builtin: true },
    { name: '/review', description: 'Duplicate' }
  ])
  assert.deepEqual(
    listed.map((skill) => [skill.name, skill.token, skill.prompt, skill.description]),
    [
      ['apps/web:deploy', '@apps/web:deploy', '/apps/web:deploy', 'Deploy the web app'],
      ['formatter:lint', '@formatter:lint', '/formatter:lint', 'Lint with the plugin'],
      ['review', '@review', '/review', 'Review the diff']
    ]
  )
  assert.equal(
    listed.find((skill) => skill.name === 'review')?.path,
    '/repo/.claude/skills/review/SKILL.md'
  )
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
