import {
  AudioInputSource,
  OsEventTypeList,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { ApiError, api, type Extraction, type Task } from './api'
import { createListenBuffer, postListen } from './asr/stt'
import {
  confirmCopy,
  emptyListCopy,
  errorCopy,
  idleCopy,
  listHeader,
  listItem,
  listeningCopy,
  markCopy,
  notPromiseCopy,
  pairCopy,
  savedCopy,
} from './copy'
import { createDisplay } from './display'
import { mountUi } from './ui'

const TOKEN_KEY = 'kept.session'
const SNAPSHOT_KEY = 'kept.idle'

type Screen =
  | 'pair'
  | 'idle'
  | 'listening'
  | 'confirm'
  | 'reject'
  | 'saved'
  | 'list'
  | 'mark'
  | 'error'

type ErrorKind = 'hear' | 'extract' | 'save' | 'tasks' | 'mic' | 'pair'

const ui = mountUi((text) => {
  if (!booted) {
    queuedInject = text
    return
  }
  void runInject(text)
})

const pcm = createListenBuffer()
let bridge: EvenAppBridge
let display: ReturnType<typeof createDisplay>
let screen: Screen = 'pair'
let token = ''
let tasks: Task[] = []
let extraction: Extraction | null = null
let savedTitle = ''
let savedDue = ''
let markIndex = -1
let errorKind: ErrorKind = 'tasks'
let errorDetail = ''
let pairCode = ''
let secondsLeft = 20
let listenTimer: number | null = null
let pollTimer: number | null = null
let op = 0
let lastGestureAt = 0
let lastGesture = ''
let cleaned = false
let listenEpoch = 0
let clickTimer: number | null = null
let renderChain: Promise<void> = Promise.resolve()
let booted = false
let queuedInject: string | null = null

console.log('[kept] waiting for bridge')
bridge = await waitForEvenAppBridge()
display = createDisplay(bridge)
try {
  await display.boot('KEPT\nstarting')
} catch (err) {
  ui.setError(err instanceof Error ? err.message : 'Could not create the glasses page')
  throw err
}
console.log('[kept] ready')
bridge.onEvenHubEvent(onEvent)
window.addEventListener('beforeunload', () => {
  void shutdown()
})

token = await restoreToken()
if (!token && import.meta.env.DEV) token = await devPair()
if (token) await saveToken(token)

booted = true
const injectQuery = import.meta.env.DEV ? queuedInject || new URLSearchParams(location.search).get('inject') : null
queuedInject = null
if (token && injectQuery) await runInject(injectQuery)
else if (token) await showIdle()
else await showPair()

function currentOp(): number {
  return op
}

function cancelOp(): number {
  op += 1
  listenEpoch += 1
  if (clickTimer !== null) window.clearTimeout(clickTimer)
  clickTimer = null
  return op
}

async function restoreToken(): Promise<string> {
  const local = localStorage.getItem(TOKEN_KEY)
  if (local) return local
  try {
    const stored = await bridge.getLocalStorage(TOKEN_KEY)
    if (stored) {
      localStorage.setItem(TOKEN_KEY, stored)
      return stored
    }
  } catch {
    /* The host store is only a backup for process death. */
  }
  return ''
}

async function saveToken(value: string) {
  token = value
  if (value) localStorage.setItem(TOKEN_KEY, value)
  else localStorage.removeItem(TOKEN_KEY)
  try {
    await bridge.setLocalStorage(TOKEN_KEY, value)
  } catch {
    /* localStorage already has the session. */
  }
}

async function devPair(): Promise<string> {
  try {
    const result = await api<{ sessionToken: string }>('/pair', { method: 'POST', json: { code: 'dev' } })
    return result.sessionToken
  } catch {
    return ''
  }
}

function paint(name: Screen, content: string, list?: string[]): Promise<void> {
  const ticket = currentOp()
  const job = renderChain.then(async () => {
    if (ticket !== currentOp()) return
    screen = name
    ui.setStatus(name)
    ui.setGlasses(list ? `${content}\n${list.join('\n')}` : content)
    ui.setError('')
    console.log('[kept] screen', name)
    if (list) await display.showList(content, list)
    else await display.showText(content)
  })
  renderChain = job.catch(() => undefined)
  return job
}

async function showPair() {
  stopPoll()
  const mine = cancelOp()
  try {
    const challenge = await api<{ code: string; expiresAt: number }>('/pair/challenge')
    if (mine !== currentOp()) return
    pairCode = challenge.code
    await paint('pair', pairCopy(pairCode))
    pollTimer = window.setInterval(() => {
      void pollPair(challenge.code, mine)
    }, 1500)
  } catch (err) {
    if (mine !== currentOp()) return
    errorKind = 'pair'
    errorDetail = messageOf(err)
    await paint('error', errorCopy('KEPT', errorDetail))
  }
}

async function pollPair(code: string, mine: number) {
  try {
    const status = await api<{ status: string; sessionToken?: string }>(`/pair/status?code=${encodeURIComponent(code)}`)
    if (mine !== currentOp() || !status.sessionToken) return
    stopPoll()
    await saveToken(status.sessionToken)
    await showIdle()
  } catch {
    /* Keep the code on screen while the server catches up. */
  }
}

function stopPoll() {
  if (pollTimer !== null) window.clearInterval(pollTimer)
  pollTimer = null
}

async function showIdle() {
  stopPoll()
  await stopMic()
  const mine = cancelOp()
  const cached = localStorage.getItem(SNAPSHOT_KEY)
  if (cached && mine === currentOp()) {
    try {
      tasks = JSON.parse(cached) as Task[]
      await paint('idle', idleCopy(tasks))
    } catch {
      tasks = []
    }
  }
  try {
    tasks = await api<Task[]>('/tasks?scope=open', { token })
    if (mine !== currentOp()) return
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(tasks))
    await paint('idle', idleCopy(tasks))
  } catch (err) {
    if (mine !== currentOp()) return
    if (!cached) {
      errorKind = 'tasks'
      errorDetail = messageOf(err)
      await paint('error', errorCopy('KEPT', errorDetail))
    }
  }
}

