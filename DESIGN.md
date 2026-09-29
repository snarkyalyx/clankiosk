---
name: AI Kiosk
description: Warm, compact measurements and session status for a read-only portrait kiosk.
colors:
  background: '#121211'
  foreground: '#efeee9'
  card: '#1b1b19'
  muted-foreground: '#aaa99f'
  other: '#686a63'
  success: '#88c89b'
  completion: '#59eb86'
  warning: '#e3ba79'
  danger: '#e99591'
  merged: '#bf9ce8'
  model-luna: '#aa91df'
  model-sol: '#e6b15d'
  model-sol-legacy: '#8c79ad'
  model-luna-legacy: '#619789'
  model-deepseek: '#649be0'
  model-glm: '#de91a2'
  model-astra: '#78bdcc'
  model-claude: '#de9679'
  model-kimi: '#bb9981'
  working: '#70c5da'
  model-track: '#30312d'
  activity-track: '#292a26'
  quota-track: '#2b2e29'
  quota-remaining: '#657461'
typography:
  display:
    fontFamily: JetBrains Mono, ui-monospace, monospace
    fontSize: 56px
    fontWeight: 500
    lineHeight: 44px
    letterSpacing: -0.02em
  heading:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 15px
    fontWeight: 550
    letterSpacing: -0.015em
  session-title:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: -0.01em
  model-label:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 12px
  group-label:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
  branch:
    fontFamily: JetBrains Mono, ui-monospace, monospace
    fontSize: 12px
rounded:
  model: 2px
  quota: 5px
  activity: 7px
  surface: 14px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 20px
  xl: 24px
  frame: 28px
  column: 40px
components:
  token-measurement:
    textColor: '{colors.foreground}'
    typography: '{typography.display}'
    height: 83px
  model-track:
    backgroundColor: '{colors.model-track}'
    rounded: '{rounded.model}'
    height: 4px
  activity-track:
    backgroundColor: '{colors.activity-track}'
    rounded: '{rounded.activity}'
  quota-track:
    backgroundColor: '{colors.quota-track}'
    rounded: '{rounded.quota}'
    height: 24px
  session-row-compact:
    textColor: '{colors.foreground}'
    typography: '{typography.session-title}'
    height: 62px
    padding: 8px 0 9px
  status:
    textColor: '{colors.muted-foreground}'
  session-group:
    textColor: '{colors.muted-foreground}'
    typography: '{typography.group-label}'
---

# Design System: AI Kiosk

## Overview

**Creative North Star: "Production rundown"**

Warm graphite and ivory frame a compact operational rundown for an expert UI/UX designer and SWE. The geared odometer and tall activity columns carry the visual identity; familiar Git symbols, check ratios and brief exception labels carry state.

The kiosk is read-only and has no touch workflow. Its vocabulary is measurement, track, row, status and group. The completed implementation and user follow-up supersede the original plan’s overlabeling. No generated rasters are used.

The source of truth is this specification together with `src/index.css`, `src/App.tsx`, `src/components/TokenCounter.tsx` and `src/lib/dashboard.ts`. Preview fixtures use synthetic usage and session data.

**Key Characteristics:**

- Warm neutral surfaces; color identifies models and operational state.
- Preserved odometer, tall columns and compact expert notation.
- Measured density with a stable priority slice when sessions exceed capacity.

## Colors

### Primary

The measurement palette maps Luna to seafoam, Sol to lavender, DeepSeek to ochre, GLM to rose, Astra to sky, Claude to sage and historical Kimi to clay. GPT 5 variants use darker family shades so the weekly legend distinguishes them from GPT 6. Unknown model names hash deterministically into the same seven colors. Other usage is muted olive-gray. Kimi remains in accounting and is excluded from active capacity.

### Secondary

Success green marks completion, open PRs and passing checks; amber marks input, approval, conflicts and quota risk; salmon marks failure, closed PRs and exhaustion; violet marks merged PRs. Working uses a restrained cyan matching the T3 sidebar vocabulary. Quota remaining uses muted sage.

### Neutral

Graphite background, warmer raised surface, ivory foreground and stone secondary text establish hierarchy. Model, activity and quota tracks use separate muted dark tones. Frontmatter contains the built colors; sidecar tonal ramps are generated swatch previews only.

