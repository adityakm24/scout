import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { LanguageSwitcher } from '@/components/language-switcher'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Slider } from '@/components/ui/slider'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Palette } from '@/lib/icons'
import { saveScoutConfig } from '@/scout'
import { $backdrop, setBackdrop } from '@/store/backdrop'
import { $composerPopoutGesturesEnabled, setComposerPopoutGesturesEnabled } from '@/store/composer-popout'
import { $embedAllowed, $embedMode, clearEmbedAllowed, type EmbedMode, setEmbedMode } from '@/store/embed-consent'
import { $interfaceMode, $modeShadowed, INTERFACE_MODES, type InterfaceMode } from '@/store/interface-mode'
import { $introSplash, setIntroSplash } from '@/store/intro-splash'
import { $fileBrowserOpen, setFileBrowserOpen } from '@/store/layout'
import { $showModelPricing, setShowModelPricing } from '@/store/model-pricing'
import { notifyError } from '@/store/notifications'
import { $reactionsEnabled, setReactionsEnabled } from '@/store/reactions-enabled'
import { $reasoningCollapsedByDefault, setReasoningCollapsedByDefault } from '@/store/reasoning-disclosure'
import { $sessionListDensity, type SessionListDensity, setSessionListDensity } from '@/store/session-list-density'
import { $tabStripDefault, setTabStripDefault, type TabStripDefault } from '@/store/tabstrip-prefs'
import { $textDirection, setTextDirection, TEXT_DIRECTIONS, type TextDirection } from '@/store/text-direction'
import { $hideThreadTimeline, setHideThreadTimeline } from '@/store/thread-timeline'
import { $spentTipCount, $tipsEnabled, resetTips, setTipsEnabled } from '@/store/tips'
import {
  $titlebarAppActionsSide,
  setTitlebarAppActionsSide,
  type TitlebarAppActionsSide
} from '@/store/titlebar-app-actions'
import { $hideCodeDiffs, $toolViewMode, setHideCodeDiffs, setToolViewMode } from '@/store/tool-view'
import { $toursEnabled, setToursEnabled } from '@/store/tours'
import {
  $translucency,
  beginTranslucencyPeek,
  endTranslucencyPeek,
  GLASS_IS_WINDOWS,
  GLASS_SCOPES,
  GLASS_SUPPORTED,
  glassMaterialForPicker,
  glassMaterialsFor,
  pulseTranslucencyPeek,
  resetTranslucencyPeek,
  setTranslucency,
  setTranslucencyFade,
  setTranslucencyMaterial,
  setTranslucencyMode,
  setTranslucencyScope,
  TRANSLUCENCY_MAX,
  TRANSLUCENCY_MIN,
  TRANSLUCENCY_STEP,
  TRANSLUCENCY_SUPPORTED
} from '@/store/translucency'
import { $userBubbleTransparency, setUserBubbleTransparency } from '@/store/user-bubble-transparency'
import { $vibeHeartsEnabled, setVibeHeartsEnabled } from '@/store/vibe-hearts-enabled'
import { $zoomPercent, setZoomPercent } from '@/store/zoom'
import { useTheme } from '@/themes/context'

import { setScoutConfigCache, useScoutConfigRecord } from '../hooks/use-config-record'

import { AppearanceExtraSlot } from './appearance-contrib'
import type { AppearanceSubpageId } from './appearance-subpages'
import { ChatFontSetting } from './chat-font-setting'
import { MODE_OPTIONS } from './constants'
import { setNested } from './helpers'
import { MinimizeToTraySetting } from './minimize-to-tray-setting'
import { PetSettings } from './pet-settings'
import { ListRow, RowFootnoteAction, SectionHeading, SettingsContent, ToggleRow } from './primitives'
import { SETTING_IDS, settingElementId } from './settings-manifest'
import { TerminalFontSetting } from './terminal-font-setting'
import { useSettingDeepLink } from './use-setting-deep-link'

