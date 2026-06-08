// E2EE handshake signaling.
//
// The host runs a fresh ECDH with every joiner to deliver the meeting
// secret (per-joiner envelope).
// The SFU is a relay only — it never sees the envelope contents.
//
// Under threat model B, the envelope is *signed* by the host's server-published
// Ed25519 signing key. A self-supplied key is not a trust anchor.
//
// Wire format (relayed through SFU's e2ee:handshake event):
//   joiner   -> participants: { fromParticipantId, fromSenderId,
//                               x25519PublicKey, signingPublicKey }
//   host     -> joiner:      { fromParticipantId, fromSenderId,
//                              toParticipantId, toSenderId, envelope }
//
// See docs/refactors/e2ee-modernization.md for the full protocol.

import {
	createSignedEnvelope,
	importPublicKey,
	openSignedEnvelope,
} from "../utils/media/e2ee";
import { bufferToBase64, bytesFromBase64 } from "../utils/media/e2eePrimitives";

export function useE2EEHandshake() {
	async function openJoinerEnvelope(
		joinKeyPair: CryptoKeyPair,
		hostX25519PublicKeyBase64: string,
		hostSigningPublicKey: CryptoKey,
		envelope: string,
		context: { meetingId: string; keyVersion: number },
	): Promise<{
		meetingSecret: Uint8Array<ArrayBuffer>;
		hostSigningPublicKey: Uint8Array<ArrayBuffer>;
	}> {
		const hostX25519PublicKey = await importPublicKey(
			hostX25519PublicKeyBase64,
		);
		const envelopeBytes = bytesFromBase64(envelope);
		const result = await openSignedEnvelope(
			joinKeyPair.privateKey,
			hostX25519PublicKey,
			hostSigningPublicKey,
			envelopeBytes,
			context,
		);
		return {
			meetingSecret: result.meetingSecret,
			hostSigningPublicKey: result.hostSigningPublicKey,
		};
	}

	async function buildHostEnvelope(
		hostX25519PrivateKey: CryptoKey,
		hostSigningPrivateKey: CryptoKey,
		joinerX25519PublicKeyBase64: string,
		hostX25519PublicKey: Uint8Array<ArrayBuffer>,
		hostSigningPublicKey: Uint8Array<ArrayBuffer>,
		meetingSecret: Uint8Array<ArrayBuffer>,
		context: { meetingId: string; keyVersion: number },
	): Promise<string> {
		const joinerPub = await importPublicKey(joinerX25519PublicKeyBase64);
		const envelopeBytes = await createSignedEnvelope(
			hostX25519PrivateKey,
			hostSigningPrivateKey,
			joinerPub,
			hostX25519PublicKey,
			hostSigningPublicKey,
			meetingSecret,
			context,
		);
		return bufferToBase64(envelopeBytes);
	}

	return {
		openJoinerEnvelope,
		buildHostEnvelope,
	};
}
