# Neryungri AI City design direction

Antislop mode: during, explicitly selected by the user.
Direction status: user requested an original logo and an Apple-informed interface on 10 October 2026. This supersedes the earlier provisional visual direction.

Design Read: municipal dispatch workspace, with a quiet silver/graphite interface, original N route mark, content-led panes and deliberate typography. ENERGY 1 / RHYTHM 1 / MOTION 1.

## Current visual system, 10 October 2026

The Apple references are principles, not copied assets or an Apple product layout:

- https://developer.apple.com/design/human-interface-guidelines/app-icons: one recognisable idea and a small number of shapes. The original N route has a blue endpoint. It represents the city name and locating an appeal. No Apple logo or SF Symbols assets are bundled.
- https://developer.apple.com/design/human-interface-guidelines/layout: familiar relationships, consistent spacing and adaptation to window size. Map controls sit in one map toolbar; reports remain an adjacent evidence pane.
- https://developer.apple.com/design/human-interface-guidelines/design-principles: consistency, recoverability and preserving context. Existing drafts, statuses and map zoom protection remain intact.
- https://developer.apple.com/design/tips/: legibility, alignment and controls near their content. Report copy remains 17 px on desktop, headings 30–34 px, all main actions remain reachable by keyboard.

The ui-ux-pro-max design-system search was tried twice. Both returned marketing-page structures inappropriate for this application. Those structures, font pairs and conversion CTAs were rejected. The implementation uses the skill's general accessibility rules and the primary Apple references above, not an invented database match.

The single active stylesheet is static/design.css. static/styles.css is the previous version, retained as a local visual fallback, not loaded. Tokens cover both light and dark appearances.

- Silver/white surfaces keep geographic detail and report content prominent; graphite replaces the heavy navy sidebar. Blue is reserved for actions and selection. Red/amber remain semantic urgency colours.
- The logo is a native SVG: graphite app icon with a white N route and blue endpoint. The monochrome mark is supplied separately for documents and small print.
- System typography uses the device font with Segoe UI on Windows; no Apple font downloads or remote font dependency. Weight and size, not decoration, create hierarchy.
- A 4/8px spacing rhythm aligns forms and panes. The unboxed number strip avoids turning every count into a floating card.
- 18px pane corners separate the two working surfaces; 10px controls and round dismiss controls have distinct roles. Shadows only separate modal sheets and small map controls from content.
- The original report-reference motif is retained; navigation uses map, list and chart symbols with direct functional meanings.
- Light/dark preference initially follows the OS; a working switch persists the person's explicit choice. The geographic basemap retains its provider rendering for geographic legibility; its own controls stay white with dark text.
- No decorative page animation. Hover/press feedback uses 160ms, and reduced-motion removes transitions.
- Mobile replaces the sidebar with a compact brand/navigation header, stacks map and list, retains 44px touch targets and expandable analytical rows.

## Earlier implementation notes (superseded where inconsistent above)

- White surfaces and graphite text support long reading sessions; deep blue marks the active view and the primary action.
- Red and amber are reserved for urgency, always accompanied by a text label or a map legend. Blue means ordinary priority, not a safety guarantee.
- The map is the focal point. A narrow report list shares selection with map markers so a user can move between location and description.
- The navigation holds exactly three working views: map, report registry, and analysis. No promotional landing page is needed for the task.
- Segoe UI is installed on the target Windows computer and has readable Cyrillic, so the interface does not depend on font downloads.
- Spacing follows an 8px rhythm. Borders separate data regions; repeated floating cards would weaken the list/map relationship.
- Small corner radii distinguish controls from the rectangular map. Status labels are plain compact labels, not ornamental pills.
- Text-only product identity avoids inventing an unapproved logo. Simple functional map/list/chart glyphs describe navigation; there are no people, decorative illustrations or generated assets.
- Report references such as Д-001 repeat across list, detail and map, giving the workspace a cartographic index motif.
- Motion is limited to short focus/hover and panel transitions. Reduced motion disables movement; there are no decorative animations.
- The selected dataset is always named. Counts come from actual stored records in that dataset, and the fictional nature of the educational records stays visible.

Mobile: navigation becomes a compact horizontal bar, the map precedes its list, dialogs fit the viewport and fields stack. All principal controls have a minimum 44px target.

Workflow revision: a fixed dialog footer keeps Save reachable while the body scrolls. Native
details sections fold explanation, relations, photos and history so the edit form stays first.
Assignment and due date share one desktop row because they describe the same work commitment.
On phones, sector and backtest tables become expandable rows with 16px text, retaining the
same values without shrinking columns. Analytics starts with open/overdue/recurrent problems
and a short work queue; forecast methodology follows operational decisions. The map mode is
placed directly above the map, keeping the report list's accounting explicit. Existing blue,
neutral surfaces, reference-number motif and ENERGY 1 / RHYTHM 1 / MOTION 1 are retained.

Problem tracking: relation controls live inside the existing report detail, beside the source text, so staff can review evidence before linking. No extra navigation is required. Plain tables compare message and problem counts by analytical sector; the same text and surface tokens preserve hierarchy and contrast. Native selects, explicit labels, local errors and a reversible unlink action support keyboard work. The backtest table exposes predictions and actuals rather than displaying an unsupported accuracy badge. Existing ENERGY 1 / RHYTHM 1 / MOTION 1 and draft direction remain unchanged.

Desktop readability adjustment requested by the user: content and controls use 16px, report text uses 17px with 1.6 line height, and supporting labels use at least 14px. The sidebar, report list and detail dialog are wider to accommodate the type. Filters and headings wrap when needed; analytics stacks below 1200px rather than shrinking text. The mobile scale below 721px is retained.

Yandex migration (requested by the user): the map uses JS API 2.1 with Russian labels. The provider's attribution remains unobstructed; the priority legend occupies its own row below the map. Missing-key and loading-error states explain the next action and retain access to the report list. Help is shown only when map setup is needed. Markers are native buttons so Enter, Space, and focus restoration work without a separate keyboard simulation.

Map zoom protection: the user requested protection against accidental scaling. A labelled toggle beside map actions is active by default and disables wheel, double-click and pinch zoom. Explicit plus/minus and fit actions still work. The existing blue selected style and aria-pressed expose state; wrapping keeps the toolbar usable on narrow screens.
