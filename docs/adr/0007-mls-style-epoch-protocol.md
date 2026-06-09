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
