# Ľudovka

An offline Android app for browsing the text of Slovak folk songs, searching them by
name or by lyrics, organizing them into your own named playlists, and adding new
songs one at a time or in bulk — all without any Google Play or Apple developer
account. It runs entirely offline once installed.

## How it's built

- `www/` — the actual app (HTML/CSS/JS, stores everything locally in the device's
  IndexedDB). This is the single source of truth for all app content and behaviour.
- `android/` — a minimal native Android project that just opens `www/` in a
  full-screen WebView. It requests no `INTERNET` permission at all.
- `.github/workflows/build-apk.yml` — a GitHub Actions workflow that compiles
  `android/` into `Ludovka.apk` and publishes it as a downloadable Release asset,
  every time this repo is pushed to (or run manually from the Actions tab).

## Updating songs in the future

You do **not** need to rebuild the app to add songs. Open the app itself →
**Spravovať** tab:

- **Pridať jednu pieseň** — add one song by hand (title, category, lyrics).
- **Hromadný import (CSV/Excel)** — pick a `.csv` file with columns `Nazov`,
  `Kategoria`, `Text` to add/update many songs at once. Existing songs are matched
  by title and updated; new titles are added.
- **Stiahnuť šablónu** — downloads a starter `.csv` template to your phone's
  Downloads folder so you always have the right column headers.
- **Exportovať všetko** — backs up your whole library as a `.csv`, handy if you
  want to bulk-edit songs in Excel/Sheets and re-import them.

Rebuilding the APK (pushing to this repo) is only needed if you want to change the
app's *design/features* — not for adding more songs.

## Building the APK yourself

Push this repo to GitHub with the workflow file in place, and the Actions tab will
build `Ludovka.apk` automatically and attach it to a Release. Download it from
there onto your phone, allow "install from unknown sources" for your browser/file
manager, and open it to install.
