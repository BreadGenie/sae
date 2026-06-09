# X25519 in WebCrypto required, no P-256 fallback

X25519 ECDH is the key-agreement primitive. WebCrypto support is Chrome 133+ (Feb 2025), Firefox 132+ (Apr 2025), Safari 17.4+ (Mar 2024). We require X25519 and reject older browsers from E2EE with a clear "update your browser" message. There is no silent fallback to P-256, even though P-256 is widely supported and would dramatically increase the install base.

## Status

Accepted (2026-06-04).

## Considered Options

- **A — X25519 required, reject older browsers from E2EE** (chosen). The meeting itself still works in non-E2EE mode. E2EE toggle shows a disabled state with tooltip on unsupported browsers.
- **B — P-256 fallback.** Rejected: creates a downgrade attack surface. An attacker who can choose to use the weaker primitive (P-256) gains a cryptanalytic advantage. If P-256 is genuinely acceptable, why use X25519 for anyone? If it isn't, why allow it?
- **C — Host X25519, joiners P-256.** Rejected: asymmetric security, no upside, extra state machine. The "strong" party can't defend themselves against the "weak" party sending them a fake curve point if the protocol allows P-256.

## Consequences

- A user with a locked-down corporate browser on Windows 7 + IE11 cannot use E2EE but can join non-E2EE meetings. If the host enables E2EE, this user sees a clear "E2EE not available on your browser" message.
- The 14-27 month browser support window is generous: a Frappe-hosted internal meeting tool can reasonably require IT to push Chrome 133+ / Firefox 132+. For consumer use, the user can update their browser.
- The 24-byte frame header is stable regardless of which browser produced the frame. SFU doesn't care.
- The browser-support cutoff is the same on all platforms. No per-OS special cases.
