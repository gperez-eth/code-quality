---
name: Static Analysis Engine
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434655'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#545f73'
  on-secondary: '#ffffff'
  secondary-container: '#d5e0f8'
  on-secondary-container: '#586377'
  tertiary: '#005a89'
  on-tertiary: '#ffffff'
  tertiary-container: '#0073ae'
  on-tertiary-container: '#e7f2ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#d8e3fb'
  secondary-fixed-dim: '#bcc7de'
  on-secondary-fixed: '#111c2d'
  on-secondary-fixed-variant: '#3c475a'
  tertiary-fixed: '#cce5ff'
  tertiary-fixed-dim: '#93ccff'
  on-tertiary-fixed: '#001d31'
  on-tertiary-fixed-variant: '#004b73'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  headline-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
  body-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
  code-body:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  code-callout:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
  stat-display:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '300'
    lineHeight: 32px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system targets software engineers, security researchers, and DevOps leads who demand high-throughput data inspection with zero visual latency. The interface prioritizes extreme density, analytical rigor, and unambiguous severity signaling over decorative whitespace.

The visual style is rooted in **Corporate / Modern Developer Tooling**:
- Structured around a hard 1px border grid reminiscent of classic code-auditing suites.
- Strict visual hierarchy separating high-level administrative command (dark top utility bar) from the operational workbench (cool slate canvas with crisp card containers).
- High visual scannability: tabular data, file tree hierarchies, annotated gutter streams, and unified metric scorecards that provide immediate comprehension of technical debt, vulnerabilities, and quality gate outcomes.

## Colors

The system uses a calibrated multi-tier color architecture engineered for high-density diagnostic screens:

### Chrome & Foundations
- **Global Header**: `#1e293b` (slate-900) deep enterprise charcoal with `#f8fafc` text for high-contrast, distraction-free global navigation.
- **Application Canvas**: `#f3f4f6` to `#f8f9fa` neutral base providing distinct contrast against pure white `#ffffff` cards and code panels.
- **Structural Borders**: Crisp `#e1e4e8` (subtle divider) and `#cbd5e1` / `#d1d5db` (panel perimeter & active boundary).

### Brand & Interactive Tones
- **Primary / Active Accent**: `#2563eb` (interactive blue) transitioning to `#1d4ed8` on hover/active states; used for active tab underlines, primary button fills, focused row boundaries, and clickable identifiers.
- **Secondary Accent**: `#0284c7` (cyan-blue) for deep-link file paths and secondary navigation tokens.

### Metric Grades & Security Severity (Sonar Semantic Standard)
- **Rating A (Clean / Pass)**: `#22c55e` (green-500)
- **Rating B (Minor Impact)**: `#84cc16` (lime-500)
- **Rating C (Major Impact)**: `#eab308` (amber-500)
- **Rating D (High Risk)**: `#ea580c` (orange-600)
- **Rating E / Quality Gate Failed**: `#dc2626` (red-600)

### Surface Tints & Differential Callouts
- **Leak Period / New Code Differential**: Warm sand tint (`#fef9c3` border with `#fefce8` background) to visually isolate diff windows.
- **Vulnerability Highlight Row**: `#fef2f2` background with `#f87171` active outline and `#991b1b` text callouts.

## Typography

Typography balances high-density information architecture with developer readability:

- **Primary UI Typeface**: `Inter` handles all navigation, meta labels, tabs, and diagnostic panels. Tight tracking (`-0.01em` on sizes 13px–15px) ensures compact row layout without truncation.
- **Monospaced Code & Tracing**: `JetBrains Mono` serves line numbers, syntax blocks, execution path callouts, token badges, and hash digests. The uniform width guarantees that line-by-line diffs and code-flow graphs retain column alignment.
- **Metric Figures**: Large metric numbers (`stat-display`, 28px) use light weight (`300`) to present high-magnitude figures gracefully without visual clutter.

## Layout & Spacing

The layout is built for maximum screen real-estate utilization on desktop displays (1280px to 1920px+):

- **Master Framework**: Fluid grid with a strict 3-tier vertical division:
  1. Fixed 48px top navigation bar (`#1e293b`).
  2. Sub-header (38px) with project breadcrumbs, analysis timestamp, and primary view tabs (`Overview`, `Issues`, `Measures`, `Code`, `Activity`).
  3. Work area divided into a collapsible facet/filter sidebar (240px–300px fixed width) and a fluid multi-column analytical canvas.
