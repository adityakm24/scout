import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { $composerSendRequest } from '@/store/composer-send'

import { stubThreadEnvironment } from '../test-utils'

import { Thread } from '.'

stubThreadEnvironment()

afterEach(() => {
  cleanup()
  $composerSendRequest.set(null)
})

const createdAt = new Date('2026-05-01T00:00:00.000Z')

const message = (id: string, role: 'assistant' | 'user', text: string) =>
  ({
    id,
    role,
    content: [{ type: 'text', text }],
    attachments: [],
    createdAt,
    status: role === 'assistant' ? { type: 'complete', reason: 'stop' } : undefined,
    metadata: { custom: {} }
  }) as unknown as ThreadMessage

const OFFER = [
  'Here are the available options:',
  '',
  '1. **Single Pack (78.9g)** – ₹20',
  '2. **Pack of 2 (78.9g x 2)** – ₹40',
  '',
  'Which variant would you like to add to your cart?'
].join('\n')

function Harness({ messages }: { messages: ThreadMessage[] }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({ messages, isRunning: false, onNew: async () => {} })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  )
}

describe('reply choices', () => {
  it("answers with one tap, standing in for the reply's own list", async () => {
    render(<Harness messages={[message('u1', 'user', 'add kurkure'), message('a1', 'assistant', OFFER)]} />)

    fireEvent.click(await screen.findByRole('button', { name: /Single Pack \(78\.9g\) – ₹20/ }))

    expect($composerSendRequest.get()).toMatchObject({ target: 'main', text: 'Single Pack (78.9g) – ₹20' })
    // The reply's own list is hidden while the card shows it, so nothing reads twice.
    expect(document.querySelector('.aui-md ol')?.hasAttribute('hidden')).toBe(true)
  })

  it("takes an answer in the user's own words from the last row", async () => {
    render(<Harness messages={[message('u1', 'user', 'add kurkure'), message('a1', 'assistant', OFFER)]} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add your own answer' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Type your answer…' }), {
      target: { value: 'the masala munch one instead' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect($composerSendRequest.get()).toMatchObject({ target: 'main', text: 'the masala munch one instead' })
  })

  it('retires the card once the user has answered', async () => {
    render(
      <Harness
        messages={[
          message('u1', 'user', 'add kurkure'),
          message('a1', 'assistant', OFFER),
          message('u2', 'user', 'single one')
        ]}
      />
    )

    await screen.findByText('single one')

    expect(screen.queryByRole('group', { name: 'Choose one' })).toBeNull()
  })
})
