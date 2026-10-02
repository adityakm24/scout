import { beforeEach, describe, expect, it } from 'vitest'

import { $desktopBoot, failDesktopBoot } from './boot'

const initial = $desktopBoot.get()

describe('failDesktopBoot', () => {
  beforeEach(() => $desktopBoot.set(initial))

  it("treats the app's own quit as no failure, and still reports real ones", () => {
    failDesktopBoot("Error invoking remote method 'scout:connection': Error: Scout Desktop is quitting.")
    expect($desktopBoot.get().error).toBeNull()

    failDesktopBoot('connect ECONNREFUSED 127.0.0.1:9119')
    expect($desktopBoot.get()).toMatchObject({ error: 'connect ECONNREFUSED 127.0.0.1:9119', visible: true })
  })
})
