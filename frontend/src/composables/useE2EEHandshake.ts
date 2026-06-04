// E2EE v2 handshake signaling.
//
// The meeting host runs a fresh ECDH with every joiner to deliver the
// meeting secret (per-joiner envelope). The SFU is a relay only — it
// never sees the envelope contents.
//
// Wire format (relayed through SFU's e2ee:handshake event):
//   joiner -> host:  { fromParticipantId, fromSenderId, x25519PublicKey }
//   host   -> joiner: { fromParticipantId, fromSenderId, toParticipantId,
//                       toSenderId, envelope }
//
// See docs/refactors/e2ee-modernization.md for the full protocol.

import {
	createEnvelope,
	exportPublicKey,
	importPublicKey,
	openEnvelope,
	x25519KeyPair,
} from "../utils/media/e2ee";

interface JoinerHello {
	fromParticipantId: string;
	fromSenderId: number;
	x25519PublicKey: string;
}

interface HostEnvelopeDelivery {
	fromParticipantId: string;
	fromSenderId: number;
	toParticipantId: string;
	toSenderId: number;
	envelope: string;
}

type E2eeHandshakeMessage = JoinerHello | HostEnvelopeDelivery;

type HandshakeRole = "host" | "joiner";

interface E2eeHandshakeHandlers {
	onEnvelopeReceived?: (
		envelope: string,
		from: { participantId: string; senderId: number },
	) => void;
	onJoinerHello?: (hello: JoinerHello) => void;
}

export function useE2EEHandshake() {
	const isHost = false;

	async function beginJoinerHandshake(
		participantId: string,
		senderId: number,
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
			},
			joinKeyPair: kp,
		};
	}

	async function openJoinerEnvelope(
		joinKeyPair: CryptoKeyPair,
		hostX25519PubB64: string,
		envelope: string,
		context: { meetingId: string; keyVersion: number },
	): Promise<Uint8Array<ArrayBuffer>> {
		const hostPub = await importPublicKey(hostX25519PubB64);
		const envelopeBytes = base64ToBytes(envelope);
		return openEnvelope(
			joinKeyPair.privateKey,
			hostPub,
			envelopeBytes,
			context,
		);
	}

	async function buildHostEnvelope(
		hostPriv: CryptoKey,
		joinerX25519PubB64: string,
		meetingSecret: Uint8Array<ArrayBuffer>,
		context: { meetingId: string; keyVersion: number },
	): Promise<string> {
		const joinerPub = await importPublicKey(joinerX25519PubB64);
		const envelopeBytes = await createEnvelope(
			hostPriv,
			joinerPub,
			meetingSecret,
			context,
		);
		return bytesToBase64(envelopeBytes);
	}

	return {
		beginJoinerHandshake,
		openJoinerEnvelope,
		buildHostEnvelope,
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
