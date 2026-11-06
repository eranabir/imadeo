# Imadeo 1.0.0 — build 107

Application source: `a16fa96e33f775a9d24b417ccf91ce908b6d6781`.
Apple build: `71c82dba-6bd3-4ab8-936f-f99f1e451f18`.
App Store app: `6799252901`.

## Store screenshots

These are uncomposited screenshots of the running native app, captured on clean
review simulators. The reviewer library contains 15 photographs already used in
the project's public demo and one fictional generated dog photograph. No private
user gallery media is included.

| Apple display type | Order | Capture | Resolution |
| --- | --- | --- | --- |
| `APP_IPHONE_61` | 1 | [Browse](app-store-connect/iphone-61/01-browse-photos.jpg) | 1206 × 2622 |
| `APP_IPHONE_61` | 2 | [Media viewer](app-store-connect/iphone-61/03-media-viewer.jpg) | 1206 × 2622 |
| `APP_IPAD_PRO_3GEN_129` | 1 | [Media viewer](app-store-connect/ipad-13/02-media-viewer.jpg) | 2064 × 2752 |
| `APP_IPAD_PRO_3GEN_129` | 2 | [Browse](app-store-connect/ipad-13/01-browse-photos.jpg) | 2064 × 2752 |

All four files are opaque JPEGs at their native simulator resolution. Apple
accepts these dimensions in its [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
The [generated sample provenance](sample-media/beach-dog.source.md) records the
exact prompt, original resolution, and generation mode.

## Verification

The application source passed 211 mobile tests, 231 server tests, and both
TypeScript checks. Its GitHub Actions runs completed successfully:
[Publish images](https://github.com/eranabir/imadeo/actions/runs/42224167338) and
[Pages deployment](https://github.com/eranabir/imadeo/actions/runs/42224166988).

[Final audit](release-evidence/final-audit.json) records build eligibility,
selected version, public endpoint checks, and authenticated checks without
credentials or tokens. The public server deployment remains revision
`210a5a488776002e5a4e316c6fff5d62c045c454`; build 107 adds only mobile changes.

The [published privacy label](release-evidence/app-privacy-published.png) includes
Other Usage Data and Other Diagnostic Data for App Functionality, linked to the
user and not used for tracking. This accounts for map-provider request and
security logs described in the [privacy policy](https://imadeo.app/privacy.html).

App Store publication is configured for automatic release after Apple approval.
An upload or a Ready for Review draft alone is not evidence of submission;
retain Apple's submitted timestamp and review state with the release receipt.
