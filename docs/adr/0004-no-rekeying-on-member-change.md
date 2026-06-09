# No automatic rekeying on member change in v1

The refactor doc §2 derives chains from per-joiner `epoch_secret` from
per-joiner ECDH. But per-joiner chains mean the sender must encrypt separately
for each joiner (no SFU fan-out, roughly 3x sender CPU and bandwidth). To keep
SFU fan-out (1 encrypt per frame, opaque ciphertext forwarded by the SFU),
chains derive from a meeting-shared `meeting_secret` distributed to joiners via
per-joiner ECDH envelopes.

## Status

Accepted (2026-06-04, revised 2026-06-05 after implementation review).

## Decision

One `meeting_secret` (32B) is active for the meeting epoch. The host generates
it at E2EE-enable time and distributes it to each joiner via per-joiner ECDH
envelope: `envelope_J = AEAD(ECDH(host_priv, joiner_pub_J), meeting_secret)`.
Each joiner decrypts their envelope to get `meeting_secret`. All per-sender
frame keys derive from `meeting_secret` plus `sender_id`, media type, and frame
generation.

Automatic rekey on join/leave/kick is deferred from v1. Joining participants get
the current in-memory `meeting_secret` and cannot decrypt old media they did not
capture because they did not have the secret at the time. Departed participants
who retained the current `meeting_secret` can decrypt future captured media
until the meeting is recreated or a future rekey protocol rotates the secret.

## Why

This keeps the v1 protocol small enough to ship while preserving SFU fan-out and
server-blind forwarding. A correct leave rekey needs a protocol-level epoch
transition: monotonic key versions, host-to-remaining-member envelope fan-out,
producer/consumer transform restart ordering, and handling offline or racing
participants. The current handshake messages do not safely express that state
transition.

## Considered Options

- **A. Per-joiner chains, sender encrypts per joiner.** Rejected for v1: 3x
  sender CPU and bandwidth; SFU is restricted to peer-to-peer relay, not a
  single broadcast.
- **B. Meeting-shared secret, automatic rekey on leave.** Desired future state,
  but not implemented in v1. Requires an explicit epoch transition protocol.
- **C. Meeting-shared secret, no automatic member-change rekey** (chosen for
  v1). 1x sender CPU and simplest implementation. No forward secrecy from
  departed participants.

## Consequences

- There is no leave/kick forward secrecy in v1. A participant who had the
  `meeting_secret` and keeps capturing SFU traffic can decrypt future media
  until the meeting is recreated or a future epoch transition is implemented.
- The host remains a trust anchor: it has `meeting_secret`, can decrypt all
  frames, and signs envelopes that bind sender signing keys.
- Layer 3 (MLS-style epoch transitions, tree of member pubkeys,
  Commit/Proposal messages) remains deferred.
- A future rekey upgrade must change the protocol deliberately; it should not be
  smuggled through the current joiner-envelope message without a monotonic
  version and explicit transition handling.
