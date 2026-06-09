# Threat model is B (active malicious participant)

The E2EE refactor must scope which attackers we defend against. We chose threat model B: passive server + passive network observer (model A), plus an active malicious participant who has legitimately joined the meeting. The SFU is honest-but-curious and server-blind; frame authentication is the receiver's responsibility. With a meeting-shared secret, AES-GCM alone is not sender authentication because every legitimate participant can derive meeting-derived frame keys. Threat model B therefore requires sender authentication that is bound to the SFU-assigned `sender_id` and verified by receivers. Threat model A is too weak — without sender authentication, anyone holding the meeting key can forge frames. Threat model C is unbuildable with a single SFU.

## Status

Accepted (2026-06-04).

## Considered Options

- **A** — passive server + passive network only. Rejected: no per-sender auth, any participant with the meeting key can impersonate.
- **B** (chosen) — A + active malicious participant. Standard "Zoom-class E2EE."
- **C** — B + malicious SFU that serves different bytes to different recipients. Requires N-of-M SFU replication, witness encryption, or similar. ~12 months and a different product architecture.

## Consequences

- The host is a trust anchor: can decrypt all frames, can forge frames claiming any sender identity. Defended by operational security (Frappe session security, ed25519 keypair hygiene), not by the wire protocol.
- The SFU is server-blind by construction: stores and compares key proofs, not key material.
- A compromised SFU is out of scope. The single-SFU design intentionally accepts this.
- Threat model can be tightened toward C later by adding SFU replication, without changing the wire format (24-byte frame header is stable).