**The Stable Color Rule.** Keep model colors consistent across today’s tracks and the seven-day chart; preserve the separate status vocabulary.

## Typography

Inter carries headings, session titles, labels and most tabular values. JetBrains Mono carries the odometer, branches and explicitly monospaced values. The display, heading, title and label roles are recorded above; session headings match the upper section headings (15px). Dense rows retain prominent titles and smaller artifact facts. Labels use sentence case. Long titles and branches ellipsize.

CSS requests intermediate weights (450/550); bundled Inter faces are 400/500/600/700, so those requests resolve to available faces. Bundled JetBrains Mono is 400/500.

## Layout

The reference kiosk is portrait (1080 × 1920); physical scale and viewing distance remain unconfirmed. A date/time header precedes a two-row content grid (2fr/3fr, approximately 40/60 excluding the gap). The upper surface has three columns (1fr/1.04fr/1fr), with frame, padding and column spacing recorded above. Sessions occupy the lower surface, with Snoozed and Settled anchored below active groups.

A ResizeObserver measures the active list. Subtract group labels (22px each) and intergroup gaps (20px), then allocate 62px two-line rows across nonempty groups. Rows always keep the same two-line layout. When sessions exceed available slots, keep a stable priority-ordered slice and show +N for hidden rows; never rotate sessions automatically. Input, approval, error and active woke statuses keep priority when they fit. There is no scrolling on the portrait kiosk.

The shorter-desktop query (height ≤1750px, width ≥801px) reduces spacing. At width ≤800px, the page scrolls, upper measurements become two columns and capacity spans both; at ≤480px they stack. These are browser fallbacks to the portrait layout.

## Elevation & Depth

Two flat surface tones establish depth. Panels have no elevation shadow or border. Quiet hairlines separate the three measurement columns, individual providers, and session group headings. The quota pace marker alone has a one-pixel surface-colored isolation ring. The odometer’s edge gradient masks its moving glyphs.

**The Quiet Surface Rule.** Separate regions with tone, spacing and subtle hairlines; keep separators lighter than the data marks.

## Shapes

Soft panel corners, rounded tall columns and substantial quota bars and slim model tracks use the radii above. Model keys are small rounded squares (7px). Lucide strokes stay light (1.8), with glyphs generally 13–16px. Adjacent sessions are separated by subtle one-pixel rules. Each PR and its CI/review indicators share a compact 20px-high tag with 11px type, 12px icons, 5px horizontal padding and a 4px radius.

## Components

### Measurement

The odometer reads millions with a trailing M, grouped thousands and one to six wheels. Wheels are 34px wide with a 76px window and 44px step. Observed samples drive exponential catch-up (1.5s time constant); decreases snap to the new sample. Reduced motion paints the target directly. No consumption is extrapolated. API equivalent/estimate and input cache hit remain secondary, in two compact label/value rows with aligned right edges. Cache coverage stays on the same line as its label, expressed as the share of input reporting cache data. Partial pricing and missing cache observations remain explicit.

### Track

Today shows six model tracks plus Other. Tracks use each model’s share of the reported daily total; aligned token and percentage columns make small shares readable. DeepSeek V4.1 Flash uses a capital V. Seven calendar-day columns share a daily maximum and stack the top five weekly models plus Other, with rounded fill caps and no quarter-grid lines; labels distinguish missing data with an em dash. Preserve their tall silhouette. A subtle vertical overlay brightens each filled stack at its top and darkens its foot, without changing model boundaries or bar heights. Quota bars are 24px tall (20px on the shorter portrait layout). The Codex Pro 20× and Plus accounts share one segmented bar, using the collector’s 20:1 weighting, with each account’s percentage and reset time retained. A three-pixel pace line is green when remaining capacity meets or exceeds the even-use target and red below it. Unknown or stale timing omits the pace line; stale providers carry a clock indicator. Zero remaining is salmon. Reset countdowns sit inside standalone bars, above pace markers, with a single 25%-opacity, 1px offset shadow. Clock icons and the separate Pro/Plus account rows have no shadow. Providers have 32px gaps (24px on short portrait); column gutters are 40px (32px on short portrait).

### Row

