// E2EE handshake signaling.
//
// The host runs a fresh ECDH with every joiner to deliver the meeting
// secret (per-joiner envelope).
// The SFU is a relay only — it never sees the envelope contents.
//
// Under threat model B, the envelope is *signed* by the host's server-published
// Ed25519 signing key. A self-supplied responder key is not a trust anchor.
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
	exportPublicKey,
	importPublicKey,
	openSignedEnvelope,
	x25519KeyPair,
} from "../utils/media/e2ee";

interface JoinerHello {
	fromParticipantId: string;
	fromSenderId: number;
	x25519PublicKey: string;
	signingPublicKey: string;
}

export function useE2EEHandshake() {
	async function beginJoinerHandshake(
		participantId: string,
		senderId: number,
		signingPublicKey: string,
	): Promise<{
		hello: JoinerHello;
		joinKeyPair: CryptoKeyPair;
	}> {
		const kp = await x25519KeyPair();
		const x25519PublicKey = await exportPublicKey(kp.publicKey);
		return {
			hello: {
				fromParticipantId: participantId,
				fromSenderId: senderId,
				x25519PublicKey,
				signingPublicKey,
			},
			joinKeyPair: kp,
		};
	}

	async function openJoinerEnvelope(
		joinKeyPair: CryptoKeyPair,
		responderX25519PubB64: string,
		responderSigningPub: CryptoKey,
		envelope: string,
		context: { meetingId: string; keyVersion: number },
	): Promise<{
		meetingSecret: Uint8Array<ArrayBuffer>;
		responderSigningPub: Uint8Array<ArrayBuffer>;
	}> {
		const responderPub = await importPublicKey(responderX25519PubB64);
		const envelopeBytes = base64ToBytes(envelope);
		const result = await openSignedEnvelope(
			joinKeyPair.privateKey,
			responderPub,
			responderSigningPub,
			envelopeBytes,
			context,
		);
		return {
			meetingSecret: result.meetingSecret,
			responderSigningPub: result.responderSigningPub,
		};
	}

	async function buildResponderEnvelope(
		responderPriv: CryptoKey,
		responderSigningPriv: CryptoKey,
		joinerX25519PubB64: string,
		responderX25519Pub: Uint8Array<ArrayBuffer>,
		responderSigningPub: Uint8Array<ArrayBuffer>,
		meetingSecret: Uint8Array<ArrayBuffer>,
		context: { meetingId: string; keyVersion: number },
	): Promise<string> {
		const joinerPub = await importPublicKey(joinerX25519PubB64);
		const envelopeBytes = await createSignedEnvelope(
			responderPriv,
			responderSigningPriv,
			joinerPub,
			responderX25519Pub,
			responderSigningPub,
			meetingSecret,
			context,
		);
		return bytesToBase64(envelopeBytes);
	}

	return {
		beginJoinerHandshake,
		openJoinerEnvelope,
		buildResponderEnvelope,
	};
}

function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i] as number);
	}
	return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(b64);
	const buffer = new ArrayBuffer(binary.length);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
