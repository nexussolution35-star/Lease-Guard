---
version: 1
slug: "src-components-layout-applayout-tsx"
primary_target: "src/components/layout/AppLayout.tsx"
related_targets: ["src/styles/globals.css","src/components/layout/AppSidebar.tsx"]
---

# App shell surface brief

Scope: the whole signed-in LeaseGuard web app (shell, dashboard, portfolio, communications, WhatsApp, settings) plus the signed-out auth pages.
Mode: Operate. Property managers and company admins at a desk, office daylight, all day.
Job: see what needs attention, trust every figure, approve tenant messages.
Constraints: no functional change; wording kept except where too general; the original LeaseGuard blue is binding; the page name lives in the top bar, never as a visible body title; data only from the API (no invented figures).
Chosen composition: `.impeccable/mocks/decision/assigned.html` (Centre Office Logbook).
Unresolved: sequential entry numbers need a database sequence (not built); a per-property log needs an entity filter on the audit API (not built).

## Direction contract

THESIS: LeaseGuard is the property's signed logbook: every lease term, event, approval and change shows who signed it off and when. Refuses the category default of a grey sidebar over rows of identical stat cards.

OWN-WORLD: The signed logbook at a centre management office, limited to type, palette, density and one move. Deep ink-blue rail (the LeaseGuard blue, darkened) owns the shell; white work area; the original blue only on actions and selection; state colours only inside status marks. IBM Plex Sans, tabular figures. Hairline-ruled sections, no boxed cards.

STORY: The manager reads what needs attention, sees who has signed what and what still waits on them, and acts with one primary button per view.

FIRST VIEWPORT: Ink-blue rail left (brand, workspace, navigation, account at the foot); top bar with the trail; property header row with status and Edit; a figure strip led by the large open-events figure; open monitoring events with a sign-off column; units; lease-term bars drawn to scale with the notice deadline marked; details in a right rail.

FORM: Grounded candidate 7 of 7 (the logbook), seed: 7d34b1405f219881. Signature move: the sign-off mark (initials disc and date when signed, an open dashed ring when pending), used on lease verification, monitoring events, message approvals and the audit log. Raises: lease term drawn to exact scale (from the dance score); colour quarantined (from the lexicon); hierarchy by scale contrast (from the type specimen).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
