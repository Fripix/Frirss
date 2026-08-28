# Changelog

All notable changes to FriRSS. Each entry is a summary — the full notes for a
release live on its [release page](https://github.com/Fripix/Frirss/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
FriRSS follows [semantic versioning](https://semver.org/).

## [1.4.3] — 2026-08-28

### Added

- **Encrypted backup and restore.** One downloadable file holds everything
  FriRSS knows about itself — accounts and password hashes, servers and their
  tokens, preferences, instance settings — behind a mandatory passphrase of 12
  characters minimum. Restorable from *Preferences → Administration* or from the
  first-run screen, which makes it a migration tool as well as a backup. Article
  content is not included: it lives in FreshRSS.
- **FreshRSS server management in *Preferences → Feeds*.** Adding, renaming,
  setting a default, deleting and switching now all live on a screen reachable
  in every configuration. The top bar stays a selector; its `+` and its
  right-click lead there. Hiding the top bar used to make server management —
  and switching itself — unreachable, and renaming, setting a default and
  deleting simply did not exist in the iOS PWA, for want of a right-click.
- **Per-server master token.** It is configured and tested from any server's
  row, without having to switch to that server first.

### Changed

- The Preferences panel no longer rebuilds on every section change. Feeds and
  Administration paid a full network round trip, blank screen included, on every
  visit.
- Administration's five unrelated groups are legible at a glance. Their headings
  were the smallest, palest text on the page — a heading quieter than its own
  content titles nothing.
- The first-run screen puts the administrator note and the restore link on a
  readable surface instead of floating them over the background animation.
- 25 dead translation keys removed across the nine locales, and two counters
  given real plural forms — Polish and Ukrainian were receiving a French-shaped
  `user(s)` where their grammar asks for four forms.

### Fixed

- **Signing back in after a restore works the first time.** The restore armed a
  1.5 s deferred logout that no unmount cancelled; since clearing the sessions
  returns you to the login screen well within that delay, a quick sign-in was
  destroyed by the stale timer. It took two or three attempts.
- **Login errors no longer lie.** Every failure — rate limit, server error,
  dropped connection — announced "incorrect credentials", which sent you
  retyping a password that was right all along. Only an authentication refusal
  says so now.
- Restoring onto an already-configured instance says exactly that, instead of
  "The operation failed. Try again." — advice that could not work, since
  retrying produced the same refusal.
- The restore form is readable everywhere. It borrowed the Administration
  panel's light palette even on the dark login screen: near-black text on
  near-black, white borders.
- The file picker reads as one control that carries its state, instead of an
  empty input with the chosen filename detached beside it.
- Checking a backup shows that it is working, and the preview that unfolds below
  announces itself rather than appearing unnoticed.

### Security

- Alpine packages are upgraded when the image is built. The base image is
  rebuilt on its own schedule, so it was shipping openssl 3.5.7-r0 with ten
  fixable advisories against it; the production stage now pulls the patched
  3.5.8-r0 from the branch the base already pins.

## [1.4.2] — 2026-08-22

### Added

- **Refresh actually refreshes.** The button asked FreshRSS to re-read its own
  database; it now asks FreshRSS to go and collect new articles. Optional —
  it needs your FreshRSS master authentication token, and without one the
  button behaves as before. Read the warning in the setting before enabling it:
  that token also grants password-free access to your articles, and FreshRSS
  only accepts the call as a GET, so it appears in your server's access logs.

### Changed

- **Preferences rebuilt.** Ten horizontal tabs became five sections plus
  Administration in a vertical navigation, so the panel's width no longer
  depends on how many sections exist. Language moved to General, where people
  look for it; Colours, Sizes and Themes merged into Appearance; keyboard
  shortcuts joined General. A live preview above the theme settings recomposes
  as you change colours and sizes.
- **Phone and tablet support for the Preferences panel**, which had none: a
  two-level navigation, safe areas for the notch and home indicator, 44 pt touch
  targets, and colour highlighting that responds to a tap — it fired on hover
  only, so it had never worked on a touch device.
- `Preferences.tsx` went from 3 012 lines to 278 across seven focused files. A
  test freezes an inventory of 232 settings and fails the build if any of them
  becomes unreachable.

### Fixed

- Toggle switches rendered as vertical ovals on touch.
- The colour highlight dimmed the Preferences panel and the highlighted element
  along with everything else.
- Each colour's reset control was invisible until hovered.
- The Escape key cap reads `ESC` in every language.
- Built-in gesture labels no longer wrap onto two lines.

## [1.4.1] — 2026-08-20

### Fixed

- **The operator scripts were missing from the container image.**
  `scripts/backup-db.js` and `scripts/reset-password.js` were documented but
  never shipped, so both failed with `MODULE_NOT_FOUND`. This matters for
  recovery: a backup tool is only useful if it is in the image you run.

## [1.4.0] — 2026-08-20

### Added

- **Grid view** — a third layout beside *list only* and *list + reading pane*:
  a full-width gallery of cards, two to five columns with the window width,
  uniform 16:9 thumbnails, and a full-screen reader on click. Settable per feed,
  so a visual feed can stay a grid while everything else stays a list.
- **YouTube videos play in place**, behind a click-to-load facade — nothing
  reaches YouTube until you press play. Videos embedded in blog posts reappear:
  the HTML sanitiser had been deleting them outright.
- **Offline images.** Choose how much to keep (Light / Standard / Maximum),
  see the space used, empty it in one click. Prefetching had never worked
  before — images were fetched but never stored, and cross-origin requests were
  blocked by the app's own security policy.
- **Offline actions are kept.** Reading, starring or saving for later while
  offline was silently undone; those actions are now queued and replayed when
  the network returns. A refusal from the server is still rolled back — only a
  missing network is queued.
- **Categories for saved articles**, filed by holding the star or clock, or by
  dragging an article onto a category. They are ordinary tags, so FreshRSS and
  your other clients see them too.
- **Focus mode** (the reading pane fills the screen), **search scoped to the
  current view** instead of always searching everything, an *X new articles*
  banner after a refresh, and **right-to-left content** rendered in its own
  direction whatever the interface language.

### Fixed

- **Open site** opened the raw XML feed instead of the website, for feeds that
  point at themselves.
- The **search shortcut** did nothing: it targeted an input that only exists
  once search is already open.
- **Logging out did not end the server session** — a token captured beforehand
  stayed valid until it expired.

## [1.3.4] — 2026-08-15

### Added

- **Aggregated category view** — clicking a category name reads the articles
  from all its feeds at once.
- **SSO-only mode**: when OIDC is enabled, the local username/password form can
  be hidden. A break-glass `?local=1` URL always reaches it, so an administrator
  is never locked out if the identity provider is unavailable. The Admin panel
  shows the OIDC callback URL to whitelist.
- An optional confirmation-free **Mark all as read**, and a new General
  preferences tab.

### Changed

- **Faster, clearer startup**: the sidebar paints instantly from the offline
  snapshot instead of showing a blank list on a cold start, with a progress bar
  while feeds revalidate and an "Updating…" overlay instead of a silent reload.
- On/off options use consistent slide toggles.

## [1.3.3] — 2026-08-13

### Added

- **Instant feed opening** — the first page of unread feeds is prefetched in the
  background after load (capped, throttled, skipped on data-saver or slow
  connections), plus a prefetch on hover or touch.

### Fixed

- A read article reappeared as unread on returning to the list; the read state
  now propagates to the in-memory and offline caches.
- A feed's unread count holds at 0 through FreshRSS's eventually-consistent
  count instead of briefly re-showing a phantom "1 unread".

## [1.3.2] — 2026-08-11

### Security

- **Proxy SSRF guard hardened** — `/api/proxy` rejects targets that *resolve* to
  a private or loopback address, defeating DNS tricks such as `10.x.x.x.nip.io`,
  and re-checks every redirect hop; the FreshRSS token is stripped on
  cross-origin redirects.
- **Security headers on the app page** from nginx: a Content-Security-Policy
  (`script-src 'self'`), `X-Frame-Options`, `X-Content-Type-Options: nosniff`
  and `Referrer-Policy`.
- **JWT verification pinned to HS256.**
- **The bundled npm was removed from the runtime image.** It is never used at
  runtime, and its own dependencies were the source of most reported CVEs.
- dompurify bumped to 3.4.13 (moderate XSS advisory).

## [1.3.1] — 2026-08-10

### Security

- **Removed the unauthenticated `/cors-proxy` nginx endpoint** — an open proxy
  with no SSRF guard, able to reach internal hosts or act as an open relay. The
  client already used the authenticated, guarded `/api/proxy`, so this was dead
  config. Updating is recommended if your instance is publicly reachable.
  Reported by @spencerwongfeilong (#5).

### Fixed

- `tzdata` added to the image, so the `TZ` variable is honoured on Alpine
  instead of silently falling back to UTC. Thanks @spencerwongfeilong.

## [1.3.0] — 2026-08-01

### Added

- FriRSS **follows the browser language** on first run instead of always
  starting in French (#1).
- **Hide feeds with no unread articles** — a sidebar toggle that syncs with your
  account (#4).
- **Multi-arch images**: `:latest` and version tags ship amd64 and arm64, so
  FriRSS runs on a Raspberry Pi with a 64-bit OS (#2).

---

Releases before 1.3.0 are listed on the
[releases page](https://github.com/Fripix/Frirss/releases).

[1.4.3]: https://github.com/Fripix/Frirss/releases/tag/v1.4.3
[1.4.2]: https://github.com/Fripix/Frirss/releases/tag/v1.4.2
[1.4.1]: https://github.com/Fripix/Frirss/releases/tag/v1.4.1
[1.4.0]: https://github.com/Fripix/Frirss/releases/tag/v1.4.0
[1.3.4]: https://github.com/Fripix/Frirss/releases/tag/v1.3.4
[1.3.3]: https://github.com/Fripix/Frirss/releases/tag/v1.3.3
[1.3.2]: https://github.com/Fripix/Frirss/releases/tag/v1.3.2
[1.3.1]: https://github.com/Fripix/Frirss/releases/tag/v1.3.1
[1.3.0]: https://github.com/Fripix/Frirss/releases/tag/v1.3.0
