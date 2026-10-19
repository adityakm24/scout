import assert from 'node:assert/strict'

import { test } from 'vitest'

import { hasWindowsPathPrefix, isExternalVenvHolder, isScoutOwnedVenvDaemon } from './venv-holder-select'

const SCRIPTS = 'C:\\Scout\\venv\\Scripts'

test('matches the hindsight daemon shim (exe under venv Scripts + hindsight cmdline)', () => {
  assert.equal(
    isScoutOwnedVenvDaemon(
      'C:\\Scout\\venv\\Scripts\\pythonw.exe',
      'C:\\Scout\\venv\\Scripts\\pythonw.exe -m hindsight_api.main --daemon --idle-timeout 300 --port 9177',
      SCRIPTS
    ),
    true
  )
})

test('Windows path prefix match is ordinal case-insensitive', () => {
  assert.equal(
    isScoutOwnedVenvDaemon(
      'c:\\scout\\venv\\scripts\\python.exe',
      'python.exe -m hindsight_api.main --daemon',
      'C:\\Scout\\venv\\Scripts'
    ),
    true
  )
})

test('excludes external venv holders that are not the hindsight daemon', () => {
  // a user terminal running the scout CLI from the venv — must NOT be killed
  assert.equal(isScoutOwnedVenvDaemon('C:\\Scout\\venv\\Scripts\\scout.exe', 'scout chat -q "hi"', SCRIPTS), false)
  // an unrelated python script using the venv interpreter
  assert.equal(
    isScoutOwnedVenvDaemon('C:\\Scout\\venv\\Scripts\\python.exe', 'python C:\\tools\\import.py', SCRIPTS),
    false
  )
})

test('excludes exes outside the venv even when the cmdline mentions hindsight', () => {
  assert.equal(
    isScoutOwnedVenvDaemon('C:\\Other\\pythonw.exe', 'pythonw -m hindsight_api.main --daemon', SCRIPTS),
    false
  )
})

test('prefix boundary: sibling dirs (ScriptsX) do not match', () => {
  assert.equal(hasWindowsPathPrefix('C:\\Scout\\venv\\ScriptsX\\python.exe', SCRIPTS), false)
  assert.equal(hasWindowsPathPrefix('C:\\Scout\\venv\\Scripts\\python.exe', SCRIPTS), true)
})

test('null/undefined fields never match', () => {
  assert.equal(isScoutOwnedVenvDaemon(null, 'x', SCRIPTS), false)
  assert.equal(isScoutOwnedVenvDaemon('C:\\Scout\\venv\\Scripts\\pythonw.exe', null, SCRIPTS), false)
  assert.equal(isScoutOwnedVenvDaemon(undefined, undefined, SCRIPTS), false)
})

// --- isExternalVenvHolder (#62311) ------------------------------------------

test('matches the autostart gateway shim (scout.exe under venv Scripts)', () => {
  assert.equal(
    isExternalVenvHolder(
      'C:\\Scout\\venv\\Scripts\\scout.exe',
      '"C:\\Scout\\venv\\Scripts\\scout.exe" gateway run --external-supervisor',
      SCRIPTS
    ),
    true
  )
})

test('matches the dashboard scheduled task (python -m scout_backend / -m scout)', () => {
  assert.equal(
    isExternalVenvHolder(
      'C:\\Scout\\venv\\Scripts\\python.exe',
      '"C:\\Scout\\venv\\Scripts\\python.exe" -m scout_backend.main dashboard',
      SCRIPTS
    ),
    true
  )
  assert.equal(
    isExternalVenvHolder('C:\\Scout\\venv\\Scripts\\pythonw.exe', 'pythonw.exe -m scout serve', SCRIPTS),
    true
  )
})

test('never matches an unrelated process that merely borrows the venv interpreter', () => {
  // a user's own script running on the venv python — NOT Scout, must NOT be killed
  assert.equal(
    isExternalVenvHolder('C:\\Scout\\venv\\Scripts\\python.exe', 'python C:\\tools\\import.py', SCRIPTS),
    false
  )
  // hindsight daemon is selected by isScoutOwnedVenvDaemon, not here
  assert.equal(
    isExternalVenvHolder('C:\\Scout\\venv\\Scripts\\pythonw.exe', 'pythonw -m hindsight_api.main --daemon', SCRIPTS),
    false
  )
})

test('never matches a process outside the venv, even with scout in the cmdline', () => {
  // an editor / shell whose command line mentions the install root (#62445 regression guard)
  assert.equal(
    isExternalVenvHolder('C:\\Windows\\System32\\cmd.exe', 'cmd /c cd C:\\Scout\\venv\\Scripts && dir', SCRIPTS),
    false
  )
  assert.equal(isExternalVenvHolder('C:\\Other\\scout.exe', 'scout gateway run', SCRIPTS), false)
})

test('sibling-dir and boundary safety for the external selector', () => {
  assert.equal(isExternalVenvHolder('C:\\Scout\\venv\\ScriptsX\\scout.exe', 'scout gateway run', SCRIPTS), false)
  assert.equal(isExternalVenvHolder(null, 'scout gateway run', SCRIPTS), false)
  assert.equal(isExternalVenvHolder('C:\\Scout\\venv\\Scripts\\scout.exe', null, SCRIPTS), false)
})