async function startListen() {
  stopPoll()
  const mine = cancelOp()
  const epoch = listenEpoch
  pcm.reset()
  secondsLeft = 20
  screen = 'listening'
  try {
    await bridge.audioControl(true, AudioInputSource.Glasses)
  } catch {
    errorKind = 'mic'
    errorDetail = 'use inject on the phone'
    await paint('error', errorCopy('MIC UNAVAILABLE', errorDetail, '[press] ok'))
    return
  }
  if (mine !== currentOp()) {
    await stopMic()
    return
  }
  await paint('listening', listeningCopy(secondsLeft))
  listenTimer = window.setInterval(() => {
    void tickListen(mine, epoch)
  }, 1000)
}

async function tickListen(mine: number, epoch: number) {
  if (mine !== currentOp() || epoch !== listenEpoch || screen !== 'listening') return
  secondsLeft -= 1
  if (secondsLeft <= 0 || pcm.full()) {
    await finishListen(epoch)
    return
  }
  await paint('listening', listeningCopy(secondsLeft))
}

async function finishListen(epoch: number) {
  if (epoch !== listenEpoch || screen !== 'listening') return
  listenEpoch += 1
  const mine = currentOp()
  await stopMic()
  if (pcm.empty) {
    errorKind = 'hear'
    errorDetail = 'try again or inject'
    await paint('error', errorCopy("COULDN'T HEAR", errorDetail))
    return
  }
  try {
    const text = await postListen(pcm.snapshot(), token)
    if (mine !== currentOp()) return
    if (!text) {
      errorKind = 'hear'
      errorDetail = 'try again or inject'
      await paint('error', errorCopy("COULDN'T HEAR", errorDetail))
      return
    }
    await extractAndShow(text, mine)
  } catch (err) {
    if (mine !== currentOp()) return
    if (isHear(err)) {
      errorKind = 'hear'
      errorDetail = 'try again or inject'
      await paint('error', errorCopy("COULDN'T HEAR", errorDetail))
      return
    }
    errorKind = 'extract'
    errorDetail = messageOf(err)
    await paint('error', errorCopy('KEPT', errorDetail))
  }
}

async function runInject(text: string) {
  if (!token && import.meta.env.DEV) {
    token = await devPair()
    if (token) await saveToken(token)
  }
  if (!token) {
    await showPair()
    return
  }
  const mine = cancelOp()
  await stopMic()
  try {
    const result = await api<Extraction>('/inject-text', { method: 'POST', token, json: { text } })
    if (mine !== currentOp()) return
    showExtraction(result)
    await paintExtraction()
  } catch (err) {
    if (mine !== currentOp()) return
    errorKind = 'extract'
    errorDetail = messageOf(err)
    await paint('error', errorCopy('KEPT', errorDetail))
  }
}

async function extractAndShow(text: string, mine: number) {
  const result = await api<Extraction>('/extract', { method: 'POST', token, json: { text } })
  if (mine !== currentOp()) return
  showExtraction(result)
  await paintExtraction()
}

function showExtraction(result: Extraction) {
  extraction = result
}

async function paintExtraction() {
  if (!extraction) return
  if (!extraction.isCommitment) {
    await paint('reject', notPromiseCopy(extraction.title || 'not a promise'))
    return
  }
  await paint('confirm', confirmCopy(extraction))
}

async function savePromise() {
  if (!extraction?.isCommitment) return
  const mine = cancelOp()
  const pending = extraction
  try {
    await api('/tasks', {
      method: 'POST',
      token,
      json: { title: pending.title, dueISO: pending.dueISO, confirmToken: pending.confirmToken },
    })
    if (mine !== currentOp()) return
    savedTitle = pending.title
    savedDue = pending.dueLabel
    await paint('saved', savedCopy(savedTitle, savedDue))
    const fresh = await api<Task[]>('/tasks?scope=open', { token }).catch(() => null)
    if (fresh && mine === currentOp()) {
      tasks = fresh
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(tasks))
    }
  } catch (err) {
    if (mine !== currentOp()) return
    extraction = pending
    errorKind = 'save'
    errorDetail = messageOf(err)
    await paint('error', errorCopy('SAVE FAILED', errorDetail, '[press] retry  [swipe] back'))
  }
}

