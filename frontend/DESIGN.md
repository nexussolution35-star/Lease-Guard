---
name: LeaseGuard
description: The property's signed logbook. Commercial lease monitoring and tenant communication for South African property managers.
colors:
  primary: "oklch(0.42 0.14 255)"
  primary-foreground: "oklch(0.99 0 0)"
  ring: "oklch(0.55 0.15 255)"
  rail: "oklch(0.3 0.085 255)"
  rail-raised: "oklch(0.39 0.1 255)"
  rail-foreground: "oklch(0.97 0.008 255)"
  rail-muted-foreground: "oklch(0.8 0.035 255)"
  rail-primary: "oklch(0.86 0.07 255)"
  rail-ring: "oklch(0.82 0.09 255)"
  rail-border: "oklch(1 0 0 / 0.12)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.2 0.02 255)"
  muted: "oklch(0.955 0.005 250)"
  muted-foreground: "oklch(0.5 0.02 255)"
  border: "oklch(0.9 0.006 250)"
  secondary: "oklch(0.94 0.01 250)"
  accent: "oklch(0.93 0.03 255)"
  destructive: "oklch(0.55 0.2 25)"
  success: "oklch(0.6 0.15 150)"
  warning: "oklch(0.75 0.16 75)"
  info: "oklch(0.6 0.12 240)"
typography:
  lead-figure:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.625rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  figure:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "tnum"
  title:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  helper:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
  wordmark:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
  full: "9999px"
spacing:
  cell-x: "12px"
  cell-y: "10px"
  section-inner: "12px"
  stack: "24px"
  section-gap: "40px"
  gutter-mobile: "16px"
  gutter-tablet: "24px"
  gutter-desktop: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost:
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.accent}"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  rail:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-foreground}"
    width: "240px"
  rail-collapsed:
    width: "56px"
  rail-nav-item:
    textColor: "{colors.rail-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "32px"
  rail-nav-item-active:
    backgroundColor: "{colors.rail-raised}"
    textColor: "{colors.rail-foreground}"
  topbar:
    backgroundColor: "{colors.background}"
    height: "56px"
  metric-cell:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.figure}"
    padding: "16px 20px"
  metric-cell-lead:
    typography: "{typography.lead-figure}"
  table-head:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
    height: "36px"
    padding: "0 12px"
  table-cell:
    typography: "{typography.body}"
    padding: "10px 12px"
  sign-off-disc:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    size: "20px"
---

# Design System: LeaseGuard

## Overview

**Creative North Star: "The Centre Office Logbook"**

LeaseGuard is the signed logbook kept at a centre management office: every lease term, monitoring event, message approval and change shows who signed it off and when, and what still waits on a person. The system is deliberately limited to type, palette, density and one signature move. A deep ink-blue rail (the LeaseGuard blue, darkened) owns the shell; the work area is plain white; the original blue appears only on actions and selection; state colours live only inside status marks.

Density is office density: a property manager at a desk in daylight, all day, reading figures they must trust. Sections are ruled with hairlines rather than boxed, figures are tabular, and hierarchy comes from scale contrast (one large lead figure per strip) rather than from colour or weight piling. Motion is quiet: one easing curve, short durations, no decorative animation.

The system refuses the category default of a grey sidebar over rows of identical stat cards.

**Key Characteristics:**
- Ink-blue rail shell, white work area, LeaseGuard blue reserved for actions and selection.
- IBM Plex Sans throughout, tabular figures in every table, date and amount.
- Hairline-ruled sections and stat strips; no card per record.
- The sign-off mark (initials disc and date, or an open dashed ring when pending) as the recurring signature.
- Status as a dot plus text, never a pill.
- The page name lives in the top bar; the body never repeats it as a visible title.
- Lease terms drawn to exact scale, with the renewal-notice deadline marked.

## Colors

One blue family carries the whole identity: the binding LeaseGuard blue for action, its ink-dark sibling for the shell, and cool near-neutrals for everything else. State hues are quarantined to small marks.

