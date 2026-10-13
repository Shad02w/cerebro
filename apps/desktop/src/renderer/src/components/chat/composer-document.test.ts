import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { AgentSkill } from '@cerebro/core'
import { findSkillMatches, promoteSkillTransaction, textToContent } from './composer-document'

const skills: AgentSkill[] = [
  { id: 'a', name: 'A', description: '', path: '/a', token: '@A', prompt: '/A' },
  { id: 'b', name: 'B', description: '', path: '/b', token: '@B', prompt: '/B' },
  { id: 'c', name: 'C', description: '', path: '/c', token: '@C', prompt: '/C' },
  { id: 'ab', name: 'AB', description: '', path: '/ab', token: '@AB', prompt: '/AB' }
]

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }]
    },
    codeBlock: {
      content: 'text*',
      group: 'block',
      code: true,
      toDOM: () => ['pre', 0],
      parseDOM: [{ tag: 'pre' }]
    },
    text: { group: 'inline' },
    mention: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: {
        id: { default: null },
        label: { default: null },
        mentionSuggestionChar: { default: '@' },
        path: { default: null },
        prompt: { default: null }
      },
      toDOM: (node) => ['span', {}, `@${String(node.attrs.label)}`]
    }
  },
  marks: {
    code: {
      toDOM: () => ['code', 0],
      parseDOM: [{ tag: 'code' }]
    }
  }
})

const paragraphState = (text: string, atEnd = false): EditorState => {
  const paragraph = schema.node('paragraph', null, text ? [schema.text(text)] : [])
  const doc = schema.node('doc', null, [paragraph])
  return EditorState.create({
    schema,
    doc,
    selection: atEnd ? TextSelection.atEnd(doc) : TextSelection.atStart(doc)
  })
}

const rendered = (state: EditorState): string => {
  const parts: string[] = []
  state.doc.descendants((node) => {
    if (node.isText) parts.push(node.text ?? '')
    if (node.type.name === 'mention')
      parts.push(`${String(node.attrs.mentionSuggestionChar ?? '@')}${String(node.attrs.label)}`)
  })
  return parts.join('')
}

test('an exact skill matches without a menu commit, and a longer token does not', () => {
  const catalog = skills.filter((skill) => skill.name !== 'AB')
  const open = findSkillMatches('@A', 2, catalog)
  assert.equal(open.length, 1)
  assert.equal(open[0]?.skill.name, 'A')
  assert.equal(open[0]?.closed, false)
  assert.deepEqual(
    findSkillMatches('see @b.', null, catalog).map((match) => match.skill.name),
    ['B']
  )
  assert.equal(findSkillMatches('@AB', null, catalog).length, 0)
  assert.equal(findSkillMatches('@ZZ', null, catalog).length, 0)
  assert.equal(findSkillMatches('$A', null, catalog).length, 0)
  const longer = skills.filter((skill) => skill.name === 'A' || skill.name === 'AB')
  assert.equal(findSkillMatches('@AB', 3, longer)[0]?.skill.name, 'AB')
  assert.equal(findSkillMatches('@A ', null, longer)[0]?.closed, true)
  assert.equal(findSkillMatches('@AX', null, longer).length, 0)
  const codex = [
    { ...skills[0], id: 'review', name: 'review', token: '$review', prompt: '$review' }
  ]
  assert.equal(findSkillMatches('use $review.', null, codex)[0]?.skill.token, '$review')
})

test('a finished skill becomes a mention and an in-progress skill stays text', () => {
  const catalog = skills.filter((skill) => skill.name !== 'AB')
  assert.equal(promoteSkillTransaction(paragraphState('@A', true), catalog), null)
  const finished = paragraphState('see @b.', true)
  const tr = promoteSkillTransaction(finished, catalog)
  assert.ok(tr)
  assert.equal(rendered(finished.apply(tr)), 'see @B.')
  const away = paragraphState('@a', false)
  const awayTr = promoteSkillTransaction(away, catalog)
  assert.ok(awayTr)
  assert.equal(rendered(away.apply(awayTr)), '@A')
})

test('skills inside code stay plain text', () => {
  const catalog = skills.filter((skill) => skill.name !== 'AB')
  const code = schema.node('codeBlock', null, [schema.text('@A')])
  const doc = schema.node('doc', null, [code])
  const fenced = EditorState.create({ schema, doc, selection: TextSelection.atEnd(doc) })
  assert.equal(promoteSkillTransaction(fenced, catalog), null)
  const inline = schema.text('@A', [schema.marks.code.create()])
  const markedDoc = schema.node('doc', null, [schema.node('paragraph', null, [inline])])
  const marked = EditorState.create({
    schema,
    doc: markedDoc,
    selection: TextSelection.atEnd(markedDoc)
  })
  assert.equal(promoteSkillTransaction(marked, catalog), null)
})

test('stored messages highlight exact skills and leave code and images alone', () => {
  const catalog = skills.filter((skill) => skill.name !== 'AB')
  const tagged = textToContent('using @a.', { skills: catalog })
  assert.deepEqual(tagged.content?.[0]?.content, [
    { type: 'text', text: 'using ' },
    {
      type: 'mention',
      attrs: { id: 'A', label: 'A', mentionSuggestionChar: '@', path: '/a', prompt: '/A' }
    },
    { type: 'text', text: '.' }
  ])
  assert.deepEqual(textToContent('@AB', { skills: catalog }).content?.[0]?.content, [
    { type: 'text', text: '@AB' }
  ])
  assert.deepEqual(textToContent('`@A`', { skills: catalog }).content?.[0]?.content, [
    { type: 'text', text: '@A', marks: [{ type: 'code' }] }
  ])
  const image = textToContent('see [Image #1]', { attachments: [{ id: 'img' }] })
  assert.equal(image.content?.[0]?.content?.[1]?.type, 'imageChip')
  assert.equal(image.content?.[0]?.content?.[1]?.attrs?.attachmentId, 'img')
})
