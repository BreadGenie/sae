# Per-device host identity, no recovery in v1

The host's ed25519 auth keypair signs the meeting proof: `proof = ed25519_sign(auth_priv, host_x25519_pub || key_version)`. The private key must live somewhere, and we need a story for "what happens when a user can't access it (new device, cleared browser data)?" We chose per-device: ed25519 keypair generated on first E2EE use on that device, private key stored in IndexedDB, public key in `tabUser.device_keys`. New device = no auth key, can only *join* v2 meetings (using the host's X25519 pubkey), cannot *host*. No recovery in v1. The human-shareable passphrase from the refactor doc §3.3 is deferred.

## Status

Accepted (2026-06-04).

## Considered Options

- **A1 — Per-device ed25519, no recovery** (chosen). Simplest path that respects threat model B. "Switch laptops" = re-enroll to host. No new UX surface.
- **A2 — Frappe-password-encrypted key sync.** UX is nontrivial: when to prompt? SSO users are awkward. ~3-4 weeks.
- **A3 — Separate E2EE passphrase.** Another password to invent and remember. No recovery that doesn't reintroduce central trust.
- **B — Use Frappe session as identity.** Rejected: breaks the threat model. If the SFU trusts Frappe for identity, then a Frappe-server compromise = E2EE compromise (Frappe can issue a session for any user, and that session authenticates as that user).

## Consequences

- The user-data storage surface is minimal: `tabUser.device_keys` holds the public key, IndexedDB holds the private key on the device that generated it.
- "I lost my laptop and now I can't host meetings" is the expected and accepted UX. The answer is "we'll add A2 later."
- A2 is the obvious follow-up if user demand warrants. A1 → A2 is a UX add, not a wire-format change.
- The per-meeting X25519 keypair is ephemeral (generated when E2EE is enabled, lives for the meeting), so there's nothing to back up at the meeting level.