### Primary
- **LeaseGuard Blue** (`primary`): the binding brand colour. Primary buttons, links, the brand mark on light pages, selection tint (`::selection` at 22% mix), form `accent-color` and the text caret. Nothing decorative.
- **Focus Blue** (`ring`): focus rings, always at 50% alpha in a 3px ring.

### Secondary
- **Logbook Ink** (`rail`): the LeaseGuard blue darkened to ink; the sidebar ground and nothing else.
- **Raised Ink** (`rail-raised`): one surface step up inside the rail; the active navigation row and rail hovers.
- **Rail Paper** (`rail-foreground`), **Rail Pencil** (`rail-muted-foreground`), **Rail Blue** (`rail-primary`), **Rail Focus** (`rail-ring`), **Rail Rule** (`rail-border`): the semantic tokens as redefined inside the `.rail` scope so nested components read on ink without their own variants.

### Tertiary (state colours, quarantined)
- **Ledger Red** (`destructive`): danger dots, destructive buttons, and a non-zero danger figure (the only figure ever coloured).
- **Settled Green** (`success`), **Notice Amber** (`warning`), **Note Blue** (`info`): status dots, the pending sign-off ring, the awaiting-approval ring, and the renewal-notice tick on lease-term bars.

### Neutral
- **Office White** (`background`): the work area, top bar, metric cells.
- **Ink Text** (`foreground`): body text and figures; a cool, slightly blue near-black.
- **Pencil Grey** (`muted-foreground`): labels, helper text, table heads, dates beside a sign-off.
- **Hairline** (`border`): every rule, frame and divider.
- **Ledger Tint** (`muted`), **Quiet Fill** (`secondary`), **Blue Wash** (`accent`): row hover, skeletons, ghost and outline hovers.

Dark theme (via `data-theme="dark"` or the system preference): background `oklch(0.17 0.015 255)`, foreground `oklch(0.95 0.005 250)`, card `oklch(0.22 0.015 255)`, border `oklch(0.32 0.015 255)`, primary lifts to `oklch(0.7 0.13 255)`, rail deepens to `oklch(0.21 0.04 255)` with raised `oklch(0.3 0.06 255)`.

### Named Rules
**The Binding Blue Rule.** `--primary` is the original LeaseGuard blue and is not to be retuned, re-hued or replaced. The owner has reverted palette changes twice.

**The Quarantine Rule.** State colours appear only inside status marks (dots, rings, ticks). Text stays foreground; only a non-zero danger figure takes colour, because amber on white is too faint to read as text.

**The One Ground Rule.** Ink belongs to the rail. The work area is white; never put ink-blue panels in page content.

## Typography

**Display Font:** IBM Plex Sans (with ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto fallback)
**Body Font:** IBM Plex Sans
**Label Font:** IBM Plex Sans

Self-hosted variable woff2 (weights 100 to 700, roman and italic, latin and latin-ext subsets) from `public/fonts`, `font-display: swap`.

**Character:** one engineered grotesque doing every job, so hierarchy has to come from size and spacing. Plex's tabular figures make rand amounts, dates and counts line up like a ledger.

### Hierarchy
- **Lead figure** (600, 2.625rem, line-height 1, -0.02em, tabular): the one figure that matters on a screen, the first cell of a stat strip. One per strip.
- **Figure** (500, 1.5rem, line-height 1, tabular): the other cells of a stat strip.
- **Title** (500, 1rem): section headings (`h2`); `h3` and rail section headings drop to 0.875rem.
- **Body** (400, 0.875rem): table cells, details, navigation, buttons. Inputs use 1rem on phones (no zoom) and 0.875rem from `md`.
- **Label** (500 or 400, 0.75rem, Pencil Grey): table heads, metric labels, figure captions, axis years.
- **Helper** (400 italic, 0.75rem, Pencil Grey): field descriptions, form-section notes, settings-row descriptions.
- **Wordmark** (600, 15px): the LeaseGuard name beside the mark.

### Named Rules
**The Ledger Figures Rule.** Every table is `tabular-nums` by default; any amount, date or count outside a table carries `tabular-nums` explicitly.

**The Scale Not Weight Rule.** Hierarchy comes from the lead figure's size against quiet 0.875rem body. No headings above 1rem in the page body, and no visible page title (it lives in the top bar; the `h1` is screen-reader only).

