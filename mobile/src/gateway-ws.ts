import type { WebView } from 'react-native-webview'

import type { Pairing } from './pairing'

/** Tailscale Serve's HTTPS proxy speaks HTTP/2 to the phone and does not bridge
 *  RFC 8441 WebSocket CONNECT, so WKWebView `new WebSocket(wss://*.ts.net)` fails
 *  before open. React Native's socket uses HTTP/1.1 and gets through. */
export const GATEWAY_WS_SHIM = `
    (function () {
      if (!window.scoutNative || window.__scoutNativeWs) return;
      var sockets = {};
      window.__scoutNativeWs = function (id, type, data) {
        var socket = sockets[id];
        if (!socket) return;
        if (type === 'open') {
          socket.readyState = 1;
          socket._emit('open', {});
        } else if (type === 'message') {
          socket._emit('message', { data: data });
        } else if (type === 'error') {
          socket._emit('error', {});
        } else if (type === 'close') {
          socket.readyState = 3;
          delete sockets[id];
          socket._emit('close', data || { code: 1006, reason: '' });
        }
      };
      function Socket(url, _protocols) {
        var self = this;
        var id = Socket._next++;
        sockets[id] = self;
        self.url = String(url);
        self.readyState = 0;
        self.bufferedAmount = 0;
        self.protocol = '';
        self.extensions = '';
        self.binaryType = 'blob';
        self.onopen = null;
        self.onmessage = null;
        self.onerror = null;
        self.onclose = null;
        self._listeners = {};
        self._emit = function (type, event) {
          var payload = event || {};
          var handler = self['on' + type];
          if (typeof handler === 'function') handler.call(self, payload);
          var list = self._listeners[type] || [];
          for (var i = 0; i < list.length; i++) list[i].call(self, payload);
        };
        self.addEventListener = function (type, fn, opts) {
          if (typeof fn !== 'function') return;
          var wrap = fn;
          if (opts && opts.once) {
            wrap = function (event) {
              self.removeEventListener(type, wrap);
              fn.call(self, event);
            };
            wrap._orig = fn;
          }
          (self._listeners[type] = self._listeners[type] || []).push(wrap);
        };
        self.removeEventListener = function (type, fn) {
          self._listeners[type] = (self._listeners[type] || []).filter(function (item) {
            return item !== fn && item._orig !== fn;
          });
        };
        self.send = function (data) {
          window.scoutNative.request('ws-send', { id: id, data: String(data) });
        };
        self.close = function (code, reason) {
          if (self.readyState === 2 || self.readyState === 3) return;
          self.readyState = 2;
          window.scoutNative.request('ws-close', { id: id, code: code, reason: reason });
        };
        window.scoutNative.request('ws-open', { id: id, url: self.url }).catch(function () {
          self.readyState = 3;
          self._emit('error', {});
          self._emit('close', { code: 1006, reason: '' });
        });
      }
      Socket._next = 1;
      Socket.CONNECTING = 0;
      Socket.OPEN = 1;
      Socket.CLOSING = 2;
      Socket.CLOSED = 3;
      Socket.prototype.CONNECTING = 0;
      Socket.prototype.OPEN = 1;
      Socket.prototype.CLOSING = 2;
      Socket.prototype.CLOSED = 3;
      window.WebSocket = Socket;
    })();
`

type NativePayload = { code?: number; data?: string; id?: number; reason?: string; url?: string }

export function isPairingWebSocketUrl(url: string, pairing: Pairing): boolean {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return false
  }

  if (parsed.pathname !== '/api/ws') {
    return false
  }

  const allowed = pairing.baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '')

  return `${parsed.protocol}//${parsed.host}` === allowed
}

export function emitGatewayWs(webview: null | WebView, id: number, type: string, data: unknown = null) {
  webview?.injectJavaScript(
    `window.__scoutNativeWs(${id}, ${JSON.stringify(type)}, ${JSON.stringify(data)}); true;`
  )
}

export function openNativeGatewaySocket(
  sockets: Map<number, WebSocket>,
  webview: () => null | WebView,
  pairing: Pairing,
  payload: NativePayload
) {
  const id = Number(payload.id)
  const url = String(payload.url || '')

  if (!Number.isInteger(id) || id < 1 || sockets.has(id) || !isPairingWebSocketUrl(url, pairing)) {
    throw new Error('Invalid gateway WebSocket')
  }

  const socket = new WebSocket(url)
  sockets.set(id, socket)
  socket.onopen = () => emitGatewayWs(webview(), id, 'open')
  socket.onmessage = event => emitGatewayWs(webview(), id, 'message', typeof event.data === 'string' ? event.data : '')
  socket.onerror = () => emitGatewayWs(webview(), id, 'error')
  socket.onclose = event => {
    sockets.delete(id)
    emitGatewayWs(webview(), id, 'close', { code: event.code, reason: event.reason })
  }
}

export function sendNativeGatewaySocket(sockets: Map<number, WebSocket>, payload: NativePayload) {
  sockets.get(Number(payload.id))?.send(String(payload.data ?? ''))
}

export function closeNativeGatewaySocket(sockets: Map<number, WebSocket>, payload: NativePayload) {
  const socket = sockets.get(Number(payload.id))

  if (!socket) {
    return
  }

  socket.close(Number(payload.code) || 1000, String(payload.reason ?? ''))
}

export function closeAllNativeGatewaySockets(sockets: Map<number, WebSocket>) {
  for (const socket of sockets.values()) {
    try {
      socket.close()
    } catch {
      // already gone
    }
  }

  sockets.clear()
}
