// SPDX-License-Identifier: Apache-2.0

// Bid workbench design system — a warm-paper + government-crimson palette from
// the approved mockup (bid-workbench-a.dc.html). Applied as a container-scoped
// CSS-variable override so the whole bid page re-themes without touching
// globals.css. Existing bid components use the standard Calm-UI tokens
// (bg-base / bg-surface / text-* / border / primary); overriding those here
// shifts them to the mockup palette. New design components use the --bid-* tokens.
import type { CSSProperties } from 'react'

export const bidThemeVars = {
  // Standard Calm-UI tokens, remapped to the mockup palette (R G B triples).
  '--color-bg-base': '247 246 244', // #F7F6F4 warm paper
  '--color-bg-surface': '255 255 255', // #FFFFFF cards/panels
  '--color-text-primary': '34 32 30', // #22201E warm near-black
  '--color-text-secondary': '87 82 77', // #57524D
  '--color-text-muted': '154 148 143', // #9A948F
  '--color-border': '236 230 226', // #ECE6E2
  '--color-primary': '199 16 42', // #C7102A government crimson
  '--color-link': '199 16 42',
  '--color-focus-ring': '199 16 42',

  // Bid-specific design tokens (used by the mockup-faithful components).
  '--bid-paper': '#F7F6F4',
  '--bid-paper-2': '#FBFAF9',
  '--bid-ink': '#22201E',
  '--bid-ink-2': '#33302D',
  '--bid-sub': '#57524D',
  '--bid-muted': '#8A8481',
  '--bid-muted-2': '#9A948F',
  '--bid-muted-3': '#B7ADA7',
  '--bid-border': '#ECE6E2',
  '--bid-border-2': '#DDD5D0',
  '--bid-border-3': '#D8D2CD',
  '--bid-primary': '#C7102A',
  '--bid-primary-dark': '#A3121A',
  '--bid-primary-soft': '#FBEAEA',
  '--bid-success': '#1E8E5A',
  '--bid-success-soft': '#EAF7F0',
  '--bid-warn': '#C77700',
  '--bid-warn-soft': '#FBEAEA',
  fontFamily:
    "'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  '--bid-serif': "'Noto Serif SC', 'Songti SC', 'SimSun', serif",
  // The bid workbench is a fixed warm-paper LIGHT design; it never follows the
  // global dark theme. Lock color-scheme so native controls (textarea/input/
  // scrollbars) don't invert to dark surfaces under [data-theme='dark'] — e.g.
  // the rewrite (↻) instruction box turning black.
  colorScheme: 'light',
} as CSSProperties

// Shared inline-style helpers for the mockup-faithful components.
export const bidPrimary = 'var(--bid-primary)'
export const bidInk = 'var(--bid-ink)'
export const bidSub = 'var(--bid-sub)'
export const bidBorder = 'var(--bid-border)'
export const bidPaper = 'var(--bid-paper)'
