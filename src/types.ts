export interface UsageBar {
  label: string            // "Session", "Weekly", "Monthly", custom
  usedPct: number | null   // percent used
  resetsAt: number | null  // epoch seconds
  note?: string
  consumedTokens?: number | null // tokens actually consumed inside this window
  windowMins?: number | null     // length of the quota window
  idealLeftPct?: number | null
  burnPctPerHour?: number | null
}

export interface ProviderCard {
  id: string
  name: string
  sublabel?: string
  plan?: string | null
  status: "ok" | "unconfigured" | "error" | "loading"
  statusDetail?: string
  bars: UsageBar[]
  chips?: string[]
  icon: string
  quotaGroup?: string   // cards sharing a quotaGroup render merged into one gapped bar
  weight?: number       // relative share of the shared quota pool (default 1)
  updatedAt?: number      // epoch ms — when the provider data was captured
  stats?: { label: string; value: string }[]
}

export interface KioskData {
  setupRequired?: boolean
  runtime?: { mode: 'desktop' | 'kiosk'; t3Enabled: boolean; sections?: DashboardSections }
  updatedAt: number
  providers: ProviderCard[]
  usage?: HubUsage
  activity: {
    codex?: {
      summary?: {
        lifetimeTokens: number
        peakDailyTokens: number
        longestRunningTurnSec: number
        currentStreakDays: number
        longestStreakDays: number
      }
      daily?: { date: string; tokens: number }[]
    }
    hub?: {
      daily?: { date: string; tokens: number }[]
      models?: { provider: string; model: string; week: number; daily: Record<string, number> }[]
      tokensLastHour?: number
      todayTokens?: number
      updatedAt?: number
    }
    claude?: { todayTokens: number; tokensLastHour: number; updatedAt: number; partial: boolean }
    localCodex?: { todayTokens: number; tokensLastHour: number; updatedAt: number }
  }
  opencode?: { status: "connected" | "unreachable" | "unconfigured"; detail?: string; url?: string }
  t3?: {
    status: "ok" | "unavailable"
    detail?: string
    sessions: T3Session[]
    stats?: T3Stats
    updatedAt?: number
    macT3Focused?: boolean
    sources?: { origin: string; updatedAt: number; stale: boolean }[]
  }
}

// pushed once a second on its own channel so the odometer tracks real usage
export interface KioskTick {
  tokensToday: number
  tokensLastHour: number
  tokensPerMin: number
  updatedAt: number
}

export interface HubModelUsage {
  provider: string
  model: string
  tokens: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  cacheHitRate: number | null
  requests: number
}

export interface HubUsage {
  updatedAt?: number
  partial?: boolean
  pricingBasis?: "configured" | "list-price"
  costUsd: number
  cacheHitRate: number | null
  tokensPerMin: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  models: HubModelUsage[]
  modelsDaily?: { provider: string; model: string; daily: Record<string, number> }[]
  daily: {
    date: string
    totalTokens: number
    costUsd: number | null
    inputTokens: number
    outputTokens: number
    cachedInputTokens: number
    cacheObservedInputTokens?: number
    pricedRequests?: number
    unpricedRequests?: number
    unmeteredRequests?: number
  }[]
}

export interface T3Stats {
  snoozed: number   // t3 threads parked until a later date
  settled: number   // t3 threads marked finished
}

export interface T3Pr {
  host?: string
  repository?: string
  url?: string
  headSha?: string
  updatedAt?: number
  relation?: "linked" | "branch" | "mentioned"
  ci?: { state: "success" | "failure" | "pending" | "none" | "unknown"; passed: number; total: number; failed: number; updatedAt: number }
  review?: "approved" | "changes" | "pending" | "unknown"
  number: number
  state: "open" | "merged" | "closed" | null
  draft: boolean
  mergeability: string | null   // "conflicting" is the one worth showing
  title?: string | null         // the PR's own title, shown under the session
}

export interface T3Session {
  id: string
  title: string
  branch: string | null
  project: string
  projectInitials: string
  status: "working" | "done" | "woke" | "idle" | "input" | "approval" | "error"
  lifecycle?: "active" | "snoozed" | "woke"
  snoozedUntil?: number | null
  completedAt?: number | null
  model?: string | null
  harness?: string | null
  stale?: boolean
  staleAt?: number       // epoch ms of the last successful source read
  agents?: { id: string; name: string | null; model?: string | null; status: "working" | "done" | "error" | "idle" | "unknown"; updatedAt: number }[]
  workingSince: number | null  // epoch seconds — start of the running turn
  prs: T3Pr[]                  // pull requests linked to the thread, by number
  activityAt: number | null    // epoch seconds — last user message / update
  origin?: string              // configured device label
}

export interface DashboardSections { today: boolean; activity: boolean; capacity: boolean; sessions: boolean }
export interface SetupChoices { codex: boolean; claude: boolean; t3: boolean; mode: 'desktop' | 'kiosk'; sections: DashboardSections; hubUrl: string; hubToken: string }
export interface SetupInfo {
  detected: { platform: string; configPath: string; codex: { installed: boolean; history: boolean }; claude: { installed: boolean; history: boolean }; t3: boolean; python: string | null; sqlite: string | null }
  selected: Omit<SetupChoices, 'hubToken'> & { hasHubToken: boolean }
  error?: string | null
}