**The Italic Helper Rule.** Helper text under fields and settings is always 0.75rem italic in Pencil Grey. This is deliberate and consistent; do not mix in upright helper text.

## Layout

The shell is a two-column frame: the sticky full-height rail (240px, collapsing to a 56px icon rail; a drawer on phones) and the work column. The work column has a sticky 56px top bar (mobile menu button, the route trail, notifications, account) and the main region, capped at 1536px, with gutters of 16px on phones, 24px from `md` and 32px from `lg`, 24px top and 48px bottom padding.

Detail screens use a work column plus a right details rail (18rem at `lg`, 20rem at `xl`), separated by a hairline left rule with 32px of padding. DOM order is phone order: figures, details, then the work; from `lg` the details move into the rail.

Rhythm: 40px between sections in the work column, 12px between a section header and its content, 24px below the page header row. Table cells sit at 12px by 10px under 36px heads. Breakpoints are Tailwind's defaults (`sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px). Touch targets in the mobile drawer grow to 40px.

**The One Action Rule.** Each view has exactly one primary (filled blue) button; every other action is outline or ghost.

**The Hidden Scrollbar Rule.** Scrollbars are always hidden (`scrollbar-width: none` and `*::-webkit-scrollbar { display: none }`); content still scrolls by wheel, touch and keyboard.

## Elevation & Depth

The page is flat. Depth in the work area comes from hairlines and the single tonal step between rail and raised rail; nothing at rest casts a shadow. Shadows exist only on things that float above the page: menus, popovers and selects take the medium shadow, dialogs and sheets the large one. The active rail item carries a 1px inset top highlight to read as raised ink.

### Shadow Vocabulary
- **Overlay** (`shadow-md`): dropdown menus, popovers, select lists.
- **Modal** (`shadow-lg`): dialogs, alert dialogs, sheets, submenus.
- **Raised ink** (`box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.08)`): the active navigation row in the rail only.

### Named Rules
**The Flat Page Rule.** No shadows on page content. If something must read as separate, rule it with a hairline.

## Shapes

Gently rounded and restrained: a 6px base radius (`--radius: 0.375rem`) for buttons, inputs and nav rows, 4px for small parts, and 10px for any frame (stat strips, document lists, the conversations inbox, dialogs). `--radius-xl` is pinned to the same 10px: nothing is rounder than a container. Circles are reserved for marks: status dots (6px), the approval ring (8px), the sign-off disc (20px), lease-term bars (fully rounded 6px-tall rules).

Borders are 1px hairlines in `border`. Lines of related records are divided by hairline rules (`divide-y`, often with a top and bottom rule), not boxed one per item. The brand mark is a stroked monogram: an L ruled inside a rounded square, 1.5px stroke.

## Components

### Buttons
Plain and confident; one filled button per view.
- **Shape:** 6px radius, 36px default height (32px small, 40px large, square icon sizes).
- **Primary:** LeaseGuard Blue fill, near-white text, 0.875rem medium; hover at 90% fill. Disabled turns muted grey rather than fading.
- **Hover / Focus:** 150ms colour transitions on the shared curve; a 3px Focus Blue ring at 50%; press scales to 0.98.
- **Outline:** hairline border on white, Blue Wash on hover. The default for secondary actions (Archive, Restore).
- **Ghost:** no frame, Blue Wash on hover; icon buttons in the top bar.
- **Link:** blue text, underline on hover.

### Status marks
- **Style:** a 6px solid dot in the tone's colour, then the status in foreground text at 0.875rem, 20px row height. Neutral status text drops to Pencil Grey.
- **Awaiting approval:** an open 8px amber ring replaces the dot, used only for records waiting on a person's approval.
- Priority and verification labels share the same dot-or-icon plus text layout. No pills.

### Stat strip (metric grid)
- **Frame:** one 10px hairline frame; cells divided by 1px hairlines in the gap, so an unfilled last row stays plain.
- **Cells:** white, 20px by 16px padding; label in 0.75rem Pencil Grey led by a tone dot when not neutral; figure below.
- **Lead:** the first cell may be the lead figure, which gets a 1.4fr column at the widest breakpoint.
- **Interactive cells:** Ledger Tint on hover, inset focus ring.