// display.resume_last_session lives in the backend config record (shared with
// config.yaml and the cold-start restore in use-desktop-integrations), not a
// renderer store. Saves write through the shared react-query cache so the
// restore gate sees the new value on the next launch.
function ResumeLastSessionSetting() {
  const { t } = useI18n()
  const a = t.settings.appearance
  const configQuery = useScoutConfigRecord()
  const config = configQuery.data
  const writeScope = configQuery.writeScope
  const checked = (config?.display as { resume_last_session?: unknown } | undefined)?.resume_last_session !== false

  const update = (on: boolean) => {
    if (!config) {
      return
    }

    const next = setNested(config, 'display.resume_last_session', on)
    setScoutConfigCache(next)
    // Sparse patch: PUT /api/config deep-merges, and echoing the cached
    // snapshot would overwrite keys other surfaces changed since it loaded.
    void saveScoutConfig(setNested({}, 'display.resume_last_session', on), writeScope)
      .then(result => {
        if (!result.ok) {
          throw new Error(t.settings.config.autosaveFailed)
        }
      })
      .catch(error => {
        setScoutConfigCache(config)
        notifyError(error, t.settings.config.autosaveFailed)
      })
  }

  return (
    <ToggleRow
      checked={checked}
      description={a.resumeLastSessionDesc}
      disabled={!config}
      id={settingElementId(ids.resumeLastSession)}
      label={a.resumeLastSessionTitle}
      onChange={update}
    />
  )
}

const UI_SCALE_PRESETS = ['90', '100', '110', '125', '150', '175'] as const
const ids = SETTING_IDS.appearance
type UiScalePreset = (typeof UI_SCALE_PRESETS)[number]

function matchUiScalePreset(percent: number): UiScalePreset | null {
  return UI_SCALE_PRESETS.find(preset => Number(preset) === percent) ?? null
}

// Keys a range input treats as a step, so the peek can flash the live window
// for keyboard adjustment the way a pointer drag holds it open.
const SLIDER_STEP_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp'
])

interface TranslucencySliderProps {
  label: string
  onChange: (value: number) => void
  value: number
}

/**
 * One 0–100 lever, used up to twice: Clear's window opacity, and under Glass
 * the tint plus an optional native fade.
 *
 * Peek while the hand is on it — the overlay (scrim + near-opaque card) ghosts
 * so the window behind IS the live preview. The pointer pair covers
 * mouse/touch drags; the keyboard path pulses per step instead, and blur ends
 * any residual hold.
 */
function TranslucencySlider({ label, onChange, value }: TranslucencySliderProps) {
  return (
    <>
      <Slider
        aria-label={label}
        max={TRANSLUCENCY_MAX}
        min={TRANSLUCENCY_MIN}
        onBlur={endTranslucencyPeek}
        onChange={event => {
          triggerHaptic('selection')
          onChange(Number(event.target.value))
        }}
        onKeyDown={event => {
          if (SLIDER_STEP_KEYS.has(event.key)) {
            pulseTranslucencyPeek()
          }
        }}
        onLostPointerCapture={endTranslucencyPeek}
        onPointerDown={beginTranslucencyPeek}
        onPointerUp={endTranslucencyPeek}
        step={TRANSLUCENCY_STEP}
        value={value}
      />
      <span className="w-9 text-right text-[length:var(--conversation-caption-font-size)] tabular-nums text-(--ui-text-tertiary)">
        {value}%
      </span>
    </>
  )
}

interface GlassRowProps {
  children: React.ReactNode
  label: string
}

/** A labelled control in the Glass sub-panel: tint, fade, frost, area. */
function GlassRow({ children, label }: GlassRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
        {label}
      </span>
      {children}
    </div>
  )
}

interface AppearanceSettingsProps {
  subpage?: string
}

