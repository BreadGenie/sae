# E2EE deepening plan

Sequenced slices to address architectural friction in the E2EE v1 codebase
on the `e2ee` branch. Each slice is one commit, behavior-preserving unless
noted, and unblocks the slices after it. Vocabulary follows
[`../../TASTE.md`](../../TASTE.md) and the ADRs in `../adr/`.

## Scope

Eight candidates surfaced by an architecture review of the e2ee branch
(HEAD `cff018d`):

| # | Candidate                                   | Slice |
|---|---------------------------------------------|-------|
| 1 | `E2EEMeeting` instance from `e2ee.ts`        | 10    |
| 2 | Port-adapter the handshake state machine    | 11    |
| 3 | Wire format / SFU↔client type unification  | 8     |
| 4 | Base64 + HKDF info-string centralization   | 8     |
| 5 | Frame codec shared by main + worker        | 9     |
| 6 | Make `useDeviceIdentity` a port            | 7     |
| 7 | `useE2EEHandshake` pass-through            | 13    |
| 8 | Move `chatKeyCache` out of crypto file     | 10    |

## Order rationale

The order is **lowest-risk, highest-leverage first**, not "by what blocks
what." Slices 7–9 are pure refactors (no behavior change, no test rewrite),
slice 10 introduces the foundational class, slice 11 ports the protocol,
slices 12–13 are cleanup. Each slice compiles, all tests pass, lint clean.

## Slices

### Slice 7 — `useDeviceIdentity` becomes a port

**Files**:
- `frontend/src/composables/useDeviceIdentity.ts`
- `frontend/src/composables/__tests__/useDeviceIdentity.test.ts` (new)

**Change**:
- Extract a `DeviceIdentityProvider` interface with one method:
  `getIdentity(): Promise<DeviceIdentity>`.
- Two implementations: `IndexedDBDeviceIdentityProvider` (current
  behavior) and `MemoryDeviceIdentityProvider` (for tests, in-memory map).
- `useDeviceIdentity` returns a singleton provider; callers `await
  provider.getIdentity()` as today.
- Cached-promise pattern moves into the interface implementation.
- Add a unit test for the memory provider's stability + corruption
  recovery (the implicit invariant the v1 IndexedDB store gave us for
  free).

**Why first**: smallest, isolated, behavior-preserving. Unblocks slice 11's
controller tests.

### Slice 8 — Centralize base64 + HKDF info strings

**Files**:
- `frontend/src/utils/media/e2eePrimitives.ts` (new)
- `frontend/src/utils/media/e2ee.ts`
- `frontend/src/utils/media/e2eeTransformWorker.ts`
- `frontend/src/composables/useE2EEHandshake.ts`
- `frontend/src/composables/useE2EEConnectionHandshake.ts`
- `frontend/src/components/settings/E2EESettingsSection.vue`

**Change**:
- New module owns one `bufferToBase64` / `bytesFromBase64` pair with a
  typed signature (`Uint8Array<ArrayBuffer>` ↔ `string`).
- New module owns HKDF info-string *factories*:
  - `E2EE_INFO_SENDER(senderId, mediaType)`
  - `E2EE_INFO_FRAME`
  - `E2EE_INFO_AES`
  - `E2EE_INFO_FRAME_AT(senderId, mediaType, generation)`
  - `E2EE_INFO_ENVELOPE(meetingId, keyVersion)`
  - `E2EE_INFO_CHAT`
- Domain separator `meet-e2ee|` lives in this one file. Security
  constant.
- All call sites import the factories. No behavior change.

**Why now**: mechanical, shrinks the surface slice 10 has to touch, and
removes the "grep all 7 sites" hazard for any future domain-separator
change (Layer 3 epoch transitions will need to).

### Slice 9 — Frame codec shared by main + worker

**Files**:
- `frontend/src/utils/media/frameCodec.ts` (new)
- `frontend/src/utils/media/e2ee.ts`
- `frontend/src/utils/media/e2eeTransformWorker.ts`
- `frontend/src/utils/media/__tests__/frameCodec.test.ts` (new)

