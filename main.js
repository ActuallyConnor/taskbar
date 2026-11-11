import { app, BrowserWindow, ipcMain, Notification, safeStorage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { approve, changes, comment, details, fetchBoard, note, reply, resolve } from './gitlab.js'
import { ask, reviewPrompt } from './reviewer.js'
import { execFileSync } from 'node:child_process'

// keep the data folder named after the package, so the rename does not lose the saved token and reviews
app.setPath('userData', app.getPath('userData'))
app.setName('Task Bar')

// opened from Finder, the app gets a short PATH and cannot find claude, codex or glab; use the login shell's PATH
if (app.isPackaged) {
  try { process.env.PATH = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf %s "$PATH"'], { encoding: 'utf8', timeout: 5000 }) } catch {}
}

const POLL_MS = 2 * 60 * 1000
const ALERT = new Set(['Needs re-review', 'Has feedback'])

// ponytail: dev = vite dev server inside main process, so one command runs everything
const dev = !app.isPackaged && !process.argv.includes('--prod')
let devUrl
if (dev) {
  const { createServer } = await import('vite')
  const server = await (await createServer()).listen()
  devUrl = server.resolvedUrls.local[0]
}

const configPath = () => path.join(app.getPath('userData'), 'config.json')

function loadConfig() {
  try {
    const { host, token } = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    return { host, token: safeStorage.decryptString(Buffer.from(token, 'base64')) }
  } catch {
    return null
  }
}

function saveConfig({ host, token }) {
  const url = new URL(host)
  if (url.protocol !== 'https:') throw new Error('Host must use https://')
  if (!token?.trim()) throw new Error('Token is required')
  const encrypted = safeStorage.encryptString(token.trim()).toString('base64')
  fs.writeFileSync(configPath(), JSON.stringify({ host: url.origin, token: encrypted }), { mode: 0o600 })
}

let win
let state = {}

// AI review chats, keyed by card id. They live here (not in the page) so they keep running when the page reloads,
// and are saved to disk so they come back after a restart. The CLIs keep their own sessions, so follow-ups still work.
const reviewsPath = () => path.join(app.getPath('userData'), 'reviews.json')
function loadReviews() {
  try {
    const saved = JSON.parse(fs.readFileSync(reviewsPath(), 'utf8'))
    // a turn that was running when the app quit is gone; say so instead of spinning forever
    return new Map(Object.entries(saved).map(([id, r]) =>
      [Number(id), { ...r, busy: false, error: r.busy ? 'Stopped when the app quit. Try again.' : r.error }]))
  } catch {
    return new Map()
  }
}
const reviews = loadReviews()
function sendReviews() {
  fs.writeFileSync(reviewsPath(), JSON.stringify(Object.fromEntries(reviews)), { mode: 0o600 })
  win?.webContents.send('reviews', Object.fromEntries(reviews))
}
// Past notifications, newest first, saved to disk so the list survives a restart.
const notificationsPath = () => path.join(app.getPath('userData'), 'notifications.json')
let notifications = (() => { try { return JSON.parse(fs.readFileSync(notificationsPath(), 'utf8')) } catch { return [] } })()
function sendNotifications() {
  fs.writeFileSync(notificationsPath(), JSON.stringify(notifications), { mode: 0o600 })
  win?.webContents.send('notifications', notifications)
}

const openMr = id => (win.show(), win.focus(), win.webContents.send('select', id))

function push(card, title) {
  const body = `${card.title}\n${card.ref}`
  // ponytail: keep the last 100; older ones drop off
  notifications = [{ id: crypto.randomUUID(), mrId: card.id, title, body, at: new Date().toISOString() }, ...notifications].slice(0, 100)
  sendNotifications()
  const n = new Notification({ title, body })
  n.on('click', () => openMr(card.id))
  n.show()
  app.dock?.bounce() // one jump in the Dock; macOS skips it when the app is already in front
}

let seen = null // status of each card at the last load; null until first load so startup does not spam

function notify(board) {
  const cards = [...board.reviewing, ...board.mine]
  if (seen) {
    for (const c of cards) {
      const was = seen.get(c.id)
      if (ALERT.has(c.status) && !ALERT.has(was)) push(c, c.status)
      else if (!was && board.reviewing.includes(c)) push(c, 'Review requested')
    }
  }
  seen = new Map(cards.map(c => [c.id, c.status]))
  app.setBadgeCount(cards.filter(c => ALERT.has(c.status)).length)
}

async function load() {
  const config = loadConfig()
  if (!config) return (state = { needsConfig: true })
  try {
    const board = await fetchBoard(config)
    notify(board)
    // drop chats for MRs that left the board (merged or closed)
    const onBoard = new Set([...board.reviewing, ...board.mine].map(c => c.id))
    const gone = [...reviews.keys()].filter(id => !onBoard.has(id) && !reviews.get(id).busy)
    if (gone.length) (gone.forEach(id => reviews.delete(id)), sendReviews())
    state = { board, fetchedAt: new Date().toISOString() }
  } catch (e) {
    state = { ...state, error: e.message }
  }
  return state
}

const openExternalHandler = ({ url }) => {
  if (url.startsWith('https://')) shell.openExternal(url)
  return { action: 'deny' }
}

const mrId = ({ projectId, iid }) => {
  if (!Number.isInteger(projectId) || !Number.isInteger(iid)) throw new Error('Bad MR id')
  return [projectId, iid]
}

let inflight
const refresh = () => (inflight ??= load().finally(() => (inflight = null))).then(s => (win?.webContents.send('state', s), s))

ipcMain.handle('config:get', () => ({ host: loadConfig()?.host ?? 'https://gitlab.com' }))
ipcMain.handle('config:save', (_e, c) => {
  saveConfig(c)
  seen = null
  return refresh()
})
ipcMain.handle('refresh', refresh)
ipcMain.handle('mr:details', (_e, mr) => details(loadConfig(), ...mrId(mr)))
ipcMain.handle('mr:changes', (_e, mr) => changes(loadConfig(), ...mrId(mr)))
const text = s => { if (typeof s !== 'string' || !s.trim()) throw new Error('Comment is empty'); return s }
const discussion = id => { if (!/^[0-9a-f]+$/.test(id)) throw new Error('Bad thread id'); return id }
const line = n => { if (n !== undefined && !Number.isInteger(n)) throw new Error('Bad line'); return n }
const row = r => {
  if (!['add', 'del', 'ctx'].includes(r?.type)) throw new Error('Bad line')
  return { type: r.type, old: line(r.old), new: line(r.new), pos: r.pos && [line(r.pos[0]), line(r.pos[1])] }
}
ipcMain.handle('mr:comment', (_e, mr, c) => comment(loadConfig(), ...mrId(mr), {
  refs: c.refs, oldPath: String(c.oldPath), newPath: String(c.newPath), start: row(c.start), end: row(c.end), body: text(c.body),
}))
ipcMain.handle('mr:note', (_e, mr, body) => note(loadConfig(), ...mrId(mr), text(body)))
ipcMain.handle('mr:reply', (_e, mr, id, body) => reply(loadConfig(), ...mrId(mr), discussion(id), text(body)))
ipcMain.handle('mr:resolve', (_e, mr, id, resolved) => resolve(loadConfig(), ...mrId(mr), discussion(id), resolved))
ipcMain.handle('mr:approve', async (_e, mr) => {
  await approve(loadConfig(), ...mrId(mr))
  return refresh()
})


const cardFor = mr => {
  const [projectId, iid] = mrId(mr)
  const c = state.board && [...state.board.reviewing, ...state.board.mine].find(c => c.projectId === projectId && c.iid === iid)
  if (!c) throw new Error('MR not on the board')
  return c
}

function turn(card, prompt) {
  const r = reviews.get(card.id)
  r.busy = true
  r.error = null
  sendReviews()
  ask(r.provider, prompt, r.session)
    .then(({ session, text }) => { r.session = session; r.messages.push({ role: 'assistant', text }) })
    .catch(e => { r.error = e.message })
    .finally(() => { r.busy = false; sendReviews(); push(card, r.error ? 'AI review failed' : 'AI review finished') })
}

ipcMain.handle('notifications:get', () => notifications)
ipcMain.handle('notifications:clear', (_e, id) => {
  notifications = typeof id === 'string' ? notifications.filter(n => n.id !== id) : []
  sendNotifications()
})

ipcMain.handle('review:get', () => Object.fromEntries(reviews))
ipcMain.handle('review:start', (_e, mr, provider) => {
  const c = cardFor(mr)
  if (!['claude', 'codex'].includes(provider)) throw new Error('Bad provider')
  if (reviews.get(c.id)?.busy) return
  reviews.set(c.id, { provider, messages: [], busy: false })
  turn(c, reviewPrompt(c.url))
})
ipcMain.handle('review:ask', (_e, mr, question) => {
  const c = cardFor(mr)
  const r = reviews.get(c.id)
  if (!r || r.busy || !r.session || !question?.trim()) return
  r.messages.push({ role: 'user', text: question.trim() })
  turn(c, question.trim())
})

const icon = path.join(import.meta.dirname, 'icon.png')

app.whenReady().then(() => {
  app.dock?.setIcon(icon) // macOS ignores the window icon; set the Dock icon instead
  win = new BrowserWindow({
    width: 1300,
    height: 800,
    icon,
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  })
  win.maximize() // fill the screen (not macOS full screen mode); the size above is the size when you un-maximize
  win.webContents.setWindowOpenHandler(openExternalHandler)
  win.webContents.on('will-navigate', (e, url) => {
    // a link click in a comment must never replace the app; send it to the browser instead
    e.preventDefault()
    openExternalHandler({ url })
  })
  dev ? win.loadURL(devUrl) : win.loadFile('dist/index.html')
  setInterval(refresh, POLL_MS)
})

app.on('window-all-closed', () => app.quit())
