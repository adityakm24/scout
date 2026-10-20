import { useStore } from '@nanostores/react'
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState, type WheelEvent } from 'react'

import {
  type BrowserScreenLease,
  getBrowserScreen,
  observeBrowserScreen,
  setBrowserScreenControl,
  viewerHash
} from '@/api/browser-screen'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { resolveSiblingWsUrl } from '@/lib/sibling-ws-url'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'

const POLL_MS = 3000
const MOVE_THROTTLE_MS = 40
const BUTTONS: Record<number, string> = { 0: 'left', 1: 'middle', 2: 'right' }

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
          const msg = JSON.parse(String(event.data)) as Partial<Frame> & { type?: string }

          if (msg.type === 'frame' && msg.data) {
            setFrame({ data: msg.data, height: msg.height || 800, width: msg.width || 1280 })
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

  const point = (e: MouseEvent<HTMLImageElement> | WheelEvent<HTMLImageElement>) => {
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

  if (!running) {
    return (
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Asleep detail={copy.asleepDetail} title={copy.asleep} />
        <p className="m-0 text-center text-xs text-(--ui-text-tertiary)">{copy.caption}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <div
        className={cn(
          'overflow-hidden rounded-2xl bg-black ring-1 outline-none',
          inControl ? 'ring-2 ring-(--ui-accent)' : 'ring-(--ui-stroke-tertiary)'
        )}
        onKeyDown={key('keyDown')}
        onKeyUp={key('keyUp')}
        tabIndex={inControl ? 0 : -1}
      >
        {frame ? (
          <img
            alt={copy.caption}
            className={cn('block aspect-[16/10] w-full select-none', inControl ? 'cursor-default' : 'cursor-not-allowed')}
            draggable={false}
            onContextMenu={e => inControl && e.preventDefault()}
            onMouseDown={mouse('mousePressed')}
            onMouseMove={mouse('mouseMoved')}
            onMouseUp={mouse('mouseReleased')}
            onWheel={e => inControl && send({ type: 'wheel', ...point(e), deltaX: e.deltaX, deltaY: e.deltaY })}
            src={`data:image/jpeg;base64,${frame.data}`}
          />
        ) : (
          <div className="flex aspect-[16/10] items-center justify-center text-xs text-white/60">{copy.connecting}</div>
        )}
      </div>
      {inControl ? <p className="m-0 text-xs text-(--ui-text-secondary)">{copy.youHaveControl}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-xs text-(--ui-text-tertiary)">{copy.caption}</p>
        <Button disabled={!viewer} onClick={() => void toggleControl()} size="sm" variant={inControl ? 'default' : 'ghost'}>
          {inControl ? copy.handBack : copy.takeOver}
        </Button>
      </div>
    </div>
  )
}
