import { useStore } from '@nanostores/react'
import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

import {
  type BrowserScreenLease,
  getBrowserScreen,
  observeBrowserScreen,
  setBrowserScreenControl,
  viewerHash
} from '@/api/browser-screen'
import { useI18n } from '@/i18n'
import { ArrowsMaximize, ArrowsMinimize, Eye, Keyboard, Pointer } from '@/lib/icons'
import { resolveSiblingWsUrl } from '@/lib/sibling-ws-url'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'

import { type AgentCursor, BrowserFrame, type BrowserTab } from './browser-frame'

const POLL_MS = 3000
const MOVE_THROTTLE_MS = 40
const BUTTONS: Record<number, string> = { 0: 'left', 1: 'middle', 2: 'right' }
// A finger that moves further than this is scrolling the page, not tapping it.
const TAP_SLOP_PX = 8
// Keys a phone's on-screen keyboard reports as keydown but never as text.
const EDIT_KEYS = new Set(['Backspace', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

interface Frame {
  data: string
  height: number
  width: number
}

const modifiers = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)

function Asleep({ title, detail }: { detail: string; title: string }) {
  return (
    <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 rounded-2xl bg-(--ui-bg-elevated) ring-1 ring-(--ui-stroke-tertiary)">
      <span aria-hidden className="text-2xl opacity-60">
        💤
      </span>
      <p className="m-0 text-sm font-medium text-(--ui-text-primary)">{title}</p>
      <p className="m-0 px-6 text-center text-xs text-(--ui-text-tertiary)">{detail}</p>
    </div>
  )
}

/** The Browser Agent's live screen: watch it work, take control (log in, solve a check), hand it back.
 *  Input reaches the browser only while this window holds the lease; the backend enforces that. */
export function ComputerTab() {
  const { t } = useI18n()
  const copy = t.agentPanel.computer
  const profile = useStore($activeGatewayProfile)
  const [running, setRunning] = useState(false)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [lease, setLease] = useState<BrowserScreenLease | null>(null)
  const [viewer, setViewer] = useState<{ hash: string; id: string } | null>(null)
  const [socket, setSocket] = useState<WebSocket | null>(null)
  const lastMove = useRef(0)
  const [full, setFull] = useState(false)
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [cursor, setCursor] = useState<AgentCursor | null>(null)
  // A finger on the screen: a tap clicks, a drag scrolls the page under it.
  const touch = useRef<{ moved: boolean; x: number; y: number } | null>(null)
  const keyboardInput = useRef<HTMLInputElement>(null)
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  const inControl = Boolean(viewer && lease?.holder === 'human' && lease.viewer_hash === viewer.hash)

  useEffect(() => {
    let alive = true

    const poll = () =>
      void getBrowserScreen(profile)
        .then(status => {
          if (alive) {
            setRunning(status.running)
            setLease(status.lease)
          }
        })
        .catch(() => alive && setRunning(false))

    poll()
    const timer = window.setInterval(poll, POLL_MS)

    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [profile])

  useEffect(() => {
    if (!running) {
      setFrame(null)

      return
    }

    let closed = false
    let ws: WebSocket | null = null

    void (async () => {
      try {
        const observed = await observeBrowserScreen(profile)
        const url = await resolveSiblingWsUrl({ profile }, observed.path, { stripGatewayCredential: true })

        if (closed) {
          return
        }

        setViewer({ hash: await viewerHash(observed.viewer_id), id: observed.viewer_id })
        setLease(observed.lease)
        ws = new WebSocket(`${url}${url.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(observed.ticket)}`)
        setSocket(ws)

        ws.onmessage = event => {
          const msg = JSON.parse(String(event.data)) as Partial<Frame> & {
            kind?: AgentCursor['kind']
            tabs?: BrowserTab[]
            type?: string
            x?: number
            y?: number
          }

          if (msg.type === 'frame' && msg.data) {
            setFrame({ data: msg.data, height: msg.height || 800, width: msg.width || 1280 })
          } else if (msg.type === 'tabs' && msg.tabs) {
            setTabs(msg.tabs)
          } else if (msg.type === 'cursor') {
            setCursor(prev => ({ kind: msg.kind ?? 'move', seq: (prev?.seq ?? 0) + 1, x: msg.x ?? 0, y: msg.y ?? 0 }))
          }
        }

        ws.onclose = () => {
          setSocket(null)

          if (!closed) {
            setRunning(false) // the next poll reconnects if the browser is still up
          }
        }
      } catch {
        setRunning(false)
      }
    })()

    return () => {
      closed = true
      ws?.close()
      setSocket(null)
    }
  }, [profile, running])

  const send = (msg: Record<string, unknown>) => {
    if (inControl && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg))
    }
  }

  const point = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const width = frame?.width || 1280
    const height = frame?.height || 800

    return {
      x: Math.round(((e.clientX - rect.left) * width) / rect.width),
      y: Math.round(((e.clientY - rect.top) * height) / rect.height)
    }
  }

  const mouse = (type: string) => (e: MouseEvent<HTMLImageElement>) => {
    if (!inControl) {
      return
    }

    if (type === 'mouseMoved') {
      const now = performance.now()

      if (now - lastMove.current < MOVE_THROTTLE_MS) {
        return
      }

      lastMove.current = now
    }

    e.preventDefault()
    send({
      type,
      ...point(e),
      button: type === 'mouseMoved' ? 'none' : BUTTONS[e.button] || 'left',
      clickCount: type === 'mouseMoved' ? 0 : e.detail || 1,
      modifiers: modifiers(e)
    })
  }

  const pointerDown = (e: PointerEvent<HTMLImageElement>) => {
    if (e.pointerType === 'mouse') {
      return mouse('mousePressed')(e)
    }

    if (inControl) {
      e.currentTarget.setPointerCapture(e.pointerId)
      touch.current = { moved: false, x: e.clientX, y: e.clientY }
    }
  }

  const pointerMove = (e: PointerEvent<HTMLImageElement>) => {
    if (e.pointerType === 'mouse') {
      return mouse('mouseMoved')(e)
    }

    const start = touch.current

    if (!inControl || !start) {
      return
    }

    const dx = e.clientX - start.x
    const dy = e.clientY - start.y

    if (!start.moved && Math.hypot(dx, dy) < TAP_SLOP_PX) {
      return
    }

    const now = performance.now()

    if (now - lastMove.current < MOVE_THROTTLE_MS) {
      return
    }

    lastMove.current = now
    // The page follows the finger: dragging up scrolls down, scaled to the browser's pixels.
    const scale = (frame?.width || 1280) / e.currentTarget.getBoundingClientRect().width
    send({ type: 'wheel', ...point(e), deltaX: -dx * scale, deltaY: -dy * scale })
    touch.current = { moved: true, x: e.clientX, y: e.clientY }
  }

  const pointerUp = (e: PointerEvent<HTMLImageElement>) => {
    if (e.pointerType === 'mouse') {
      return mouse('mouseReleased')(e)
    }

    const start = touch.current
    touch.current = null

    if (inControl && start && !start.moved) {
      const at = { ...point(e), button: 'left', clickCount: 1, modifiers: 0 }
      send({ type: 'mousePressed', ...at })
      send({ type: 'mouseReleased', ...at })
    }
  }

  // The on-screen keyboard: its text goes in as typed text, its edit keys as key presses.
  const typed = (e: FormEvent<HTMLInputElement>) => {
    const text = e.currentTarget.value

    if (text) {
      send({ type: 'insertText', text })
    }

    e.currentTarget.value = ''
  }

  const editKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()

    if (EDIT_KEYS.has(e.key)) {
      e.preventDefault()
      const press = { key: e.key, code: e.code, keyCode: e.keyCode, text: e.key === 'Enter' ? '\r' : '', modifiers: 0 }
      send({ type: 'keyDown', ...press })
      send({ type: 'keyUp', ...press })
    }
  }

  const key = (type: 'keyDown' | 'keyUp') => (e: KeyboardEvent<HTMLDivElement>) => {
    if (!inControl) {
      return
    }

    e.preventDefault()
    send({
      type,
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      text: e.key.length === 1 ? e.key : e.key === 'Enter' ? '\r' : '',
      modifiers: modifiers(e)
    })
  }

  const toggleControl = async () => {
    if (!viewer) {
      return
    }

    try {
      const result = await setBrowserScreenControl(profile, viewer.id, !inControl)
      setLease(result.lease)
    } catch (error) {
      notifyError(error, copy.takeOverFailed)
    }
  }

  const closeFull = () => {
    // Leaving the big screen hands control back: the person is no longer looking at what they drive.
    if (inControl) {
      void toggleControl()
    }

    setFull(false)
  }

  if (!running) {
    return (
      <figure className="m-0 flex flex-col items-center gap-3 px-4 pt-4 pb-6">
        <Asleep detail={copy.asleepDetail} title={copy.asleep} />
        <figcaption className="text-xs text-(--ui-text-tertiary)">{copy.caption}</figcaption>
      </figure>
    )
  }

  // One live stream, shown as a thumbnail in the panel and full size in the viewer.
  const stream = (size: 'full' | 'panel') =>
    frame ? (
      <img
        alt={copy.caption}
        className={cn(
          'block select-none',
          'h-auto w-full',
          size === 'full' && !inControl && 'cursor-default',
          size === 'full' && inControl && 'touch-none'
        )}
        draggable={false}
        onContextMenu={e => inControl && e.preventDefault()}
        onPointerCancel={() => (touch.current = null)}
        onPointerDown={size === 'full' ? pointerDown : undefined}
        onPointerMove={size === 'full' ? pointerMove : undefined}
        onPointerUp={size === 'full' ? pointerUp : undefined}
        onWheel={e =>
          size === 'full' && inControl && send({ type: 'wheel', ...point(e), deltaX: e.deltaX, deltaY: e.deltaY })
        }
        src={`data:image/jpeg;base64,${frame.data}`}
      />
    ) : (
      <div
        className={cn('flex aspect-[16/10] items-center justify-center text-xs text-white/50', 'w-full bg-[#202124]')}
      >
        {copy.connecting}
      </div>
    )

  return (
    <figure className="m-0 flex flex-col items-center gap-3 px-4 pt-4 pb-6">
      <button
        aria-label={copy.open}
        className="group relative w-full overflow-hidden rounded-2xl bg-black shadow-sm ring-1 ring-(--ui-stroke-tertiary) transition-shadow hover:shadow-md"
        onClick={() => setFull(true)}
        type="button"
      >
        <BrowserFrame compact cursor={cursor} interactive={false} onCommand={send} tabs={tabs}>
          {stream('panel')}
        </BrowserFrame>
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/20">
          <span className="flex items-center gap-1.5 rounded-full bg-black/85 px-3.5 py-1.5 text-sm font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <ArrowsMaximize size={16} />
            {copy.open}
          </span>
        </span>
      </button>
      <figcaption className="text-xs text-(--ui-text-tertiary)">{copy.caption}</figcaption>
      {full
        ? createPortal(
            <div
              aria-label={copy.caption}
              aria-modal="true"
              className="fixed inset-x-0 top-0 z-[1300] flex h-(--phone-viewport-height,100dvh) flex-col bg-[#141414] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none"
              onKeyDown={e => {
                if (e.key === 'Escape' && !inControl) {
                  closeFull()

                  return
                }

                key('keyDown')(e)
              }}
              onKeyUp={key('keyUp')}
              ref={el => el?.focus()}
              role="dialog"
              tabIndex={0}
            >
              {/* Clear of the window's own controls (traffic lights) at the top. */}
              <div className="flex h-12 shrink-0 items-center justify-end px-4">
                <button
                  aria-label={copy.close}
                  className="grid size-8 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  onClick={closeFull}
                  type="button"
                >
                  <ArrowsMinimize size={18} />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center px-3 sm:px-10">
                <div className="w-full max-w-[min(100%,calc((100vh-12rem)*1.6))] overflow-hidden rounded-xl shadow-2xl">
                  <BrowserFrame cursor={cursor} interactive={inControl} onCommand={send} tabs={tabs}>
                    {stream('full')}
                  </BrowserFrame>
                </div>
              </div>
              <div className="flex shrink-0 justify-center py-5">
                <div className="relative flex items-center gap-1 rounded-full bg-white p-1 pl-4 text-sm text-[#3a3a3a] shadow-xl">
                  <span className="flex items-center gap-2 pr-2">
                    {inControl ? <Pointer size={16} /> : <Eye size={16} />}
                    {inControl ? copy.youreInControl : copy.watching}
                  </span>
                  <button
                    className="rounded-full px-3.5 py-1.5 font-medium transition-opacity hover:opacity-85 disabled:opacity-50"
                    disabled={!viewer}
                    onClick={() => void toggleControl()}
                    // Fixed light/dark pair: the pill sits on the dark viewer whatever the app theme is.
                    style={
                      inControl ? { background: '#ececec', color: '#1f1f1f' } : { background: '#161616', color: '#fff' }
                    }
                    type="button"
                  >
                    {inControl ? copy.stop : copy.takeOver}
                  </button>
                  {inControl && coarse ? (
                    <button
                      aria-label={copy.keyboard}
                      className="grid size-8 place-items-center rounded-full transition-colors hover:bg-black/5"
                      onClick={() => keyboardInput.current?.focus()}
                      type="button"
                    >
                      <Keyboard size={17} />
                    </button>
                  ) : null}
                  {/* Off-screen field that raises the phone's keyboard; what is typed goes to the page. */}
                  <input
                    aria-hidden
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    className="pointer-events-none absolute bottom-0 left-1/2 size-px text-base opacity-0"
                    onInput={typed}
                    onKeyDown={editKey}
                    onKeyUp={e => e.stopPropagation()}
                    ref={keyboardInput}
                    tabIndex={-1}
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </figure>
  )
}
