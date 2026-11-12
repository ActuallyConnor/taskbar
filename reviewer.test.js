import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, parseComments } from './reviewer.js'

test('parse claude', () => {
  assert.deepEqual(parse('claude', '{"session_id":"s1","result":"ok"}'), { session: 's1', text: 'ok' })
  assert.throws(() => parse('claude', '{"is_error":true,"result":"boom"}'), /boom/)
})

test('parse codex', () => {
  const out = [
    '{"type":"thread.started","thread_id":"t1"}',
    'not json',
    '{"type":"item.completed","item":{"type":"command_execution"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"final"}}',
  ].join('\n')
  assert.deepEqual(parse('codex', out), { session: 't1', text: 'final' })
  assert.throws(() => parse('codex', '{"type":"turn.failed","error":{"message":"nope"}}'), /nope/)
})

test('parseComments', () => {
  const text = 'Here:\n```json\n[{"path":"a.js","line":3,"side":"new","body":"bug"},{"path":"a.js","body":"no line"}]\n```'
  assert.deepEqual(parseComments(text), [{ path: 'a.js', line: 3, side: 'new', body: 'bug' }])
  assert.throws(() => parseComments('No findings.'))
  // a code block inside a body must not end the list early
  const nested = '```json\n[{"path":"a.go","line":1,"body":"Fix:\\n```go\\nx := 1\\n```"}]\n```'
  assert.equal(parseComments(nested)[0].body, 'Fix:\n```go\nx := 1\n```')
})