export function AppearanceSettings({ subpage }: AppearanceSettingsProps = {}) {
  const { t, isSavingLocale } = useI18n()
  const { mode, resolvedMode, setMode } = useTheme()
  const toolViewMode = useStore($toolViewMode)
  const toolViewShadowed = useStore($modeShadowed('toolViewMode'))
  const hideCodeDiffs = useStore($hideCodeDiffs)
  const hideCodeDiffsShadowed = useStore($modeShadowed('hideCodeDiffs'))
  const hideThreadTimeline = useStore($hideThreadTimeline)
  const reasoningCollapsedByDefault = useStore($reasoningCollapsedByDefault)
  const reasoningCollapsedShadowed = useStore($modeShadowed('reasoningCollapsedByDefault'))
  const interfaceMode = useStore($interfaceMode)
  const sessionListDensity = useStore($sessionListDensity)
  const tabStripDefault = useStore($tabStripDefault)
  const titlebarAppActionsSide = useStore($titlebarAppActionsSide)
  const zoomPercent = useStore($zoomPercent)
  const embedMode = useStore($embedMode)
  const embedAllowed = useStore($embedAllowed)
  const composerPopoutGesturesEnabled = useStore($composerPopoutGesturesEnabled)
  const fileBrowserOpen = useStore($fileBrowserOpen)
  const fileBrowserShadowed = useStore($modeShadowed('fileBrowserOpen'))
  const translucency = useStore($translucency)
  const glassMode = translucency.mode === 'glass' && GLASS_SUPPORTED
  const userBubbleTransparency = useStore($userBubbleTransparency)
  const textDirection = useStore($textDirection)
  const reactionsEnabled = useStore($reactionsEnabled)
  const tipsEnabled = useStore($tipsEnabled)
  const toursEnabled = useStore($toursEnabled)
  const spentTips = useStore($spentTipCount)
  const vibeHeartsEnabled = useStore($vibeHeartsEnabled)
  const backdrop = useStore($backdrop)
  const introSplash = useStore($introSplash)
  const showModelPricing = useStore($showModelPricing)
  const a = t.settings.appearance

  // A pointer held on the intensity slider when this overlay closes (Escape
  // mid-drag) never delivers its pointerup here, which would strand the peek
  // counter above zero and ghost the NEXT settings overlay. Leaving a subpage
  // also unmounts its sliders, so drop every outstanding hold on that change.
  useEffect(() => resetTranslucencyPeek, [subpage])

  // Shared by the mode/frost/area pickers: apply the choice, then show it
  // through the overlay it just altered (a pulse, not a hold — see the peek
  // notes on the slider itself).
  const pickTranslucency =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      triggerHaptic('selection')
      set(value)

      if (translucency.intensity > 0) {
        pulseTranslucencyPeek()
      }
    }

  const show = (id: AppearanceSubpageId) => subpage === undefined || subpage === id

  useSettingDeepLink('config:appearance', page => page !== undefined && show(page as AppearanceSubpageId))

  const modeOptions = MODE_OPTIONS.map(({ id, icon }) => ({ icon, id, label: t.settings.modeOptions[id].label }))
  const modeValue = mode === 'light' || mode === 'dark' ? mode : resolvedMode

  const toolOptions = [
    { id: 'product', label: a.product },
    { id: 'technical', label: a.technical }
  ] as const

  const sessionDensityOptions = [
    { id: 'compact', label: a.sessionDensityCompact },
    { id: 'comfortable', label: a.sessionDensityComfortable },
    { id: 'detailed', label: a.sessionDensityDetailed }
  ] as const satisfies readonly { id: SessionListDensity; label: string }[]

  const interfaceModeOptions = INTERFACE_MODES.map(id => ({
    id,
    label: t.interfaceMode[id].label
  })) satisfies readonly {
    id: InterfaceMode
    label: string
  }[]

  // A row whose value Simple mode currently decides says so where the
  // preference text would otherwise promise a persistence it cannot deliver.
  const withModeNote = (description: string, shadowed: boolean) =>
    shadowed ? `${description} ${t.interfaceMode.sessionNote}` : description

  const tabStripOptions = [
    { id: 'auto', label: a.tabStripAuto },
    { id: 'always', label: a.tabStripAlways },
    { id: 'never', label: a.tabStripNever }
  ] as const satisfies readonly { id: TabStripDefault; label: string }[]

  const appActionsOptions = [
    { id: 'right', label: a.appActionsRight },
    { id: 'left', label: a.appActionsLeft }
  ] as const satisfies readonly { id: TitlebarAppActionsSide; label: string }[]

  const textDirectionOptions = TEXT_DIRECTIONS.map(id => ({
    id,
    label: a.textDirection[id]
  })) satisfies readonly { id: TextDirection; label: string }[]

  const embedOptions = [
    { id: 'ask', label: a.embedsAsk },
    { id: 'always', label: a.embedsAlways },
    { id: 'off', label: a.embedsOff }
  ] as const satisfies readonly { id: EmbedMode; label: string }[]

  const uiScaleOptions = UI_SCALE_PRESETS.map(preset => ({ id: preset, label: `${preset}%` }))

  const matchedScalePreset = matchUiScalePreset(zoomPercent)

  return (
    <SettingsContent>
      <div>
        {subpage === undefined && (
          <>
            <SectionHeading icon={Palette} title={a.title} />
            <p className="max-w-2xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
              {a.intro}
            </p>
          </>
        )}

        <div className={subpage === undefined ? 'mt-2' : undefined}>
          {show('general') && (
            <ListRow
              action={<LanguageSwitcher />}
              description={isSavingLocale ? t.language.saving : t.language.description}
              id={settingElementId(ids.language)}
              title={t.language.label}
            />
          )}

          {show('theme') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('crisp')
                    setMode(id)
                  }}
                  options={modeOptions}
                  value={modeValue}
                />
              }
              description={a.themeDesc}
              id={settingElementId(ids.theme)}
              title={a.colorMode}
            />
          )}

          {show('typography') && (
            <>
              <ListRow
                action={
                  <SegmentedControl
                    onChange={id => {
                      triggerHaptic('selection')
                      setZoomPercent(Number(id))
                    }}
                    options={uiScaleOptions}
                    value={matchedScalePreset ?? ('' as UiScalePreset)}
                  />
                }
                description={a.uiScaleDesc(zoomPercent)}
                id={settingElementId(ids.uiScale)}
                title={a.uiScaleTitle}
              />

              <div id={settingElementId(ids.chatFont)}>
                <ChatFontSetting />
              </div>

              <div id={settingElementId(ids.terminalFont)}>
                <TerminalFontSetting />
              </div>
            </>
          )}

          {show('window-layout') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setSessionListDensity(id)
                  }}
                  options={sessionDensityOptions}
                  value={sessionListDensity}
                />
              }
              description={a.sessionDensityDesc}
              id={settingElementId(ids.sessionDensity)}
              title={a.sessionDensityTitle}
            />
          )}

          {show('window-layout') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setTabStripDefault(id)
                  }}
                  options={tabStripOptions}
                  value={tabStripDefault}
                />
              }
              description={a.tabStripDesc}
              id={settingElementId(ids.tabStrip)}
              title={a.tabStripTitle}
            />
          )}

          {show('window-layout') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setTitlebarAppActionsSide(id)
                  }}
                  options={appActionsOptions}
                  value={titlebarAppActionsSide}
                />
              }
              description={a.appActionsDesc}
              id={settingElementId(ids.appActions)}
              title={a.appActionsTitle}
            />
          )}

          {show('window-layout') && (
            <div id={settingElementId(ids.minimizeToTray)}>
              <MinimizeToTraySetting />
            </div>
          )}

          {/* Linux has neither half of this setting (see TRANSLUCENCY_SUPPORTED),
              so the row is absent there rather than offering a dead lever. */}
          {show('window-layout') && TRANSLUCENCY_SUPPORTED && (
            <ListRow
              action={
                <div
                  className="flex items-center gap-3"
                  // Arms the peek for the overlay this row lives in — the
                  // ghosting rules in styles.css scope to it, so no other
                  // overlay pays for an opacity transition it never uses.
                  data-translucency-peek-scope=""
                >
                  {GLASS_SUPPORTED && (
                    <SegmentedControl
                      onChange={pickTranslucency(setTranslucencyMode)}
                      options={[
                        { id: 'clear' as const, label: a.translucencyModeClear },
                        { id: 'glass' as const, label: a.translucencyModeGlass }
                      ]}
                      value={translucency.mode}
                    />
                  )}
                  {/* Clear has one lever and it belongs beside the mode. Glass
                      has four controls, so they move into the labelled panel
                      below rather than crowding this line with an unlabelled
                      slider that means something different. */}
                  {!glassMode && (
                    <TranslucencySlider
                      label={a.translucencyTitle}
                      onChange={setTranslucency}
                      value={translucency.intensity}
                    />
                  )}
                </div>
              }
              below={
                glassMode ? (
                  <div className="mt-3 flex flex-col gap-2.5" data-translucency-peek-scope="">
                    <GlassRow label={a.translucencyTintTitle}>
                      <TranslucencySlider
                        label={a.translucencyTintTitle}
                        onChange={setTranslucency}
                        value={translucency.intensity}
                      />
                    </GlassRow>
                    <GlassRow label={a.translucencyFadeTitle}>
                      <TranslucencySlider
                        label={a.translucencyFadeTitle}
                        onChange={setTranslucencyFade}
                        value={translucency.fade}
                      />
                    </GlassRow>
                    <GlassRow label={a.translucencyFrostTitle}>
                      <SegmentedControl
                        onChange={pickTranslucency(setTranslucencyMaterial)}
                        // Windows renders four rungs as three backdrops, so it
                        // is offered three; a frost saved on a Mac highlights
                        // the rung that renders the same backdrop here.
                        options={glassMaterialsFor(GLASS_IS_WINDOWS).map(material => ({
                          id: material,
                          label: a.translucencyFrost[material]
                        }))}
                        value={glassMaterialForPicker(translucency.material, GLASS_IS_WINDOWS)}
                      />
                    </GlassRow>
                    <GlassRow label={a.translucencyScopeTitle}>
                      <SegmentedControl
                        onChange={pickTranslucency(setTranslucencyScope)}
                        options={GLASS_SCOPES.map(scope => ({
                          id: scope,
                          label: a.translucencyScope[scope]
                        }))}
                        value={translucency.scope}
                      />
                    </GlassRow>
                  </div>
                ) : undefined
              }
              description={glassMode ? a.translucencyGlassDesc : a.translucencyDesc}
              id={settingElementId(ids.translucency)}
              title={a.translucencyTitle}
            />
          )}

          {show('chat-display') && (
            <ListRow
              action={
                // Same peek as the window lever: the bubble being tuned sits
                // behind this overlay, so the overlay ghosts while the hand is
                // on the slider.
                <div className="flex items-center gap-3" data-translucency-peek-scope="">
                  <TranslucencySlider
                    label={a.userBubbleTitle}
                    onChange={setUserBubbleTransparency}
                    value={userBubbleTransparency}
                  />
                </div>
              }
              description={a.userBubbleDesc}
              id={settingElementId(ids.userBubble)}
              title={a.userBubbleTitle}
            />
          )}

          {show('chat-display') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setTextDirection(id)
                  }}
                  options={textDirectionOptions}
                  value={textDirection}
                />
              }
              description={a.textDirectionDesc}
              id={settingElementId(ids.textDirection)}
              title={a.textDirectionTitle}
            />
          )}

          {show('window-layout') && (
            <ToggleRow
              checked={backdrop}
              description={a.backdropDesc}
              id={settingElementId(ids.backdrop)}
              label={a.backdropTitle}
              onChange={setBackdrop}
            />
          )}

          {show('chat-display') && (
            <ToggleRow
              checked={hideThreadTimeline}
              description={a.hideThreadTimelineDesc}
              id={settingElementId(ids.hideThreadTimeline)}
              label={a.hideThreadTimelineTitle}
              onChange={setHideThreadTimeline}
            />
          )}

          {show('general') && (
            <ToggleRow
              checked={introSplash}
              description={a.introSplashDesc}
              id={settingElementId(ids.introSplash)}
              label={a.introSplashTitle}
              onChange={setIntroSplash}
            />
          )}

          {show('general') && (
            <ToggleRow
              checked={showModelPricing}
              description={a.modelPricingDesc}
              id={settingElementId(ids.modelPricing)}
              label={a.modelPricingTitle}
              onChange={setShowModelPricing}
            />
          )}

          {/* The same state as the titlebar toggle / ⌘J, which persists across
              launches — so this is the file browser's standing default. Simple
              mode shadows it; a flip there only lasts the session, so say so. */}
          {show('window-layout') && (
            <ToggleRow
              checked={fileBrowserOpen}
              description={withModeNote(a.fileBrowserDesc, fileBrowserShadowed)}
              id={settingElementId(ids.fileBrowser)}
              label={a.fileBrowserTitle}
              onChange={setFileBrowserOpen}
            />
          )}

          {show('window-layout') && (
            <ToggleRow
              checked={composerPopoutGesturesEnabled}
              description={a.composerPopoutDesc}
              id={settingElementId(ids.composerPopout)}
              label={a.composerPopoutTitle}
              onChange={setComposerPopoutGesturesEnabled}
            />
          )}

          {show('general') && <ResumeLastSessionSetting />}

          {show('chat-display') && (
            <ToggleRow
              checked={reactionsEnabled}
              description={a.reactionsDesc}
              id={settingElementId(ids.reactions)}
              label={a.reactionsTitle}
              onChange={setReactionsEnabled}
            />
          )}

          {show('general') && (
            <ToggleRow
              below={
                // A tip shows once (✕ or timer), so this is the only way to a
                // second lap. It appears once there is something to bring back.
                spentTips > 0 && <RowFootnoteAction onClick={resetTips}>{a.tipsReset(spentTips)}</RowFootnoteAction>
              }
              checked={tipsEnabled}
              description={a.tipsDesc}
              id={settingElementId(ids.tips)}
              label={a.tipsTitle}
              onChange={setTipsEnabled}
            />
          )}

          {show('general') && (
            <ToggleRow
              checked={toursEnabled}
              description={a.toursDesc}
              id={settingElementId(ids.tours)}
              label={a.toursTitle}
              onChange={setToursEnabled}
            />
          )}

          {show('chat-display') && (
            <ToggleRow
              checked={vibeHeartsEnabled}
              description={a.vibeHeartsDesc}
              id={settingElementId(ids.vibeHearts)}
              label={a.vibeHeartsTitle}
              onChange={setVibeHeartsEnabled}
            />
          )}

          {show('chat-display') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setToolViewMode(id)
                  }}
                  options={toolOptions}
                  value={toolViewMode}
                />
              }
              description={withModeNote(a.toolViewDesc, toolViewShadowed)}
              id={settingElementId(ids.toolView)}
              title={a.toolViewTitle}
            />
          )}

          {show('chat-display') && (
            <ToggleRow
              checked={hideCodeDiffs}
              description={withModeNote(a.hideCodeDiffsDesc, hideCodeDiffsShadowed)}
              id={settingElementId(ids.hideCodeDiffs)}
              label={a.hideCodeDiffsTitle}
              onChange={setHideCodeDiffs}
            />
          )}

          {show('chat-display') && (
            <ToggleRow
              checked={reasoningCollapsedByDefault}
              description={withModeNote(a.reasoningCollapsedDesc, reasoningCollapsedShadowed)}
              id={settingElementId(ids.reasoningCollapsed)}
              label={a.reasoningCollapsedTitle}
              onChange={setReasoningCollapsedByDefault}
            />
          )}

          {show('chat-display') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setEmbedMode(id)
                  }}
                  options={embedOptions}
                  value={embedMode}
                />
              }
              below={
                embedAllowed.length > 0 && (
                  <RowFootnoteAction onClick={clearEmbedAllowed}>
                    {a.embedsReset(embedAllowed.length)}
                  </RowFootnoteAction>
                )
              }
              description={a.embedsDesc}
              id={settingElementId(ids.embeds)}
              title={a.embedsTitle}
            />
          )}
        </div>
      </div>

      {show('pet') && (
        <div className={subpage === undefined ? 'mt-6' : undefined} id={settingElementId(ids.pet)}>
          <PetSettings />
        </div>
      )}

      {/* Plugin-provided appearance controls — the sanctioned seam for a
          plugin that used to inject nodes into this page. Top-level page only:
          a deep-link subpage shows one built-in section, and a plugin card is
          not that section. */}
      {subpage === undefined && <AppearanceExtraSlot />}
    </SettingsContent>
  )
}
