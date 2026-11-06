# Imadeo 1.0.0 — build 109

Application source: `99b866b9099008dc56fcd5394fc2253f96dd0f28`.
EAS build: `eefec0ff-d0d5-42cf-982f-1ab03e084a91`.
App Store app: `6799252901`.

## Favorites

Open **Browse → Albums → Favorites** to find favorited media. The collection
appears even when there are no user-created albums and shares the app's grid,
list, Date/Name/Type sorting, pagination, and selection controls. It refreshes
when returning after an item is unfavorited. The server includes eligible
favorites from both the main library and device backup, while preserving
ownership, trash, visibility, and Locked boundaries.

## Native navigation

This build backports the one-line upstream
[react-native-screens correction](https://github.com/software-mansion/react-native-screens/pull/4990)
that sizes the native tab controller before attaching it. It fixes the missing
native glass page rail when the Duo starts already unfolded. The retained patch
does not introduce a styling override or a sidebar-adaptation workaround.

[Native verification](release-evidence/native-navigation-verification.json)
records the fresh immutable-install checks and coordinator-observed cold starts:
three of three unfolded Duo launches, one regular iPhone launch, and one iPad
launch passed. The final Duo Favorites interaction check was still pending host
unlock when this evidence snapshot was prepared. QA captures containing Apple
simulator stock photographs are excluded from these release assets.

## Candidate and deployment verification

The release coordinator recorded **216 passing mobile tests**, **244 passing
server tests**, and both TypeScript checks. The signed App Store IPA identity and
SHA-256 are recorded in [candidate verification](release-evidence/candidate-verification.json).
The [Apple delivery receipt](release-evidence/apple-delivery.json) confirms that
the exact EAS artifact uploaded successfully and build 109 reached `VALID`.
The [TestFlight receipt](release-evidence/testflight.json) confirms
`IN_BETA_TESTING` and access for the existing internal **Team (Expo)** group.
Public App Review submission remains a separate check.

Both exact-source GitHub workflows completed successfully:
[Publish images](https://github.com/eranabir/imadeo/actions/runs/42244737562) and
[Pages deployment](https://github.com/eranabir/imadeo/actions/runs/42244736308).
The [CI receipt](release-evidence/application-ci.json) includes all job results.
The [deployment receipt](release-evidence/nas-deployment.json) verifies the five
running application services against immutable source-matched images, with the
database and Redis preserved, healthy API responses, and Favorites boundary
checks. The live review fixture has one favorite; multi-item ordering and device
inclusion are covered by regression tests, rather than claimed as live checks.

## Store assets and release state

Build 109 reuses the four approved, completed
[build 107 store screenshots](../build-107/README.md#store-screenshots). Their
visible Browse and viewer interfaces remain unchanged. They contain only
project-public sample media and a fictional generated dog photograph; see the
[sample provenance](../build-107/sample-media/beach-dog.source.md).

Apple validated build `38498df2-5c7b-433e-8b18-ea29adc8e28c` at the
`2026-11-06T16:13:19.621Z` delivery check. The upload command exited successfully
with no recorded error codes, and the signed IPA matches the EAS artifact hash.
Internal TestFlight availability was confirmed at
`2026-11-06T16:14:28.752Z`: the build is `IN_BETA_TESTING`, and the existing
internal Team (Expo) group has access through its all-builds setting. At this
snapshot, **public App Review had not been submitted**.

The [candidate selection receipt](release-evidence/candidate-selection.json)
confirms build 109 is selected in the same unsubmitted review draft, with the
same review item restored. Apple reports `READY_FOR_REVIEW` with a null submitted
date. The final Duo Favorites interaction awaits host unlock. The public review
submission and Apple's submitted timestamp must be recorded before reporting the
release submitted.
App Store publication is configured for automatic release after Apple approval.
