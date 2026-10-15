import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  skillMentionsFor,
  skillPromptFor,
  skillPromptText,
  skillTokenFor,
  skillTrigger
} from './skills'

test('each harness shows /name and keeps its own prompt form', () => {
  assert.equal(skillTrigger('codex'), '/')
  assert.equal(skillTrigger('claude'), '/')
  assert.equal(skillTrigger('pi'), '/')
  assert.equal(skillTokenFor('codex', 'review'), '/review')
  assert.equal(skillPromptFor('codex', 'review'), '$review')
  assert.equal(skillPromptFor('claude', 'review'), '/review')
  assert.equal(skillPromptFor('pi', 'review'), '/skill:review')
  assert.equal(skillPromptFor('claude', 'formatter:lint'), '/formatter:lint')
  assert.equal(skillTokenFor('claude', 'formatter:lint'), '/formatter:lint')
})

test('skill prompt rewrite leaves code alone and prefers the longer token', () => {
  const skills = [
    {
      name: 'review',
      path: '/review',
      token: '/review',
      prompt: '$review'
    },
    {
      name: 'review-docs',
      path: '/docs',
      token: '/review-docs',
      prompt: '$review-docs'
    }
  ]
  const text = ['see /review and /review-docs', '```', '/review', '```', 'keep `/review`'].join(
    '\n'
  )
  assert.equal(
    skillPromptText(text, skills),
    ['see $review and $review-docs', '```', '/review', '```', 'keep `/review`'].join('\n')
  )
  assert.equal(
    skillPromptText('use /review', [{ ...skills[0], token: '/review', prompt: '/review' }]),
    'use /review'
  )
})

test('skill mentions are derived for the harness and must appear in the message', () => {
  assert.deepEqual(
    skillMentionsFor('claude', 'please /Review.', [{ name: 'Review', path: '/a' }]),
    [{ name: 'Review', path: '/a', token: '/Review', prompt: '/Review' }]
  )
  assert.deepEqual(
    skillMentionsFor('codex', '/review', [{ name: 'review', path: '  /skills/review/SKILL.md  ' }]),
    [
      {
        name: 'review',
        path: '/skills/review/SKILL.md',
        token: '/review',
        prompt: '$review'
      }
    ]
  )
  assert.equal(skillMentionsFor('pi', '/review', [{ name: 'review' }])[0]?.prompt, '/skill:review')
  assert.throws(
    () => skillMentionsFor('claude', 'hello', [{ name: 'review', path: '/a' }]),
    /missing/
  )
  assert.throws(
    () => skillMentionsFor('claude', '/review', [{ name: '../review' }]),
    /Invalid skill/
  )
  assert.throws(() => skillMentionsFor('claude', '/review-docs', [{ name: 'review' }]), /missing/)
  assert.throws(
    () => skillMentionsFor('claude', '/formatter', [{ name: 'formatter:lint' }]),
    /missing/
  )
  assert.equal(
    skillMentionsFor('claude', 'run /formatter:lint now', [{ name: 'formatter:lint' }])[0]?.prompt,
    '/formatter:lint'
  )
})
