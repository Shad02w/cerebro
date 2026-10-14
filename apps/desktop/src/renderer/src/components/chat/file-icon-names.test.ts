import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileIconName } from './file-icon-names'

test('file icons follow the extension, then a known file name', () => {
  assert.equal(fileIconName('src/app.ts'), 'typescript')
  assert.equal(fileIconName('src/App.TSX'), 'typescript')
  assert.equal(fileIconName('README.md'), 'markdown')
  assert.equal(fileIconName('Dockerfile'), 'docker')
  assert.equal(fileIconName('docker-compose.yml'), 'docker')
  assert.equal(fileIconName('package.json'), 'npm')
  assert.equal(fileIconName('pnpm-lock.yaml'), 'pnpm')
  assert.equal(fileIconName('notes.txt'), null)
  assert.equal(fileIconName('Makefile'), null)
})
