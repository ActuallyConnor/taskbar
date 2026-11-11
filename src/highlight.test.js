import { test } from 'node:test'
import assert from 'node:assert/strict'
import { highlightRows, langOf, splitLines } from './highlight.js'

test('splitLines reopens spans on each line', () => {
  assert.deepEqual(splitLines('a<span class="c">/* x\ny */</span>b'), ['a<span class="c">/* x</span>', '<span class="c">y */</span>b'])
})

test('langOf', () => {
  assert.equal(langOf('src/a.rs'), 'rs')
  assert.equal(langOf('Makefile'), 'makefile')
  assert.equal(langOf('a/B.scala'), 'scala')
  assert.equal(langOf('Dockerfile'), 'dockerfile')
  assert.equal(langOf('notes.unknownext'), undefined)
})

test('highlightRows keeps a block comment colored across lines and sides', () => {
  const rows = [
    { type: 'hunk', text: '@@' },
    { type: 'ctx', text: '/* start' },
    { type: 'del', text: 'old */' },
    { type: 'add', text: 'new */' },
  ]
  const html = highlightRows(rows, 'js')
  assert.equal(html[0], undefined)
  for (const i of [1, 2, 3]) assert.match(html[i], /^<span class="hljs-comment">/)
  assert.equal(highlightRows(rows, undefined).length, 0)
})
