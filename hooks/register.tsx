import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionCompactResult, SessionRateLimit, Timer } from 'claude-code'

import type { CacheInfo, CtxInfo } from '../types'
import { BOXES, FALLBACK_THRESHOLD, cacheView, fmtTokens, parseTranscript, splitText, light } from './logic'

// ── Zustand ────────────────────────────────────────────────────────────────
const cache = atom({ plugin: 'cockpit', key: 'cache' } as const, null)
const ctx = atom({ plugin: 'cockpit', key: 'ctx' } as const, null)
const transcript = atom({ plugin: 'cockpit', key: 'transcript' } as const, null)
const isCollapsed = atom({ plugin: 'cockpit', key: 'isCollapsed' } as const, false)
const tick = atom({ plugin: 'cockpit', key: 'tick' } as const, 0)
const handoff = atom({ plugin: 'cockpit', key: 'handoff' } as const, null)
const isHandoffPending = atom({ plugin: 'cockpit', key: 'isHandoffPending' } as const, false)
const warmUntil = atom({ plugin: 'cockpit', key: 'warmUntil' } as const, null)
const isWarmFormOpen = atom({ plugin: 'cockpit', key: 'isWarmFormOpen' } as const, false)

// ── Einstellungen ──────────────────────────────────────────────────────────
const TAIL_LINES = '400'
const HOUR_MS = 60 * 60 * 1000
const DEFAULT_WARM_HOURS = 3
const MAX_WARM_HOURS = 12
const WARM_STOP_PERCENT = 90

const PING_TEXT = 'Cache-Ping. Antworte ausschließlich mit dem einen Wort: warm. Keine Tools, kein weiterer Text.'

const HANDOFF_PROMPT = [
  'Schreib eine Übergabe für einen neuen Chat, damit ich dort nahtlos weitermachen kann.',
  'Nutze genau diese Gliederung in Markdown und nichts davor oder danach:',
  '',
  '# Übergabe',
  '## Ziel',
  '(worum es geht und was am Ende stehen soll)',
  '## Erledigt',
  '(Stichpunkte: was schon fertig ist, mit Dateipfaden und Entscheidungen samt Begründung)',
  '## Offen und Stolpersteine',
  '(was noch fehlt, bekannte Probleme, Annahmen)',
  '## Nächster Schritt',
  '(der eine konkrete nächste Schritt, so formuliert, dass ein neuer Chat sofort loslegen kann)',
  '',
  'Kurz und konkret, ohne Gedankenstriche. Keine Tools aufrufen.',
].join('\n')

// Modulvariablen: starten nach einem Reload neu
let reportedAt = 0
let lastAnswerAt: number | null = null
let warmTimer: Timer | null = null

// ── Hilfen ohne $ ──────────────────────────────────────────────────────────
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const pad = (n: number) => String(n).padStart(2, '0')

