import { atom } from 'nanostores'

/**
 * Send text from somewhere other than the composer (a reply's option buttons) through the
 * composer of one chat surface, so it takes exactly the path a typed message takes: the
 * contributed middleware chain, queueing while busy, attachments, the optimistic row.
 */
export interface ComposerSendRequest {
  id: number
  target: string
  text: string
}

export const $composerSendRequest = atom<ComposerSendRequest | null>(null)

let sequence = 0

/** `target` is the composer scope's target ('main' or a tile's) — see `useComposerScope`. */
export function requestComposerSend(target: string, text: string): void {
  sequence += 1
  $composerSendRequest.set({ id: sequence, target, text })
}

/** Claim a request for `target`, once. */
export function takeComposerSendRequest(target: string): ComposerSendRequest | null {
  const request = $composerSendRequest.get()

  if (!request || request.target !== target) {
    return null
  }

  $composerSendRequest.set(null)

  return request
}
