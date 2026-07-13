---
name: Mr Maths
description: Premium online mathematics tutoring platform by Issam Edris
colors:
  bg: "#ffffff"
  surface: "#f7f4ed"
  ink: "#1a1814"
  muted: "#847c70"
  primary: "#c4911d"
  primary-hover: "#ad7c14"
  primary-soft: "#efddb0"
  accent: "#1a2a4a"
  accent-hover: "#121f39"
  accent-soft: "#d4dde8"
  success: "#328f4f"
  error: "#b33a2c"
  warning: "#bd8a2e"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "clamp(2.5rem, 6vw, 4.5rem)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: -0.04
  headline:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "clamp(1.75rem, 3vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.03
  title:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.02
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "32px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.bg}"
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-accent-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.bg}"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
    border: "1.5px solid #ddd"
---

# Design System: Mr Maths

## 1. Overview

**Creative North Star: "The Gold Standard"**

A premium, confident, precise mathematics learning platform. The design treats students as capable minds — the interface is clean, authoritative, and warm without being childish. Every surface feels intentional: tight spacing, sharp typography, deliberate gold accents that signal achievement and quality.

This system explicitly rejects cartoonish edtech tropes, gamified gimmicks, and cluttered dashboards. The gold-and-navy palette carries a sense of academic rigour and earned success — the gold of a trophy, the navy of a scholar's robe.

**Key Characteristics:**
- Pure white backgrounds with warm-gold primary and deep navy accent
- Single sans-serif family (Inter) throughout — one voice, many weights
- Flat surfaces with subtle shadows on interaction only
- Earned delight — motion supports comprehension and achievement, never decoration
- Responsive grids without breakpoints, capped body width at 680px for lessons/quizzes

## 2. Colors

The palette centers on amber-gold (`oklch(0.680 0.175 91.3)`) against deep navy (`oklch(0.300 0.140 260)`) on pure white. Gold carries the brand; navy provides contrast and authority.

### Primary
- **Amber Gold** (`oklch(0.680 0.175 91.3)` / `#c4911d`): Primary buttons, logo mark, active indicators, star ratings, highlighted math answers. The gold of excellence.

### Secondary
- **Deep Navy** (`oklch(0.300 0.140 260)` / `#1a2a4a`): Accent buttons, avatar backgrounds, secondary branding. Provides visual counterweight to the gold.

### Neutral
- **Pure White** (`oklch(1.000 0 0)` / `#ffffff`): Main background. No hidden warmth.
- **Warm Surface** (`oklch(0.970 0.005 85)` / `#f7f4ed`): Card backgrounds, section alternates, subtle separation.
- **Near-Black Ink** (`oklch(0.100 0.010 80)` / `#1a1814`): Body text. Slight warmth toward the brand hue.
- **Muted** (`oklch(0.530 0.010 80)` / `#847c70`): Secondary text, metadata. Warm-leaning gray.
- **Border** (`oklch(0.880 0.008 85)` / `#e0dbd0`): Card borders, dividers, input strokes.

### Semantic
- **Success Green** (`oklch(0.600 0.155 145)`): Quiz correct answers, progress bars, completion indicators.
- **Error Red** (`oklch(0.520 0.185 30)`): Quiz incorrect answers, validation errors.
- **Warning Amber** (`oklch(0.720 0.140 85)`): Warning states, near-warmth.

### Named Rules
**The Gold-Is-Rare Rule.** Gold appears on ≤30% of any surface. Its scarcity is the point — it marks achievement, action, and emphasis. Never tint the background gold.

**The Helmkohl Rule.** White text on all saturated fills (gold buttons, navy accent fills). Dark text only on pale fills (L > 0.85) or pure neutrals.

## 3. Typography

**Display & Body Font:** Inter (with system-ui, -apple-system, Segoe UI, Roboto, Noto Sans fallback)

**Character:** Inter's neutral, geometric clarity carries the brand — confident without display, precise without austerity. A single family across all roles eliminates pairing decisions and keeps the interface quiet while the content speaks.

### Hierarchy
- **Display** (800, `clamp(2.5rem, 6vw, 4.5rem)`, 1.08, -0.04em): Hero headings only. Letter-spacing never tighter than -0.04em. Text-wrap: balance.
- **Headline** (700, `clamp(1.75rem, 3vw, 2.5rem)`, 1.2, -0.03em): Section headings. Text-wrap: balance.
- **Title** (700, `1.125rem`, 1.3, -0.02em): Card titles, dashboard section titles.
- **Body** (400, `1rem`, 1.7): Prose. Capped at 65–75ch on landing page, 680px max on lesson content.
- **Label** (600, `0.8125rem`): Buttons, tags, metadata, small UI text. Tight tracking.

