/** Was die letzte Antwort über den Prompt-Cache verrät. */
export type CacheInfo = {
  /** Zeitpunkt der letzten Antwort, ms seit Epoch. */
  at: number
  /** Cache-Laufzeit der Session in Minuten: 5 oder 60. */
  ttlMin: number
  /** Anteil der Input-Tokens aus dem Cache, 0 bis 100; null ohne Usage. */
  hitPct: number | null
}

/** Kontextfüllung und Auto-Compact-Schwelle, beide in Prozent des Fensters. */
export type CtxInfo = {
  pct: number | null
  thresholdPct: number
  /** false, wenn die Schwelle nicht auslesbar war und 83 % angenommen wird. */
  isThresholdRead: boolean
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: {
      cache: CacheInfo | null
      ctx: CtxInfo | null
      transcript: string | null
      isCollapsed: boolean
      tick: number
      handoff: string | null
      isHandoffPending: boolean
      warmUntil: number | null
      isWarmFormOpen: boolean
    }
  }
}