### Tables
- **Head:** 36px, 0.75rem medium Pencil Grey, no fill.
- **Rows:** hairline dividers at 60% border, Ledger Tint on hover and when expanded, tabular figures.

### Inputs / Fields
- **Style:** 1px hairline, transparent ground, 6px radius, 36px height, 12px side padding; the border darkens slightly on hover.
- **Focus:** border turns Focus Blue with a 3px ring at 50%.
- **Error / Disabled:** destructive border and faint red ring; disabled at 50% opacity. Helper text sits below in italic Pencil Grey.

### Navigation
- **Rail:** Logbook Ink ground, brand and workspace switcher at the top, navigation in the middle, account and collapse at the foot.
- **Items:** 32px rows (40px in the mobile drawer), 6px radius, 16px Lucide icons in Rail Pencil, label at 85% Rail Paper.
- **Hover:** Raised Ink at 50%. **Active:** Raised Ink fill, medium weight, full-strength icon and text, and the inset top highlight.
- **Collapsed:** icon only, labels move to tooltips on the right.
- **Top bar:** white with a bottom hairline; carries the page name and route trail.

### Sign-off mark (signature)
The logbook's signature, used on lease verification, monitoring events, message approvals and the audit log.
- **Signed:** a 20px hairline-ringed disc with the signer's initials, then the name and, after a mid-dot, the date in Pencil Grey (`dd MMM yyyy`, tabular).
- **Pending:** an open 20px dashed ring in Notice Amber (1.5px), then the pending text ("Sign-off pending" by default) in Pencil Grey.
- Anything waiting on a person must read the same way everywhere; use this mark, not a new one.

### Lease-term bars (signature)
Lease terms drawn to exact scale on one shared axis.
- Each row: reference (6rem), the bar track (a hairline with a 6px rounded bar at 45% Pencil Grey sized to the exact term), and the dates as text (13rem column from `sm`).
- An amber 2px tick marks the last day for renewal notice; a 1px foreground hairline at 60% marks today.
- Year labels below the axis (thinned to about four on phones) and a caption legend stating "Drawn to scale". The text carries the same facts for screen readers.

## Do's and Don'ts

### Do:
- **Do** use `--primary` (the original LeaseGuard blue) for actions and selection only, and keep its value unchanged.
- **Do** keep ink-blue (`--rail`) to the sidebar; nest rail content inside the `.rail` scope so tokens remap automatically.
- **Do** show status as a 6px dot plus text, and anything awaiting a person with the sign-off mark or the open approval ring.
- **Do** give each view exactly one primary button; everything else is outline or ghost.
- **Do** rule sections and lists with 1px hairlines and group a strip of figures in one 10px frame.
- **Do** lead a stat strip with one lead figure (2.625rem semibold) when one number matters most.
- **Do** set all figures tabular and format dates `dd MMM yyyy` (en-ZA) and amounts in ZAR.
- **Do** write helper text in 0.75rem italic Pencil Grey, consistently.
- **Do** keep scrollbars hidden everywhere (`scrollbar-width: none` and `*::-webkit-scrollbar { display: none }`).
- **Do** use the shared `cubic-bezier(0.22, 1, 0.36, 1)` curve at about 160ms, and honour reduced motion.
- **Do** show only figures that come from the API; show a dash or an empty state when there is no data.

### Don't:
- **Don't** put a visible page title in the page body; the page name lives in the top bar.
- **Don't** use pill badges for status.
- **Don't** colour text with state hues, except a non-zero danger figure.
- **Don't** box each record or each figure in its own card, and don't build rows of identical stat cards.
- **Don't** add shadows to page content; shadows are for menus, popovers, dialogs and sheets.
- **Don't** make anything rounder than its container (10px maximum on frames).
- **Don't** invent figures, sample data, testimonials or sequential entry numbers; entry numbers and a per-property log are not built because the data does not support them yet.
- **Don't** show visible scrollbars.
