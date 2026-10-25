# Interface conventions

SiteQuote is a light-theme, portrait, phone-first application. `src/config/theme.ts` is the source of truth for colors, typography, spacing, radii and minimum touch targets. Reuse `AppScreen`, `AppText`, `AppField`, `AppCard` and `AppButton` when extending screens.

## Navigation

Signed-out routes provide Welcome, Sign Up, Verify email and Log In. Verified users enter Dashboard, Leads, Reminders and Settings tabs. Projects open from lead detail or Dashboard filters; task, photo, estimate, quote and decision workflows sit under project detail.

A session-status overlay hides navigation during restoration. Errors offer retry; private results must not remain visible after account scope changes.

## Interaction

- Display field labels, inline validation, loading/empty states and recoverable errors. Retain form input after failed saves and prevent duplicate submissions.
- Use explicit confirmation for deleting records, marking delivery, changing project decisions and reopening.
- Label working estimate, Prepared quote, Latest sent quote and Accepted quote distinctly.
- Disable closed-project financial edits while keeping permitted actions available.
- Show device-alert failures separately from successful reminder persistence.
- Group photos by exact project/task association; label staged images as unsaved until metadata is confirmed.
- Show status in text as well as color, support wrapping and safe areas, and maintain at least 44-point touch targets.

Device validation must cover large text, screen-reader order, keyboard behavior, narrow screens and contrast; code conventions alone do not establish accessibility conformance.
