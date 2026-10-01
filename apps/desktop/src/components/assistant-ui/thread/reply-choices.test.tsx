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
  it('turns the options a finished reply offers into buttons that answer through the composer', async () => {
    render(<Harness messages={[message('u1', 'user', 'add kurkure'), message('a1', 'assistant', OFFER)]} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Single Pack (78.9g) – ₹20' }))

    expect($composerSendRequest.get()).toMatchObject({ target: 'main', text: 'Single Pack (78.9g) – ₹20' })
  })

  it('lets the user answer in their own words from the last button', async () => {
    render(<Harness messages={[message('u1', 'user', 'add kurkure'), message('a1', 'assistant', OFFER)]} />)

    fireEvent.click(await screen.findByRole('button', { name: /Something else/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Type your own answer…' }), {
      target: { value: 'the masala munch one instead' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect($composerSendRequest.get()).toMatchObject({ target: 'main', text: 'the masala munch one instead' })
  })

  it('retires the buttons once the user has answered', async () => {
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

    expect(screen.queryByRole('group', { name: 'Reply options' })).toBeNull()
  })
})
