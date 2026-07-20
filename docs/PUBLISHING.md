# Play Store Publishing Checklist

This covers what's needed to submit Swarajya: Shivaji's Legacy to Google Play, split into what's already prepared in this repo versus what only the developer can do (account-level actions, not files).

**Note on the historical setting**: this game depicts Shivaji Maharaj and his companions respectfully and the enemy roster uses only generic military ranks (no named historical individuals as repeatable kills) — keep that same care in the store listing description, screenshots, and promotional copy. Frame it as a stylized action game honoring Maratha history, not a caricature.

## Already prepared in this repo
- `capacitor.config.json` — `appId`, `appName`, `webDir`, splash + AdMob plugin config (placeholders flagged, must be replaced with real values before release).
- `android/` — generated Capacitor Android/Gradle project (once `npx cap add android` has been run).
- `store-assets/icon-source.svg` — master icon art to derive all required launcher icon sizes from.
- `docs/PRIVACY_POLICY.md` — draft privacy policy text declaring no data collection.

## You must do these yourself (outside this repo / one-time account actions)

1. **Google Play Console developer account** — one-time $25 registration at https://play.google.com/console. Not a file, nothing to commit.
2. **Choose and lock in your `appId`** (`capacitor.config.json`) — must be a package name you uniquely own; it **cannot be changed after first publish** without creating an entirely new app listing.
3. **Signing/upload keystore** — generate with `keytool` (or let Play App Signing manage it) and store it *outside* version control. `.gitignore` already excludes `*.keystore`/`*.jks` — do not override that.
4. **Real AdMob account + IDs** — create an AdMob app entry, get a real AdMob App ID and a Rewarded Ad Unit ID, and replace every `ca-app-pub-0000000000000000~0000000000` placeholder in `capacitor.config.json`, `android/app/src/main/AndroidManifest.xml`, and `game/js/ads.js`. Flip `AdMob.initializeForTesting` to `false` in `capacitor.config.json` before any real release — leaving test mode on in production risks Google flagging your account for invalid traffic.
5. **Host the privacy policy publicly** — `docs/PRIVACY_POLICY.md` is only a draft in the repo; Play Console requires a live URL. GitHub Pages (repo Settings → Pages) is a free option that can serve this exact file.
6. **Data Safety form** (Play Console → App content → Data safety) — since this game collects no personal data and makes no network calls beyond ad SDK requirements, answer "No data collected" for app data, but do disclose AdMob's own data collection (ad ID, IP address for ad serving) per Google's current AdMob disclosure requirements — check AdMob's own policy docs at submission time, as these requirements change.
7. **Content rating questionnaire** (Play Console → App content → Content rating) — answer based on actual content (mild stylized action/combat theming, no gore, no real user-generated content, no gambling mechanics since prestige/boosts don't involve real-money wagering).
8. **Target audience & ads declaration** — declare the app contains ads (it does, via AdMob rewarded video) and set an appropriate target age group.
9. **Store listing assets** (uploaded directly in Play Console, not part of this repo):
   - 512×512 hi-res icon
   - 1024×500 feature graphic
   - At least 2 phone screenshots
   - Short description, full description, promo text
10. **versionCode / versionName bumps** — every new upload to Play Console needs a strictly higher `versionCode` in `android/app/build.gradle`. Plan your release cadence accordingly.
11. **Testing tracks** — use Play Console's Internal Testing track first, then Closed/Open testing, before Production rollout. This also satisfies Google's current requirement of a minimum testing period for new developer accounts.

## Before every release build
- [ ] `appId` matches the Play Console app you're uploading to
- [ ] AdMob IDs are real, `initializeForTesting` is `false`
- [ ] `versionCode` incremented, `versionName` updated
- [ ] `targetSdkVersion`/`compileSdkVersion` in `android/variables.gradle` meet Play Console's **current** minimum (this ratchets up yearly — check the live requirement at https://support.google.com/googleplay/android-developer/answer/11926878 before submitting, don't trust a number written here)
- [ ] Signed with your real upload keystore, not a debug key
- [ ] Privacy policy URL is live and matches the Play Console listing
