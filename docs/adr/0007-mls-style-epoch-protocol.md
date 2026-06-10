# MLS-style epoch protocol behind a Meet adapter

Meet needs member-change rekey, leave/kick forward secrecy, and post-compromise recovery for encrypted rooms. We chose an MLS-style epoch protocol that rotates the active meeting secret while preserving Meet's existing media-frame encryption, SFU sender IDs, and server-blind relay shape. MLS group-state internals should come from a browser-capable TypeScript MLS library behind an `EpochProtocolProvider`; Meet wraps opaque MLS commit/welcome bytes in Meet epoch envelopes that bind SFU membership deltas, roster hashes, sender IDs, and epoch numbers.

## Status

Accepted (2026-06-08).

## Considered Options

- **Current v2 host-only envelopes.** Rejected: no automatic member-change rekey, so removed participants can continue decrypting future captured media/chat until the meeting is recreated.
- **Full RFC 9420 wire-format interop.** Rejected: Meet does not need MLS application-message interop; SFU media requires Meet-specific sender IDs, media frame headers, roster binding, and opaque relay metadata.
- **Project-specific TreeKEM implementation.** Rejected: rolling our own TreeKEM/key schedule is unnecessary crypto risk if a viable library can provide MLS group-state internals.
- **MLS-style epoch protocol behind an adapter** (chosen). The library owns TreeKEM, commits, welcomes, ratchet-tree state, and exporter secrets. Meet owns product membership, SFU deltas, epoch envelopes, media-frame encryption, chat/media secret derivation, and threat-model-B validation.

## Consequences

- Encrypted rooms start with a host-created genesis epoch and later joins/leaves use epoch transitions; the unshipped v2 host-envelope admission path does not coexist with epoch admission.
- The SFU remains server-blind: it relays opaque MLS commit/welcome bytes and validates Meet envelope shape, targets, and membership-delta metadata, but never sees epoch secrets or meeting secrets.
- Clients must validate both layers: the MLS provider validates group-state cryptography, and Meet code validates SFU membership deltas, roster hashes, sender IDs, committer eligibility, and epoch numbers.
- The active Meet meeting secret is exported from the MLS epoch using a Meet-specific exporter label and then feeds existing media/chat key derivation.
- Threat model remains B. Malicious SFU equivocation/fork detection remains out of scope unless a future consistency layer is added.

## Designated committer

The SFU maintains a tier-1 roster (`E2eeRosterStore`): for each room, a map of `senderId → { participantId, isHost, joinedAt }`. The roster is informational; the SFU never holds path secrets or the meeting secret.

When a new joiner's `key-package` arrives, the SFU picks a designated committer via the roster:

1. **Host preferred if online.** The host is the natural authority and is the only tab with `is_host = true`.
2. **Oldest current member online otherwise.** Falls back to whoever has been in the epoch the longest, so the committer is deterministic and stable.
3. **Null if no current member is online.** The SFU retains the `key-package` and waits; a future joiner or reconnect can re-trigger the picker.

The chosen committer is given a `commit-request` envelope with a `committerSenderId` field. Any current member tab whose `sfuClient.getOwnSenderId()` matches is eligible to author the commit (the `isCurrentTabHost` requirement on the client was lifted). The SFU also validates the resulting `commit` against the roster: a `commit` from a `fromSenderId` that is not in the roster is rejected and logged.

**Threat model implications.** This is still tier-1: the SFU knows who is *online*, not the ratchet tree or the meeting secret. A compromised SFU can still drop or replay opaque MLS bytes, but cannot impersonate a current member to a third party (because the third party holds the participants' signing keys) and cannot decrypt any frames.

**Availability improvement.** With the roster picker, the host no longer needs to be present for new joiners. A meeting survives a host reload/loss as long as at least one other current member is online. The reconnect path also benefits: a fully-resynced joiner publishes a new key package, the picker picks a current member (not the joiner), the committer authors a `Remove` + `Add`-equivalent commit, the joiner re-installs from the welcome.