**Change**:
- New module owns the *pure* parts of the encrypt/decrypt path:
  `encodeFrameHeader`, `decodeFrameHeader`, `buildSignedFramePayload`,
  `verifySignedFramePayload`, `deriveFrameKey`, `deriveAESKey`,
  `getOrCreateSenderChain`, `getOrCreateReceiverChain` (with
  `chainTipToAESKey`).
- Constants unified: `FRAME_HEADER_FIXED_SIZE`, `FRAME_HEADER_TOTAL`,
  `FRAME_MAGIC`, `MIN_SIGNED_ENCRYPTED_FRAME_SIZE`, `REPLAY_WINDOW`
  (currently 100 in worker, 3 in main thread — the asymmetry is
  documented in the new module as a deliberate two-tier cache: short
  window on the hot path, longer window on the worker).
- Main-thread `TransformStream` and the worker both import from
  `frameCodec`. The worker keeps its `SendState.encrypt` /
  `RecvState.decrypt` orchestration (differences are pre-warm cache,
  dummy-verify warm-up, postMessage wiring).
- New unit test: the same frame bytes round-trip through both
  `mainThread` and `worker` code paths (against the same codec).

**Why now**: makes the cryptographic invariant testable in one place;
removes the "fix the bug twice" hazard. Still pure refactor.

### Slice 10 — `E2EEMeeting` instance replaces the module singleton

**Files**:
- `frontend/src/utils/media/e2ee.ts`
- `frontend/src/utils/media/__tests__/e2ee.test.ts`
- (callers: `useE2EEConnectionHandshake.ts`, `TransportManager.ts`)

**Change**:
- Introduce `E2EEMeeting` class holding `meetingSecret`, `keyVersion`,
  `senderSigningPriv`, per-sender chains, per-sender signing pubs,
  receiver chain, pending senders, pending receivers, active
  transforms, script-transform workers.
- Module-level state in `e2ee.ts` collapses to zero. The 8 export
  functions (`setMeetingContext`, `hasMeetingContext`, `setSenderSigningPub`,
  `hasSenderSigningPub`, `wipeMeetingContext`, `setupSenderTransform`,
  `setupReceiverTransform`, `getE2EEChatKey`) become methods on the
  class, or move to a separate module.
- `chatKeyCache` (line 907) **moves out** to a new `useE2EEChatKey`
  composable that takes the meeting secret as input, not ambient state.
  This is candidate #8 in the review.
- Tests instantiate `new E2EEMeeting()` per test. The 200+ lines of
  `beforeEach(() => wipeMeetingContext())` collapse to one line per
  test (or zero).
- Callers receive a `meeting: Ref<E2EEMeeting | null>` (or are passed
  the instance). Wipe-on-pagehide becomes `meeting.value = null` in
  the calling composable.

**Why now**: prerequisite for slice 11. The controller will own its
meeting instance, not reach into a global.

**Risk**: largest slice. The class boundary must be the *real*
boundary (no back-doors to module state). The chat-key move is a
separate commit if it gets in the way of the main change.

### Slice 11 — Port-adapter the handshake state machine

**Files**:
- `frontend/src/composables/useE2EEConnectionHandshake.ts`
- `frontend/src/composables/__tests__/useE2EEConnectionHandshake.test.ts` (new)

**Change**:
- New port: `HandshakeIO` interface with typed inputs (the current
  ambient `sfuClient`, `sfuManager`, `document`, IndexedDB
  identity, meeting context) and typed outputs (commands: `sendHello`,
  `sendEnvelope`, `adoptMeetingContext`, `reconfigureMedia`,
  `setE2EERequired`).
- New core: `E2EEHandshakeController` class that runs the protocol
  state graph. The 13 methods on the current composable become ~5
  intent handlers (`onHostEnabled`, `onJoinerHello`, `onEnvelope`,
  `onResync`, `onReconnect`).
- The composable becomes a thin wrapper that builds the IO from the
  current `useSFUConnection` context, instantiates the controller, and
  forwards document events / sfu messages.
- The two near-duplicate blocks (`handleHostE2EEKeySet` at 403-479 and
  `handleMeetingE2EEEnabled` at 535-645) collapse to one
  parameterized "adopt host identity" procedure.