Normal rows always use two lines: title and status/time above; project, verified subagent count, branch/device and right-aligned PR facts below. Session model names are omitted. Working and Idle titles share the same muted color; Done and input/approval titles are ivory. Status icons sit 6px directly beside their right-aligned tabular times, vertically centered as one group. The outer status area reserves 112px without stretching the icon-to-text gap. Idle has no invisible icon placeholder. Upper and lower panels share a 24px inset (20px on short portrait). Metadata and status use 12px type and 14px icons.

Rows always remain 62px high, with 22px title and 20px metadata tracks, a 3px gap and 8px/9px vertical padding. PR tags and branch/device details share a centerline. When the list exceeds available capacity, the visible priority slice stays fixed and a +N marker identifies hidden rows. Up to five PR tags fit on the kiosk, followed by +N; narrower containers reduce the visible count without overlap. Pro/Plus account labels and percentages use fixed columns. Provider headings include locally bundled company logos.

### Status

Open/draft/closed/merged PRs use the corresponding Git glyph and semantic color. Review and CI use familiar checks, messages and circles with compact passed/total ratios, grouped inside the associated PR tag. Signals have accessible names. Input, Approval, Error and Woke are brief visible exceptions. Cached Working indicators retain full working-color brightness; freshness stays in the accessible name and title. Hover titles are supplementary; these primitives have no interactive hover, pressed or focus states.

### Group

Done means an unread completion, using the T3 desktop client’s visit timestamps. Pending input comes only from T3’s pending-input count; an old proposed plan does not trigger Input. Done & input includes done/input/approval/error, followed by Working and Idle. Within ranks, completion/activity recency precedes stable identity. Snoozed remains below; Woke stays there, with up to two named rows and an excess count. Snoozed and Settled use the supplied sidebar pattern: label, thin rule and count at the far right. The next snooze countdown sits directly after the Snoozed label and shares its blue color. Settled is a count. Empty and unavailable states retain distinct copy. The sidecar contains static examples of these implemented primitives; completion motion and stable overflow counts are documented as metadata.

## Do's and Don'ts

### Do:

- Do preserve the geared counter and tall rounded activity columns.
- Do retain the kiosk’s 40/60 composition and measured density modes.
- Do pair semantic color with familiar icons, concise values and accessible names.
- Do distinguish zero, unavailable and stale observations.

### Don't:

- Don't add controls, navigation, project tiles or nested cards.
- Don't repeat familiar Git states in explanatory badges or depend on hover for essential meaning.
- Don't rotate session rows automatically or promote Woke out of Snoozed.
- Don't revive the cool surface cast or generate raster decoration.

## Completion feedback

A new completion observed after a prior snapshot activates and deactivates fixed square pixels from left to right. Adjacent 2×2px cells use an 8×8 Bayer threshold matrix. A solid leading band (6.5% of row width) progresses left to right with a longer dither trail behind it (48% total width). The trailing density falls quadratically into sparse dots, retaining the supplied September 26 05:12 reference’s square-cell pattern. Completion uses a dedicated vivid green (#59eb86). Their positions never translate. A small canvas renders only during the three-second completion lifetime, capped at 30 updates/second and 25% opacity. Detection lives above status groups so moving a row from Working to Done preserves feedback. Initial data, ordinary refreshes and marking the same old completion unread do not replay it. Reduced motion uses a stationary 14%-opacity pattern without repeated redraws; animation frames, listeners and resize observers are cleaned up when the effect ends. Date and time share the same responsive font size (29px at the kiosk resolution).

## Session freshness

T3 is polled every three seconds and each completed collection is pushed immediately to the renderer. Queries can add a few seconds; this is polling, not an event stream. The subagent query starts with visible threads and uses the existing thread/activity index before parsing payloads. Concurrent collections do not overlap. Provider and forge schedules remain independent.

## Portable desktop behavior

Desktop windows retain their frame, pointer and normal close behavior. The first-run screen configures data sources. At wide landscape sizes, usage and sessions sit beside each other; shorter windows stack them with vertical scrolling; narrow windows use one or two columns. Portrait kiosk mode preserves the original allocation and glanceable row density. Desktop session lists can scroll through every active session. Harness icons have a shared fixed-width slot, with Claude Code in orange.