function formatReset(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`

  return new Date(now).toDateString() === at.toDateString() ? time : `${WEEKDAYS[at.getDay()]} ${time}`
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} min`

  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

function limitColor(percent: number | null | undefined): string | undefined {
  if (percent == null) return undefined
  if (percent >= 90) return 'error'
  if (percent >= 70) return 'warning'

  return undefined
}

const isPingAnswer = (text: string) => text.trim().toLowerCase().replace(/[.!*_`"]/g, '') === 'warm'

function parseHours(raw: string): number | null {
  const text = raw.trim()
  if (text === '') return DEFAULT_WARM_HOURS
  const hours = Number(text.replace(',', '.'))
  if (!Number.isFinite(hours) || hours <= 0) return null

  return Math.min(hours, MAX_WARM_HOURS)
}

// ── Cache und Kontext (aus cache-wetter) ───────────────────────────────────
async function refreshCache($: EngineInterface, path: string | null) {
  if (!path) return
  try {
    const { stdout } = await $.process.run(['tail', '-n', TAIL_LINES, path])
    const prev = await read($, cache)
    const info = parseTranscript(stdout, prev?.ttlMin)
    if (info) await update($, cache, () => info)
  } catch {
    // Kein Transkript lesbar: die Anzeige bleibt, wie sie war.
  }
}

async function refreshCtx($: EngineInterface, pctOverride?: number) {
  let info: CtxInfo
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const b = context.breakdown
    const isThresholdRead = !!(b?.isAutoCompactEnabled && b.autoCompactThreshold && context.window)
    info = {
      pct: pctOverride ?? context.percent ?? null,
      thresholdPct: isThresholdRead
        ? Math.round(((b?.autoCompactThreshold ?? 0) / context.window) * 100)
        : FALLBACK_THRESHOLD,
      isThresholdRead,
    }
  } catch {
    const { context } = await $.session.usage()
    info = { pct: pctOverride ?? context.percent ?? null, thresholdPct: FALLBACK_THRESHOLD, isThresholdRead: false }
  }
  await update($, ctx, () => info)
}

async function report($: EngineInterface, r: SessionCompactResult) {
  if (r.skip !== undefined || !r.messages) return
  reportedAt = await $.clock.now()

  const summary = r.messages.find(m => m.role === 'user' && m.text.trim())?.text.trim() ?? ''
  $.ui.log(`🗜️ Compact: ${fmtTokens(r.tokensBefore)} → ${fmtTokens(r.tokensAfter)} Tokens`)
  if (!summary) {
    $.ui.log('(Keine Zusammenfassung im Ergebnis gefunden.)')
  } else {
    const chunks = splitText(summary)
    chunks.forEach((c, i) => {
      const head = chunks.length > 1 ? `Zusammenfassung ${i + 1}/${chunks.length}:\n` : 'Zusammenfassung:\n'
      $.ui.log(head + c)
    })
  }

  const { context } = await $.session.usage()
  const pct = r.tokensAfter !== undefined && context.window ? Math.round((r.tokensAfter / context.window) * 100) : undefined
  await refreshCtx($, pct)
}

function queueCompact($: EngineInterface) {
  $.ui.toast('/compact ist eingereiht und startet, sobald Claude fertig ist')
  $.command.run({ command: 'compact' }).catch(() => {
    $.ui.toast('/compact ließ sich nicht einreihen')
  })
}

async function compactNow($: EngineInterface, surface: string, isWorking: boolean) {
  if (surface === 'desktop' || isWorking) return queueCompact($)
  const startedAt = await $.clock.now()
  try {
    const r = await $.session.compact()
    if (reportedAt < startedAt) await report($, r)
  } catch {
    queueCompact($)
  }
}

// ── Warmhalten ─────────────────────────────────────────────────────────────
async function stopWarm($: EngineInterface, reason?: string) {
  warmTimer?.cancel()
  warmTimer = null
  await update($, warmUntil, () => null)
  if (reason) $.ui.toast(reason)
}

async function pingWarm($: EngineInterface) {
  warmTimer = null
  const end = await read($, warmUntil)
  if (end == null) return
  if ((await $.clock.now()) >= end) {
    await stopWarm($, 'Warmhalten beendet: Zeit abgelaufen.')
    return
  }
  const { rateLimits } = await $.session.usage()
  const fiveHour = rateLimits.find(limit => limit.kind === 'five_hour')
  if (fiveHour && fiveHour.percentUsed >= WARM_STOP_PERCENT) {
    await stopWarm($, `Warmhalten gestoppt: 5h-Limit bei ${Math.round(fiveHour.percentUsed)} %.`)
    return
  }
  void $.prompt.submit({ text: PING_TEXT })
}

// Nächster Ping kurz vor Ablauf des Caches: 5 min vorher bei 1 h, 1 min vorher bei 5 min
async function scheduleWarm($: EngineInterface) {
  warmTimer?.cancel()
  warmTimer = null
  if ((await read($, warmUntil)) == null) return
  const now = await $.clock.now()
  const ttlMin = (await read($, cache))?.ttlMin ?? 60
  const marginMin = ttlMin >= 60 ? 5 : 1
  const last = lastAnswerAt ?? now
  const delay = Math.max(5_000, last + (ttlMin - marginMin) * 60_000 - now)
  warmTimer = $.clock.after(delay, () => void pingWarm($))
}

async function startWarm($: EngineInterface, raw: string): Promise<string> {
  const hours = parseHours(raw)
  if (hours == null) return 'Bitte eine Zahl von 1 bis 12 eingeben.'
  const now = await $.clock.now()
  await update($, warmUntil, () => now + hours * HOUR_MS)
  await update($, isWarmFormOpen, () => false)
  await scheduleWarm($)

  return `Warmhalten an für ${formatDuration(hours * HOUR_MS)}.`
}

async function copyHandoff($: EngineInterface, text: string, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
  const result = await $.ui.copy({ text, surface })
  $.ui.toast(result.isCopied ? 'Übergabe kopiert. Im neuen Chat einfügen.' : 'Kopieren hat nicht geklappt.')
}

function findLimit(limits: SessionRateLimit[], kind: string) {
  return limits.find(limit => limit.kind === kind)
}

// ── Hooks ──────────────────────────────────────────────────────────────────
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'handoff',
      description: 'Übergabe schreiben (Ziel, Erledigt, Nächster Schritt) zum Kopieren in einen neuen Chat',
    })
    await $.command.register({
      name: 'warmhalten',
      description: 'Cache warm halten: ohne Zahl 3 Stunden, mit Zahl so viele Stunden (max. 12), "aus" schaltet ab',
      argumentHint: '[Stunden | aus]',
      immediate: true,
    })
    $.clock.every(60_000, () => {
      void update($, tick, n => n + 1)
    })
    void refreshCtx($)
    void refreshCache($, await read($, transcript))
    await scheduleWarm($)

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    await update($, transcript, () => e.transcript_path)
    void refreshCache($, e.transcript_path)

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    await update($, transcript, () => e.transcript_path)
    await refreshCache($, e.transcript_path)
    await refreshCtx($)

    return next(e)
  })

  on('session.measure', ($, e, next) => {
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && (e.trigger === 'manual' || e.trigger === 'plugin')) await report($, r)

    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      lastAnswerAt = await $.clock.now()
      if (await read($, isHandoffPending)) {
        await update($, isHandoffPending, () => false)
        const text = e.answer.trim()
        if (e.reason === 'answer' && text && !isPingAnswer(text)) await update($, handoff, () => text)
      }
      await scheduleWarm($)
    }

    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => {
    await update($, isHandoffPending, () => true)
    void $.prompt.submit({ text: HANDOFF_PROMPT })

    return { text: 'Übergabe wird geschrieben. Danach erscheint der Kopierknopf über dem Eingabefeld.', isTextDisplayOnly: true }
  })

  on('command.run', { command: 'warmhalten' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'aus' || arg === 'off' || arg === 'stop') {
      await stopWarm($)
      return { text: 'Warmhalten ist aus.', isTextDisplayOnly: true }
    }

    return { text: await startWarm($, arg), isTextDisplayOnly: true }
  })

  // Der Ping erscheint im Chat nur als graue Zeile, Claudes "warm" gar nicht
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const origin = e.props.origin
    if (origin.kind !== 'plugin' || origin.name !== 'cockpit' || !e.props.text.startsWith('Cache-Ping.')) return next(e)
    const { Text } = $.ui.resolve(e)

    return <Text dimColor>Cache warm gehalten</Text>
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!isPingAnswer(e.props.text)) return next(e)
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    await read($, tick)
    const now = await $.clock.now()
    const info: CacheInfo | null = await read($, cache)
    const c: CtxInfo | null = await read($, ctx)
    const collapsed = await read($, isCollapsed)
    const handoffText = await read($, handoff)
    const isPending = await read($, isHandoffPending)
    const warmEnd = await read($, warmUntil)
    const isFormOpen = await read($, isWarmFormOpen)
    const { rateLimits } = await $.session.usage()
    const { Box, Button, Input, Text } = $.ui.resolve(e)

    const view = info ? cacheView(now, info) : null
    const cacheColor = view?.color ?? 'inactive'
    const restText = view === null ? '–' : view.isExpired ? 'kalt' : `${view.remainingMin} min`
    const thresholdPct = c?.thresholdPct ?? FALLBACK_THRESHOLD
    const pct = c?.pct ?? null
    const lamp = light(pct, thresholdPct)
    const isRed = lamp === '🔴'
    const ctxColor = isRed ? 'error' : lamp === '🟠' ? 'warning' : undefined
    const pctText = pct === null ? '–' : `${Math.round(pct)} %`
    const thrText = `${c && !c.isThresholdRead ? '~' : ''}${thresholdPct} %`
    const isWarm = warmEnd != null && warmEnd > now
    const fiveHour = findLimit(rateLimits, 'five_hour')
    const week = findLimit(rateLimits, 'seven_day')
    const filled = view?.filled ?? 0
    const hit = info?.hitPct
    const surface = e.surface
    const isWorking = e.props.isWorking

    // Jede Zeile ist ein einziger Text mit farbigen Teilen: so stapelt die Desktop-App nichts
    const limitSpan = (label: string, limit: SessionRateLimit | undefined, withReset: boolean) => {
      if (!limit) return <Text dimColor>{`${label} –`}</Text>
      const reset = withReset ? formatReset(limit.resetsAt, now) : ''
      const color = limitColor(limit.percentUsed)

      return (
        <Text color={color} dimColor={!color}>
          {`${label} ${Math.round(limit.percentUsed)} %${reset ? ` (frei ${reset})` : ''}`}
        </Text>
      )
    }
    const dot = <Text dimColor>{'  ·  '}</Text>

    const toggle = (
      <Button key="toggle" plain label={collapsed ? '▸' : '▾'} onPress={() => update($, isCollapsed, v => !v)} />
    )

    if (collapsed) {
      return (
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {toggle}
          <Text wrap="truncate">
            <Text dimColor>Cache </Text>
            <Text color={cacheColor}>{restText}</Text>
            {isWarm ? <Text color="success"> warm</Text> : null}
            {dot}
            <Text color={ctxColor}>{`${lamp} ${pctText}`}</Text>
            {dot}
            {limitSpan('5h', fiveHour, false)}
            {dot}
            {limitSpan('Woche', week, false)}
          </Text>
        </Box>
      )
    }

    // Rechte Spalte, Zeile 1: Warmhalten
    let warmControls
    if (isWarm) {
      warmControls = (
        <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={0}>
          <Text color="success" wrap="truncate">{`Warm, noch ${formatDuration((warmEnd ?? now) - now)}`}</Text>
          <Button key="warm-off" label="Aus" onPress={() => stopWarm($, 'Warmhalten ist aus.')} />
        </Box>
      )
    } else if (isFormOpen) {
      warmControls = (
        <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={0}>
          <Input
            key="warm-hours"
            placeholder="Stunden"
            value={String(DEFAULT_WARM_HOURS)}
            submitLabel="Start"
            autoFocus
            onSubmit={async value => $.ui.toast(await startWarm($, value))}
          />
          <Button key="warm-cancel" plain label="×" onPress={() => update($, isWarmFormOpen, () => false)} />
        </Box>
      )
    } else {
      warmControls = (
        <Box flexDirection="row" flexShrink={0}>
          <Button key="warm-open" label="Warmhalten" onPress={() => update($, isWarmFormOpen, () => true)} />
        </Box>
      )
    }

    // Rechte Spalte, Zeile 2: Compact und Übergabe
    const ctxControls = (
      <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={0}>
        {isPending ? <Text dimColor wrap="truncate">Übergabe läuft…</Text> : null}
        {handoffText && !isPending ? (
          <Button key="copy-handoff" label="Übergabe kopieren" onPress={press => copyHandoff($, handoffText, press.surface)} />
        ) : null}
        {handoffText && !isPending ? (
          <Button key="drop-handoff" label="×" plain dimColor onPress={() => update($, handoff, () => null)} />
        ) : null}
        <Button
          key="compact"
          label="Compact"
          variant={isRed ? 'primary' : 'secondary'}
          onPress={() => compactNow($, surface, isWorking)}
        />
      </Box>
    )

    // isSpread: Knöpfe rechtsbündig; sonst direkt hinter dem Text
    const row = (text: RenderChildren, controls: RenderChildren, isSpread: boolean) => (
      <Box flexDirection="row" columnGap={2} alignItems="center" justifyContent={isSpread ? 'space-between' : 'flex-start'}>
        <Box flexDirection="row" flexGrow={isSpread ? 1 : 0} flexShrink={1}>
          {text}
        </Box>
        {controls}
      </Box>
    )

    const line1 = (
      <Text wrap="truncate">
        <Text dimColor>{`Cache${info ? ` (${info.ttlMin === 60 ? '1 h' : '5 min'})` : ''} `}</Text>
        <Text color={cacheColor}>{restText}</Text>
        <Text>{'  '}</Text>
        <Text color={cacheColor}>{'■'.repeat(filled)}</Text>
        <Text dimColor>{'□'.repeat(BOXES - filled)}</Text>
        {dot}
        <Text dimColor>Hit </Text>
        <Text>{hit == null ? '–' : `${hit} %`}</Text>
      </Text>
    )

    const line2 = (
      <Text wrap="truncate">
        <Text>{`${lamp} `}</Text>
        <Text dimColor>Kontext </Text>
        <Text color={ctxColor} weight={isRed ? 'bold' : undefined}>{pctText}</Text>
        <Text dimColor>{` / Compact bei ${thrText}`}</Text>
        {dot}
        {limitSpan('5h', fiveHour, true)}
        {dot}
        {limitSpan('Woche', week, true)}
      </Text>
    )

    return (
      <Box flexDirection="row" columnGap={1}>
        <Box flexDirection="column" flexShrink={0}>
          {toggle}
        </Box>
        <Box flexDirection="column" flexGrow={1} rowGap={0}>
          {row(line1, warmControls, false)}
          {row(line2, ctxControls, true)}
        </Box>
      </Box>
    )
  })
}