### Named Rules
**The One-Family Rule.** Inter everywhere. No display font pairing. No serif. The system's clarity is its personality.

## 4. Elevation

Flat by default. Cards and surfaces rest on the page with a 1px border (`#e0dbd0`) for separation. Shadows appear only as a response to state: hover lifts cards 2px with a soft shadow. The landing page hero uses radial gradient blobs for atmospheric depth, not shadows.

### Shadow Vocabulary
- **Hover Lift** (`box-shadow: 0 2px 6px oklch(0 0 0 / 0.06), 0 4px 12px oklch(0 0 0 / 0.08)`): Interactive card hover states.
- **Featured Lift** (`box-shadow: 0 4px 16px oklch(0 0 0 / 0.08), 0 8px 32px oklch(0 0 0 / 0.10)`): Featured pricing card, modals.

### Named Rules
**The Flat-At-Rest Rule.** Surfaces are flat by default. Shadows only appear on interaction (hover, focus, selected). A resting card never casts a shadow.

## 5. Components

### Buttons
- **Shape:** Gently rounded corners (8px). No pill shapes.
- **Primary (Gold):** Background `var(--primary)`, white text, 12px 24px padding. Hover: darkens to `var(--primary-hover)`, lifts 1px, adds shadow. Transition: 0.2s ease.
- **Accent (Navy):** Background `var(--accent)`, white text. Same shape and behavior as primary.
- **Outline:** 1.5px `var(--border)` stroke, transparent background. Hover: gold border, gold text.
- **Ghost:** Muted text, no border. Hover: surface background.
- **Sizes:** `btn-lg` (14px 32px), default (12px 24px), `btn-sm` (8px 16px).

### Cards
- **Style:** `var(--surface)` background, 1px `var(--border)` stroke, 12px radius. No shadow at rest.
- **Hover:** Border shifts toward `var(--primary-soft)`, 2px translateY lift, hover shadow applied.
- **Lesson cards:** Optional left border for state (3px success = completed, 3px primary = in-progress).
- **Internal Padding:** 24px (32px on feature cards).

### Inputs (form fields)
- **Style:** No fill (transparent inside), 1.5px `var(--border)` stroke, 8px radius. Not yet built — placeholder for evolution.

### Navigation
- **Style:** Fixed top bar, 64px height, `oklch(1 0 0 / 0.85)` background with 12px backdrop-blur. 1px bottom border. Logo left, links center-right, CTAs rightmost.
- **States:** Links are `var(--muted)`, hover to `var(--ink)`. No underlines.
- **Mobile:** Links collapse, CTAs remain visible.

### Quiz Components
- **Option:** 1.5px `var(--border)` stroke, 8px radius, 16px 20px padding. Selected: gold border + soft gold fill. Correct: green border + soft green fill. Incorrect: red border + soft red fill.
- **Progress Bar:** 6px height, `var(--border)` track, `var(--primary)` fill, 99px border-radius.

## 6. Do's and Don'ts

### Do:
- **Do** use pure white (`#ffffff`) backgrounds. The gold accent is the brand carrier.
- **Do** keep body text at WCAG 4.5:1 minimum — ink is `#1a1814` against `#ffffff` (12.7:1).
- **Do** use white text on all saturated gold and navy fills.
- **Do** cap lesson/quiz content at 680px for comfortable reading.
- **Do** use `text-wrap: balance` on headings h1–h3.
- **Do** apply hover feedback on interactive cards (shadow, lift, border shift).
- **Do** use the semantic semantic tokens for quiz feedback: green for correct, red for incorrect.

### Don't:
- **Don't** use childish or cartoonish design elements. No mascots, no bright primaries (red, blue, yellow), no gamification gimmicks.
- **Don't** use gradient text (`background-clip: text`). Emphasis via weight or size only.
- **Don't** use glassmorphism as default. No decorative blurs.
- **Don't** add side-stripe borders (border-left greater than 1px as accent).
- **Don't** animate `<img>` elements on hover. Animate the container (background, border, shadow).
- **Don't** use display fonts in UI labels, buttons, or data.
- **Don't** add numbered section markers (01/02/03) as default scaffolding — only use when the order carries real information.
- **Don't** overlap visual identity with the old — not navy-cream-orange, not SaaS-cliché metric-hero-template.