async function showList() {
  if (!token) return
  await stopMic()
  const mine = cancelOp()
  try {
    tasks = await api<Task[]>('/tasks?scope=open', { token })
    if (mine !== currentOp()) return
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(tasks))
  } catch (err) {
    if (mine !== currentOp()) return
    errorKind = 'tasks'
    errorDetail = messageOf(err)
    await paint('error', errorCopy('KEPT', errorDetail))
    return
  }
  if (tasks.length === 0) {
    await paint('list', emptyListCopy())
    return
  }
  await paint(
    'list',
    listHeader(),
    tasks.map((task) => listItem(task.title, task.dueLabel)),
  )
}

async function confirmDone() {
  const task = tasks[markIndex]
  if (!task) return
  const mine = cancelOp()
  try {
    await api(`/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', token, json: { done: true } })
    if (mine !== currentOp()) return
    await showList()
  } catch (err) {
    if (mine !== currentOp()) return
    errorKind = 'save'
    errorDetail = messageOf(err)
    await paint('error', errorCopy('KEPT', errorDetail))
  }
}

async function stopMic() {
  if (listenTimer !== null) window.clearInterval(listenTimer)
  listenTimer = null
  try {
    await bridge.audioControl(false)
  } catch {
    /* The mic may already be closed. */
  }
}

async function shutdown() {
  if (cleaned) return
  cleaned = true
  stopPoll()
  await stopMic()
}

function onEvent(event: EvenHubEvent) {
  const chunk = event.audioEvent?.audioPcm
  if (chunk && screen === 'listening') pcm.push(chunk)

  if (eventType(event.sysEvent) === OsEventTypeList.SYSTEM_EXIT_EVENT || eventType(event.sysEvent) === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    void shutdown()
    return
  }

  const gesture = gestureOf(event)
  if (!gesture) return
  const key = `${gesture.source}:${gesture.type}`
  const at = Date.now()
  if (key === lastGesture && at - lastGestureAt < 220) return
  lastGesture = key
  lastGestureAt = at
  void handleGesture(gesture.type, gesture.index)
}

function gestureOf(event: EvenHubEvent): { type: OsEventTypeList; source: string; index?: number } | null {
  if (event.listEvent) {
    const type = eventType(event.listEvent)
    if (type === null) return null
    return { type, source: 'list', index: event.listEvent.currentSelectItemIndex }
  }
  if (event.textEvent) {
    const type = eventType(event.textEvent)
    if (type === null) return null
    return { type, source: 'text' }
  }
  const type = eventType(event.sysEvent)
  if (type === null) return null
  if (
    type === OsEventTypeList.CLICK_EVENT ||
    type === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    type === OsEventTypeList.SCROLL_TOP_EVENT ||
    type === OsEventTypeList.SCROLL_BOTTOM_EVENT
  ) {
    return { type, source: 'sys' }
  }
  return null
}

function eventType(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

function scheduleClick(run: () => Promise<void>) {
  if (clickTimer !== null) window.clearTimeout(clickTimer)
  clickTimer = window.setTimeout(() => {
    clickTimer = null
    void run()
  }, 280)
}

async function handleGesture(type: OsEventTypeList, index?: number) {
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    if (clickTimer !== null) window.clearTimeout(clickTimer)
    clickTimer = null
    if (screen === 'idle' || screen === 'pair') {
      await bridge.shutDownPageContainer(1)
      return
    }
    if (screen === 'mark') {
      await showList()
      return
    }
    await showIdle()
    return
  }

  if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    if (screen === 'confirm') {
      extraction = null
      await showIdle()
      return
    }
    if (screen === 'mark' || screen === 'error') {
      if (screen === 'mark') await showList()
      else await showIdle()
      return
    }
    if (screen === 'idle') {
      await showList()
      return
    }
    return
  }

  if (type !== OsEventTypeList.CLICK_EVENT) return

  if (screen === 'pair' || (screen === 'error' && errorKind === 'pair')) {
    scheduleClick(() => showPair())
    return
  }
  if (screen === 'idle') {
    scheduleClick(() => startListen())
    return
  }
  if (screen === 'listening') {
    await finishListen(listenEpoch)
    return
  }
  if (screen === 'confirm') {
    await savePromise()
    return
  }
  if (screen === 'reject' || screen === 'saved') {
    await showIdle()
    return
  }
  if (screen === 'list') {
    if (tasks.length === 0) return
    if (typeof index !== 'number' || index < 0 || index >= tasks.length) return
    markIndex = index
    await paint('mark', markCopy(tasks[index]))
    return
  }
  if (screen === 'mark') {
    await confirmDone()
    return
  }
  if (screen === 'error') {
    if (errorKind === 'save' && extraction) await savePromise()
    else if (errorKind === 'hear' || errorKind === 'mic') await showIdle()
    else if (errorKind === 'extract') await showIdle()
    else await showIdle()
  }
}

function isHear(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 422 || /transcri|hear|empty/i.test(err.message))
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'try again'
}
