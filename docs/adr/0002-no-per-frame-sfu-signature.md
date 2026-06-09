# No per-frame SFU verification (#7 closed by receiver-side sender auth)

The "skip the transform" hole (#7) is that a malicious participant could join with the right key, attach no encryption transform, and exfiltrate plaintext or inject unauthenticated media. The intuitive fix is a per-frame signature that the SFU verifies. We chose not to make the SFU verify frames: the SFU stays server-blind and forwards opaque bytes.

Threat model B still requires receiver-side sender authentication. With the chosen meeting-shared `meeting_secret`, AES-GCM's tag does not by itself prove sender identity because every legitimate participant can derive meeting-derived frame keys. A frame is accepted only if the receiver verifies authentication material bound to the SFU-assigned `sender_id`, the frame header, and the ciphertext. The sender public key used for that verification must itself be authenticated and bound to the same `sender_id`; otherwise an active participant can advertise a key for another sender and forge frames under that sender id.

## Status

Accepted (2026-06-04).

## Considered Options

- **(i) Per-frame ed25519 signature, SFU verifies.** Real overhead: 64 bytes/frame at 30 fps = 1.9 KB/s/stream; 50-100 μs/frame for verification; a second keypair per sender (ed25519 identity alongside X25519 ECDH key); partial breakage of "SFU is honest-but-curious" because the SFU now interprets authentication material.
- **(ii) Receiver verifies per-frame sender authentication, SFU does not verify** (chosen). The SFU forwards opaque bytes. Receivers reject frames whose sender authentication does not verify under the authenticated public key for the claimed `sender_id`.
- **(iii) No per-frame sender authentication.** Rejected under threat model B. With a meeting-shared secret, any participant can derive frame keys for any sender id and forge AES-GCM-valid frames.
- **(iv) Drop to threat model A.** Rejected: strictly weaker for the same code complexity.

## Consequences

- The short-frame passthrough in `frontend/src/utils/media/e2ee.ts` must be hardened: account for the full authenticated frame overhead, drop on failure, never pass through.
- A future engineer reading the SFU code and seeing no per-frame verification will assume it's a bug. The ADR is the explanation: verification is receiver-side, not SFU-side.
- The sender-authentication key distribution path is security-critical. The SFU-assigned `sender_id` must be bound to the signing public key by an authenticated message; clients must not trust self-asserted `fromSenderId` or `signingPublicKey` values from arbitrary participants.
