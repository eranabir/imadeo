# Where the mobile app is, mid-migration

Written 8 August 2026, at the point the work moved from a Windows machine to a
Mac. Branch: `mobile-native-navigation`.

## What was done

**Expo SDK 54 → 57** (`ab3677a`). React Native 0.86, React 19.2. Needed because
the current `NativeTabs` component API arrived in SDK 55.

`expo-media-library` was rewritten in 57 — an `Asset` is now an object of
getters and `SortBy` has left the main export. The three files that read it
(`lib/backup.ts`, `screens/BackupProgressScreen.tsx`, `screens/LibraryScreen.tsx`)
import `expo-media-library/legacy` instead, which still has the old shape.
**That is a deferred migration, not a fix.**

**Expo Router and native tabs** (`ddf2017`). The bottom bar is now the operating
system's own — `UITabBarController` on iOS, Material `BottomNavigationView` on
Android. Routing is file-based under `app/`. Deleted: `App.tsx`,
`src/navigation.tsx`, `src/components/Tabs.tsx`. The hand-built stack, push
animation and edge-swipe back are the platform's job now.

Two things moved rather than went: the session (which server, signed in or not)
is `src/session.tsx`, because file-based routing means any route can be first;
and the floating bars' geometry (`BAR_RADIUS`, `BAR_MARGIN`, `BAR_HEIGHT`) is in
`src/theme.ts`, since the tab bar it used to live in no longer exists.

## What is broken

**Android lost its blur.** SDK 57's `expo-blur` wants a `blurTarget` prop for
`dimezisBlurView`; without it the method falls back to `none`. Logcat says so on
every launch. `src/components/Glass.tsx`.

## What turned out not to be broken

**The routing bug was a stale bundle.** Tapping a person did nothing on the
machine this was written on. It does now, with no change to the routing code:
all four pushed routes — `/person/[id]`, `/folder/[id]`, `/album/[id]` and
`/place/[city]` — were tapped through on both an Android emulator and an iPhone
17 Pro Max simulator after a clean rebuild. If it comes back, suspect Metro's
cache before the router: expo-router finds routes by walking `app/`, and a cache
from before those files existed leaves `push` silently doing nothing.

**iOS is verified.** The native tab bar, all four pushed routes, the edge-swipe
back, and both light and dark. It needs a real build —
`npx expo prebuild -p ios && npx pod-install && npx expo run:ios` — because Expo
Go cannot load it.

## What is still owed

1. **Move the segmented controls and the search field out of the header.**
   Browse and People carry a segmented control; Search carries a field as well.
   A native header holds a title and a couple of buttons, so until these live in
   the scrolling content the top bar cannot go native — which is why
   `app/_layout.tsx` still draws the old one above the stack. Both Google Photos
   and Immich put these below the bar anyway.

2. **`TAB_BAR_CLEARANCE` is still a guess.** The native bar's height cannot be
   measured — Expo's docs say so, and it moves to the side on iPad. Every grid's
   bottom padding derives from it. Worth reading alongside SDK 57's automatic
   content insets, which inset the first scroll view inside a tab screen and may
   already be doing half of this.

3. **Backup, the two pieces not built yet.** Uploading on open and on resume:
   only the fifteen-minute background task exists, and the `AppState` listener
   in `LibraryScreen` re-checks permissions rather than starting a run. And
   deduplication by content: `syncDone` keys on the OS asset id, so a photo the
   server already holds from the web, the CLI or another phone is sent again and
   discarded on arrival — bandwidth, never correctness. Immich hashes instead,
   at the point albums are chosen; this app has no album selection to hang that
   off yet.

## The design work behind this

Two research documents, published as artifacts on the account rather than in the
repo:

- Why the app does not feel like a media app, with an ordered plan
- Native bars per platform, and what each costs

Their headline findings: Browse had no day headers (fixed, `5006660`); the
viewer titles a photo `IMG_0017.JPG` and letterboxes it in hardcoded black (the
black is fixed, the titling is not); and the backed-up tick only appears when
the answer is yes, so the anxious case is silent. Also: the square grid is *not*
the problem — Immich ships the same one — so the justified-grid rewrite is
optional rather than foundational.
