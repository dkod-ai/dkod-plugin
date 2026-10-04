// DKOD Guard's band values (packages/guard/src/claude-band.ts), held by the host for the session.
export type GuardPulse = { decision: 'allowed' | 'blocked' | 'declined'; text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'dkod': {
      auth: 'checking' | 'ok' | 'signin' | 'offline' | 'device'
      frame: number
      pulse: GuardPulse | null
      pulseFrame: number
      status: string
    }
  }
}
