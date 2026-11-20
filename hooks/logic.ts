import type { CacheInfo } from '../types'

export const BOXES = 20
export const FALLBACK_THRESHOLD = 83
/** Unter der Grenze des Terminals (2000 Zeichen pro Log-Zeile). */
export const CHUNK = 1800

type Usage = {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  } | null
}

type Entry = {
  type?: string
  isSidechain?: boolean
  timestamp?: string
  message?: { model?: string; usage?: Usage }
}

/**
 * Liest das Ende eines Transkripts (JSONL): Zeit und Hit-Rate der letzten
 * Antwort, und die Cache-Laufzeit aus dem letzten Cache-Schreibvorgang.
 * Ohne Schreibvorgang im Ausschnitt bleibt die bisher bekannte Laufzeit.
 */
export function parseTranscript(text: string, prevTtlMin: number | undefined): CacheInfo | null {
  const lines = text.split('\n')
  let last: { at: number; usage: Usage } | null = null
  let ttlMin: number | undefined

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim()
    if (!line) continue
    let entry: Entry
    try {
      entry = JSON.parse(line) as Entry
    } catch {
      continue
    }
    const usage = entry.message?.usage
    if (entry.type !== 'assistant' || entry.isSidechain || !usage) continue
    if (entry.message?.model === '<synthetic>') continue

    if (last === null) {
      const at = Date.parse(entry.timestamp ?? '')
      if (Number.isFinite(at)) last = { at, usage }
    }
    const written = usage.cache_creation
    if (ttlMin === undefined && written) {
      if ((written.ephemeral_1h_input_tokens ?? 0) > 0) ttlMin = 60
      else if ((written.ephemeral_5m_input_tokens ?? 0) > 0) ttlMin = 5
    }
    if (last !== null && ttlMin !== undefined) break
  }

  if (last === null) return null
  return { at: last.at, ttlMin: ttlMin ?? prevTtlMin ?? 5, hitPct: hitRate(last.usage) }
}

export function hitRate(u: Usage): number | null {
  const read = u.cache_read_input_tokens ?? 0
  const total = (u.input_tokens ?? 0) + read + (u.cache_creation_input_tokens ?? 0)
  return total > 0 ? Math.round((read / total) * 100) : null
}

export type CacheView = {
  remainingMin: number
  filled: number
  color: 'success' | 'warning' | 'error'
  isExpired: boolean
}

export function cacheView(now: number, info: CacheInfo): CacheView {
  const ttlMs = info.ttlMin * 60_000
  const remainingMs = Math.max(0, info.at + ttlMs - now)
  const frac = remainingMs / ttlMs
  const color = frac <= 0.1 ? 'error' : frac <= 0.25 ? 'warning' : 'success'
  return {
    remainingMin: Math.ceil(remainingMs / 60_000),
    filled: Math.min(BOXES, Math.ceil(frac * BOXES)),
    color,
    isExpired: remainingMs === 0,
  }
}

/** Ampel für den Kontext: Grün bis 50 % der Compact-Schwelle, Orange bis 80 %, darüber Rot. */
export type Light = '🟢' | '🟠' | '🔴'

export function light(pct: number | null, thresholdPct: number): Light {
  if (pct === null) return '🟢'
  if (pct <= thresholdPct * 0.5) return '🟢'
  if (pct <= thresholdPct * 0.8) return '🟠'
  return '🔴'
}

/** Teilt an Absätzen, dann an Zeilen, zuletzt hart, damit kein Stück über `max` liegt. */
export function splitText(text: string, max = CHUNK): string[] {
  const pieces: string[] = []
  for (const para of text.split(/\n\s*\n/)) {
    if (para.length <= max) {
      pieces.push(para)
      continue
    }
    const parts = para.split('\n').flatMap(l => {
      const out: string[] = []
      for (let i = 0; i < l.length; i += max) out.push(l.slice(i, i + max))
      return out.length ? out : ['']
    })
    let block = ''
    for (const part of parts) {
      if (block && block.length + 1 + part.length > max) {
        pieces.push(block)
        block = part
      } else {
        block = block ? `${block}\n${part}` : part
      }
    }
    if (block) pieces.push(block)
  }

  const chunks: string[] = []
  let cur = ''
  for (const p of pieces) {
    if (!p.trim()) continue
    if (cur && cur.length + 2 + p.length > max) {
      chunks.push(cur)
      cur = p
    } else {
      cur = cur ? `${cur}\n\n${p}` : p
    }
  }
  if (cur) chunks.push(cur)
  return chunks
}

export function fmtTokens(n: number | undefined): string {
  if (n === undefined) return '?'
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}
