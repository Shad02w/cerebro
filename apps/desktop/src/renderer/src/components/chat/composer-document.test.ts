import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { findAddTagMatches, promoteAddTagTransaction, textToContent } from './composer-document'

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
        mentionSuggestionChar: { default: '@' }
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
    if (node.type.name === 'mention') parts.push(`@${String(node.attrs.label)}`)
  })
  return parts.join('')
}

test('an exact Add tag matches without a menu commit, and a longer token does not', () => {
  const open = findAddTagMatches('@A', 2)
  assert.equal(open.length, 1)
  assert.equal(open[0]?.tag.label, 'A')
  assert.equal(open[0]?.closed, false)
  assert.deepEqual(
    findAddTagMatches('see @b.', null).map((match) => match.tag.label),
    ['B']
  )
  assert.equal(findAddTagMatches('@AB', null).length, 0)
  assert.equal(findAddTagMatches('@ZZ', null).length, 0)
  const catalog = [
    { id: 'a', label: 'A' },
    { id: 'ab', label: 'AB' }
  ]
  assert.equal(findAddTagMatches('@AB', 3, catalog)[0]?.tag.label, 'AB')
  assert.equal(findAddTagMatches('@A ', null, catalog)[0]?.closed, true)
  assert.equal(findAddTagMatches('@AX', null, catalog).length, 0)
})

test('a finished tag becomes a mention and an in-progress tag stays text', () => {
  assert.equal(promoteAddTagTransaction(paragraphState('@A', true)), null)
  const finished = paragraphState('see @b.', true)
  const tr = promoteAddTagTransaction(finished)
  assert.ok(tr)
  assert.equal(rendered(finished.apply(tr)), 'see @B.')
  const away = paragraphState('@a', false)
  const awayTr = promoteAddTagTransaction(away)
  assert.ok(awayTr)
  assert.equal(rendered(away.apply(awayTr)), '@A')
})

test('tags inside code stay plain text', () => {
  const code = schema.node('codeBlock', null, [schema.text('@A')])
  const doc = schema.node('doc', null, [code])
  const fenced = EditorState.create({ schema, doc, selection: TextSelection.atEnd(doc) })
  assert.equal(promoteAddTagTransaction(fenced), null)
  const inline = schema.text('@A', [schema.marks.code.create()])
  const markedDoc = schema.node('doc', null, [schema.node('paragraph', null, [inline])])
  const marked = EditorState.create({
    schema,
    doc: markedDoc,
    selection: TextSelection.atEnd(markedDoc)
  })
  assert.equal(promoteAddTagTransaction(marked), null)
})

test('stored messages highlight exact tags and leave code and images alone', () => {
  const tagged = textToContent('using @a.')
  assert.deepEqual(tagged.content?.[0]?.content, [
    { type: 'text', text: 'using ' },
    { type: 'mention', attrs: { id: 'a', label: 'A', mentionSuggestionChar: '@' } },
    { type: 'text', text: '.' }
  ])
  assert.deepEqual(textToContent('@AB').content?.[0]?.content, [{ type: 'text', text: '@AB' }])
  assert.deepEqual(textToContent('`@A`').content?.[0]?.content, [
    { type: 'text', text: '@A', marks: [{ type: 'code' }] }
  ])
  const image = textToContent('see [Image #1]', { attachments: [{ id: 'img' }] })
  assert.equal(image.content?.[0]?.content?.[1]?.type, 'imageChip')
  assert.equal(image.content?.[0]?.content?.[1]?.attrs?.attachmentId, 'img')
})
