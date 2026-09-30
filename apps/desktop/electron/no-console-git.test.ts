import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  CREATE_NO_WINDOW,
  NO_CONSOLE_GIT_SCRIPT,
  planNoConsoleGitSpawn,
  resolveNoConsolePython,
  simpleGitBinary
} from './no-console-git'

const gitArgs = ['-c', 'windows.appendAtomically=false', 'merge-base', '--is-ancestor', 'origin/main', 'HEAD']
const gitBin = 'C:\\Program Files\\Git\\cmd\\git.exe'

test('windows git spawn uses a CREATE_NO_WINDOW host and does not rewrite git argv', () => {
  const plan = planNoConsoleGitSpawn({
    gitBin,
    args: gitArgs,
    isWindows: true,
    pythonBin: 'C:\\scout\\venv\\Scripts\\python.exe',
    scriptPath: 'C:\\scout\\no-console-git.py',
    env: { GIT_TERMINAL_PROMPT: '0', PATH: 'C:\\Windows' }
  })

  assert.equal(plan.command, 'C:\\scout\\venv\\Scripts\\python.exe')
  assert.deepEqual(plan.args, ['C:\\scout\\no-console-git.py', ...gitArgs])
  assert.equal(plan.env.SCOUT_GIT_ARGV0, JSON.stringify(gitBin))
  assert.equal(plan.env.GIT_TERMINAL_PROMPT, '0')
  assert.equal(plan.windowsHide, true)
  assert.deepEqual(plan.stdio, ['ignore', 'pipe', 'pipe'])
  assert.equal(plan.creationFlags, CREATE_NO_WINDOW)
  assert.equal(CREATE_NO_WINDOW, 0x08000000)
})

test('non-windows git spawn keeps the git binary and argv', () => {
  const plan = planNoConsoleGitSpawn({
    gitBin: '/usr/bin/git',
    args: ['status', '--porcelain'],
    isWindows: false,
    pythonBin: '/usr/bin/python3',
    scriptPath: '/tmp/host.py'
  })

  assert.equal(plan.command, '/usr/bin/git')
  assert.deepEqual(plan.args, ['status', '--porcelain'])
  assert.equal(plan.creationFlags, 0)
})

test('missing python does not rewrite git argv', () => {
  const plan = planNoConsoleGitSpawn({
    gitBin: 'git.exe',
    args: gitArgs,
    isWindows: true,
    pythonBin: null,
    scriptPath: 'C:\\scout\\no-console-git.py'
  })

  assert.equal(plan.command, 'git.exe')
  assert.deepEqual(plan.args, gitArgs)
})

test('simple-git binary is the python host tuple on windows', () => {
  assert.deepEqual(
    simpleGitBinary('git.exe', {
      isWindows: true,
      pythonBin: 'C:\\scout\\venv\\Scripts\\python.exe',
      scriptPath: 'C:\\scout\\no-console-git.py'
    }),
    ['C:\\scout\\venv\\Scripts\\python.exe', 'C:\\scout\\no-console-git.py']
  )
})

test('python resolver skips pythonw and the WindowsApps stub', () => {
  const python = resolveNoConsolePython({
    isWindows: true,
    env: {
      SCOUT_DESKTOP_PYTHON: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe',
      SCOUT_DESKTOP_SCOUT_ROOT: 'D:\\scout'
    },
    roots: ['E:\\src'],
    fileExists: () => true
  })

  assert.equal(python, path.win32.join('D:\\scout', '.venv', 'Scripts', 'python.exe'))
  assert.equal(
    resolveNoConsolePython({
      isWindows: true,
      env: { SCOUT_DESKTOP_PYTHON: 'C:\\scout\\venv\\Scripts\\pythonw.exe' },
      roots: [],
      fileExists: () => true
    }),
    null
  )
  assert.equal(
    resolveNoConsolePython({
      isWindows: true,
      env: { SCOUT_DESKTOP_PYTHON: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe' },
      roots: [],
      fileExists: () => true
    }),
    null
  )
})

test('host script forwards git argv unchanged and sets CREATE_NO_WINDOW', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-no-console-git-'))

  try {
    const script = path.join(dir, 'host.py')

    fs.writeFileSync(script, NO_CONSOLE_GIT_SCRIPT)

    const out = execFileSync('python3', [script, ...gitArgs], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SCOUT_GIT_ARGV0: JSON.stringify(gitBin),
        SCOUT_GIT_DRY_RUN: '1',
        SCOUT_GIT_NO_CONSOLE: '1'
      }
    })

    const parsed = JSON.parse(out)

    assert.deepEqual(parsed.argv, [gitBin, ...gitArgs])
    assert.equal(parsed.creationflags, CREATE_NO_WINDOW)
  } finally {
    fs.rmSync(dir, { force: true, recursive: true })
  }
})
