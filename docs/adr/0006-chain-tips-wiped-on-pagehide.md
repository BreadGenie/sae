# Chain tips wiped on `pagehide`, re-ECDH on resume or missed-N-frames

Chain tips are the per-frame AES keys. After a tab is suspended, crashed, or the user navigates away and returns, the joiner needs either the current keying context or a fresh ECDH handshake. We wipe runtime frame-key state on `pagehide`, `beforeunload`, and explicit leave, and re-ECDH on resume. iOS Safari suspend/resume triggers a fresh ECDH each time. There is no IndexedDB persistence of chain tips, `meeting_secret`, or meeting X25519 private keys. We also re-ECDH if the receiver explicitly requests resync.

## Status

Accepted (2026-06-04, revised 2026-06-04 to add the missed-N-frames trigger).

## Considered Options

- **A — Wipe runtime key state on `pagehide`, re-ECDH on resume/resync** (chosen). ~10 ms when host is online, brief "reconnecting" indicator when host is offline.
- **B — Persist to IndexedDB plaintext.** Rejected: keys on disk readable by anyone with file access to the device. A stolen laptop = all current and future chain tips.
- **C — Persist to IndexedDB, encrypted with Frappe session token.** Survives resume. Requires session token storage, expiry handling, rotation. ~2 weeks of work for a benefit the user can rarely perceive (iOS Safari is the main case where this matters, and iOS Safari users accept the brief "reconnecting" indicator).
- **D — Pagehide only, no explicit resync** (ADR 0006 as originally written). Simpler, but a joiner disconnected for a few seconds may keep consuming frames that cannot be authenticated/decrypted until a new handshake happens.

## Consequences

- The chain tips *are* per-frame AES keys. The `meeting_secret` derives all frame keys. Persisting either is key persistence — the same anti-pattern the v1 passphrase-in-localStorage model embodied.
- iOS Safari users will see a brief "reconnecting" indicator on every tab resume. This is by design.
- The `meet:e2ee-needs-key-resync` event (T4.3 in the refactor doc) is the trigger for the resync. No new infrastructure beyond what the refactor doc already specifies.
- If the host fully reloads and loses its in-memory `meeting_secret`, v1 cannot recover that encrypted epoch. The meeting must be recreated or a future epoch-transition protocol must rotate the secret for everyone.
- If user reports of "the reconnecting indicator is annoying" accumulate, the answer is "we can add (C) later." The default — no keys on disk — is the right default.
