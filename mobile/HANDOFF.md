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

**Tapping a person does not push its route.** `PeopleScreen.tsx` calls
`router.push({ pathname: '/person/[id]', params: … })` and nothing happens — no
navigation, no warning in logcat. Unverified but likely the same for
`/folder/[id]`, `/album/[id]` and `/place/[city]`, since all four went through
the same change. **This is the first thing to fix.**

Worth checking: whether the routes are being discovered at all (nothing else in
the tree references them), and whether `Gate` returning `<Stack>` from inside a
conditional in `app/_layout.tsx` is interfering.

**Android lost its blur.** SDK 57's `expo-blur` wants a `blurTarget` prop for
`dimezisBlurView`; without it the method falls back to `none`. Logcat says so on
every launch. `src/components/Glass.tsx`.

**iOS is entirely unverified.** Everything above was seen only on the Android
emulator. Expo Go cannot run this app — native modules it does not contain — so
iOS needs `npx expo prebuild -p ios && npx pod-install && npx expo run:ios`.

## What is still owed

1. **Move the segmented controls and the search field out of the header.**
   Browse and People carry a segmented control; Search carries a field as well.
   A native header holds a title and a couple of buttons, so until these live in
   the scrolling content the top bar cannot go native — which is why
   `app/_layout.tsx` still draws the old one above the stack. Both Google Photos
   and Immich put these below the bar anyway.

2. **Rehome the photo-selection actions.** `PhotoActions` and `DeviceActions`
   replace the tab bar while a selection is live. A system tab bar cannot be
   replaced, so they need to become a sheet or a bar floating above the tabs.
   Affects Library, Browse, album, folder, person, place and search.

3. **`TAB_BAR_CLEARANCE` is now a guess.** The native bar's height cannot be
   measured — Expo's docs say so, and it moves to the side on iPad. Every grid's
   bottom padding derives from it.

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