- `parseKeyVersion` (the stub at line 125) gets a real implementation
  (regex `^v(\d+)-([0-9a-f]{8})$`) or stays a no-op with a `TODO`
  anchored to the Layer 3 epoch transition.
- New unit test: the controller with a fake `HandshakeIO` covering
  happy path, host-offline, joiner-races-host-toggle, and tampered
  envelope rejection.

**Why now**: the bugs hide here. The current 753-line composable has
zero unit tests.

**Risk**: medium. The port must be a *real* port — no passing the
controller the `sfuClient` object directly.

### Slice 12 — E2EE transform policy out of `TransportManager`

**Files**:
- `frontend/src/utils/media/e2eeTransformPolicy.ts` (new)
- `frontend/src/utils/media/TransportManager.ts`
- `frontend/src/utils/media/__tests__/e2eeTransformPolicy.test.ts` (new)

**Change**:
- New module owns the 3 private methods
  (`shouldEnableE2EETransforms`, `shouldEnableLegacyEncodedInsertableStreams`,
  `assertE2EEContextReady`) + the keyframe-burst retry logic at
  `TransportManager.ts:620-642`.
- Returns a policy object `{ installSenderTransform, installReceiverTransform,
  legacyMode, needsKeyframeBurst }` given the meeting state + SFU state.
- `TransportManager` becomes a consumer: it asks the policy and acts.
- New unit test: the policy with fake inputs covers the 5+ branches
  that today hide inside `createProducer` / `createConsumer` and have
  no test surface.

**Why now**: small, isolated, behavior-preserving. The policy is
already a coherent concept; today it's just in the wrong file.

### Slice 13 — `useE2EEHandshake` becomes the wire boundary

**Files**:
- `frontend/src/composables/useE2EEHandshake.ts`
- `frontend/src/composables/useE2EEConnectionHandshake.ts`

**Change**:
- After slice 11, the handshake state machine no longer reaches into
  `e2ee.ts` directly. `useE2EEHandshake` is either:
  - **deleted** (the 30 lines inlined into the controller's
    `HandshakeIO` adapter), or
  - **kept as the typed wire boundary** for the 3 pure functions,
    with no behavior change. Decision deferred to slice 11.
- Whichever path, `useE2EEHandshake.test.ts` either goes away
  (deleted) or shrinks to a true wire-format test (kept).

**Why last**: the right answer depends on slice 11's port shape.

## Cross-cutting decisions to lock in

- **No new SFU tests** (per user). SFU `E2EEHandshakeRelay.ts` is
  out of scope; the wire format unification in slice 8 is the only
  change that touches the server.
- **No behavior change** in slices 7–12. Slice 13 may delete code.
- **One commit per slice.** Conventional-commit style. Author
  `Bread Genie <msuhailbh07@gmail.com>`. Don't push until told.
- **Verification after each slice**: `yarn workspace frontend test`,
  `yarn workspace frontend typecheck`, `yarn workspace sfu tsc`,
  `yarn workspace frontend lint` (Biome), `yarn workspace frontend
  knip`. Baseline before slice 1: vitest 210/210, all typecheck/lint
  clean.
- **ADRs unaffected.** None of the 8 candidates contradict the 6
  existing ADRs. If a candidate turns out to, write a new ADR first.

## Locked decisions

- **Slice 10**: `E2EEMeeting` lives in a new file
  `frontend/src/utils/media/E2EEMeeting.ts`. TASTE.md line count
  target is a hard rule. The class is the focal point; the file is
  its home.
- **Slice 11**: the `E2EEHandshakeController` is **intent-driven**.
  It exposes intent methods (`onJoinerHello`, `onEnvelope`,
  `onHostEnabled`, `onResync`, `onReconnect`, plus
  `adoptHostKey` for the parameterized "adopt host identity"
  procedure). The composable owns document / sfu event
  subscriptions and calls the intents. Tests inject intents
  directly — no document mocks.
- **Slice 11**: `parseKeyVersion` stays a stub returning 1, with a
  `TODO(layer-3-epoch): implement v<n>-<8 hex> regex per CONTEXT.md
  when the epoch transition ADR is written.` comment. The format
  isn't fully designed; honest placeholder beats premature
  commitment.