- **Density Grid**: Compact 4px base increment (`space-xs` = 4px, `space-sm` = 6px, `space-md` = 12px, `space-lg` = 16px).
- **Split-Pane Views**: Code inspection screens use fixed-width issue trace columns (320px) coupled with horizontally scrolling code viewer panes with synchronized gutters.

## Elevation & Depth

This design system avoids soft, floating, or diffuse multi-stop shadows. Depth is communicated strictly via **crisp 1px borders and functional tonal layering**:

- **Ground (Canvas)**: `#f3f4f6` serves as the neutral workspace baseline.
- **Panels & Cards**: `#ffffff` with a solid `1px solid #e1e4e8` perimeter border. Hovering actionable cards switches the border to `#94a3b8` without vertical translation.
- **Active / Selection State**: Highlighted table rows, active tree elements, or selected code line ranges gain a `2px solid #2563eb` outline or a `1px solid #bfdbfe` containment with a `#eff6ff` backdrop.
- **Overlays, Popovers & Dropdowns**: Flat `#ffffff` surface with a crisp border (`1px solid #cbd5e1`) and an ultra-tight, functional edge shadow: `0 2px 4px rgba(0, 0, 0, 0.08)`.

## Shapes

In keeping with classic enterprise developer tooling, shapes remain intentionally sharp and utilitarian:

- **Containers & Code Blocks**: `2px` border radius (`rounded-xs` to `rounded-sm`) to maximize code view area and maintain alignment with line-number gutters.
- **Buttons, Form Inputs & Badges**: `3px` to `4px` maximum radius.
- **Metric Grade Indicators**: Circular badge elements (`border-radius: 9999px`) reserved exclusively for Rating Badges (A, B, C, D, E) to make letter scores pop instantly against rectangular layout grids.

## Components

### Top Utility Navigation
- **Dimensions**: Fixed 48px height, `#1e293b` solid background.
- **Content**: Brand logo, primary platform modules (`Projects`, `Issues`, `Rules`, `Quality Gates`, `Administration`), global search bar (`#334155` background, `#f8fafc` text, 28px height, 3px radius), and compact user avatar.

### Metric Cards & Scorecards
- Flat white containers with `1px solid #e1e4e8` border.
- Divided internally by a vertical separator into "Overall Code" (left) and "New Code / Leak Period" (right, tinted `#fefce8`).
- Displays large thin statistics (28px) flanked by circular 18px rating badges (e.g., green `A`, orange `D`).

### Quality Gate Status Banner
- **Success State**: `#15803d` banner with clear checkmark.
- **Failure State**: Pill badge `#dc2626` (`Failed`) paired with an alert callout box (`#fff1f2` surface, `#fecdd3` border) detailing failing thresholds (e.g., "Coverage on New Code < 80%").

### Code Inspection Viewer
- **Line Numbers**: 44px fixed-width gutter, background `#f8fafc`, text `#94a3b8`, right-aligned monospaced 12px text.
- **Execution Flow Markers**: Step badges (`1`, `2`, `3...`) using `#dc2626` background, white text, 14px size, positioned inside the gutter to highlight step-by-step vulnerability traversal.
- **Inline Issue Callout**: Embedded directly beneath offending line; card styled with `#fef2f2` background, `1px solid #f87171` border, displaying issue title, severity icon, remediation cost, and resolution action triggers.

### Filter / Facet Sidebar
- Collapsible accordions with caret indicators.
- Category headers in 11px uppercase bold (`#64748b`).
- Selectable rows showing checkbox, label, and right-aligned count token (`#f1f5f9` badge).

### Buttons & Inputs
- **Primary Button**: `#2563eb` fill, `#ffffff` text, 28px–32px height, 3px radius, no drop shadow.
- **Secondary / Default Button**: `#ffffff` background, `1px solid #cbd5e1` border, `#334155` text.
- **Inputs**: 30px height, `#ffffff` surface, `1px solid #cbd5e1` border, focusing to `1px solid #2563eb` with a 1px ring.
