import hljs from 'highlight.js/lib/common'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import scala from 'highlight.js/lib/languages/scala'

// the common set plus languages seen in our repos; add more here as they come up
hljs.registerLanguage('scala', scala)
hljs.registerLanguage('dockerfile', dockerfile)

// Language from the file extension, or the file name (Makefile, Dockerfile). undefined = plain text.
export const langOf = path => {
  const name = path.split('/').pop().toLowerCase()
  return [name.split('.').pop(), name].find(l => hljs.getLanguage(l))
}

// hljs HTML for many lines → one HTML string per line. A span that crosses a newline
// (a block comment, a multi-line string) is closed at the end of the line and opened again on the next.
export function splitLines(html) {
  const lines = []
  const open = []
  let line = ''
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (part === '\n') { lines.push(line + '</span>'.repeat(open.length)); line = open.join('') }
    else {
      if (part.startsWith('<span')) open.push(part)
      else if (part === '</span>') open.pop()
      line += part
    }
  }
  lines.push(line)
  return lines
}

// HTML for each diff row (by index). Each hunk is highlighted as a block, once for the old side
// (context + removed lines) and once for the new side (context + added lines), so multi-line tokens keep their color.
// ponytail: a token that starts above the hunk (a long comment) is not seen; GitHub reads the full file for that.
export function highlightRows(rows, lang) {
  const html = []
  if (!lang) return html
  const run = idx => {
    if (!idx.length) return
    const lines = splitLines(hljs.highlight(idx.map(i => rows[i].text).join('\n'), { language: lang, ignoreIllegals: true }).value)
    idx.forEach((i, k) => { html[i] ??= lines[k] }) // context rows take the new side's HTML
  }
  let oldSide = [], newSide = []
  const flush = () => { run(newSide); run(oldSide); oldSide = []; newSide = [] }
  rows.forEach((r, i) => {
    if (r.type === 'hunk') return flush()
    if (r.type !== 'add') oldSide.push(i)
    if (r.type !== 'del') newSide.push(i)
  })
  flush()
  return html
}
