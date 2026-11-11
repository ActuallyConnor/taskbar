import { app, BrowserWindow, ipcMain, Notification, safeStorage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { approve, details, fetchBoard } from './gitlab.js'
import { ask, reviewPrompt } from './reviewer.js'

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
let alerted = null // ids already in an alert column; null until first load so startup does not spam

function notify(board) {
  const hot = [...board.reviewing, ...board.mine].filter(c => ALERT.has(c.status))
  if (alerted) {
    for (const c of hot.filter(c => !alerted.has(c.id))) {
      const n = new Notification({ title: c.status, body: `${c.title}\n${c.ref}` })
      n.on('click', () => (win.show(), win.webContents.send('select', c.id)))
      n.show()
    }
  }
  alerted = new Set(hot.map(c => c.id))
  app.setBadgeCount(hot.length)
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
  alerted = null
  return refresh()
})
ipcMain.handle('refresh', refresh)
ipcMain.handle('mr:details', (_e, mr) => details(loadConfig(), ...mrId(mr)))
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

function turn(id, prompt) {
  const r = reviews.get(id)
  r.busy = true
  r.error = null
  sendReviews()
  ask(r.provider, prompt, r.session)
    .then(({ session, text }) => { r.session = session; r.messages.push({ role: 'assistant', text }) })
    .catch(e => { r.error = e.message })
    .finally(() => { r.busy = false; sendReviews() })
}

ipcMain.handle('review:get', () => Object.fromEntries(reviews))
ipcMain.handle('review:start', (_e, mr, provider) => {
  const c = cardFor(mr)
  if (!['claude', 'codex'].includes(provider)) throw new Error('Bad provider')
  if (reviews.get(c.id)?.busy) return
  reviews.set(c.id, { provider, messages: [], busy: false })
  turn(c.id, reviewPrompt(c.url))
})
ipcMain.handle('review:ask', (_e, mr, question) => {
  const c = cardFor(mr)
  const r = reviews.get(c.id)
  if (!r || r.busy || !r.session || !question?.trim()) return
  r.messages.push({ role: 'user', text: question.trim() })
  turn(c.id, question.trim())
})

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1300,
    height: 800,
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  })
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
