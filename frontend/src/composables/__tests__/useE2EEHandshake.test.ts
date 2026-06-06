import { describe, expect, it } from "vitest";

import {
	ed25519KeyPair,
	exportEd25519PublicKey,
	exportPublicKey,
	generateMeetingSecret,
	x25519KeyPair,
} from "../../utils/media/e2ee";
import { useE2EEHandshake } from "../useE2EEHandshake";

describe("useE2EEHandshake", () => {
	it("host-signed envelope opens for a joiner", async () => {
		const { beginJoinerHandshake, openJoinerEnvelope, buildResponderEnvelope } =
			useE2EEHandshake();

		const joiner = await beginJoinerHandshake("joiner-1", 2, "ignored");

		const responderKp = await x25519KeyPair();
		const responderX25519PubB64 = await exportPublicKey(responderKp.publicKey);
		const responderX25519PubBytes = new Uint8Array(
			await crypto.subtle.exportKey("raw", responderKp.publicKey),
		);

		const responderSigningKp = await ed25519KeyPair();
		const responderSigningPubB64 = await exportEd25519PublicKey(
			responderSigningKp.publicKey,
		);
		const responderSigningPubBytes = new Uint8Array(
			await crypto.subtle.exportKey("raw", responderSigningKp.publicKey),
		);

		const meetingSecret = await generateMeetingSecret();

		const envelope = await buildResponderEnvelope(
			responderKp.privateKey,
			responderSigningKp.privateKey,
			await exportPublicKey(joiner.joinKeyPair.publicKey),
			responderX25519PubBytes,
			responderSigningPubBytes,
			meetingSecret,
			{ meetingId: "vscl-sabe-ykvp", keyVersion: 1 },
		);

		const responderSigningPub = await crypto.subtle.importKey(
			"raw",
			new Uint8Array(
				await crypto.subtle.exportKey("raw", responderSigningKp.publicKey),
			),
			{ name: "Ed25519" },
			true,
			["verify"],
		);

		const result = await openJoinerEnvelope(
			joiner.joinKeyPair,
			responderX25519PubB64,
			responderSigningPub,
			envelope,
			{ meetingId: "vscl-sabe-ykvp", keyVersion: 1 },
		);

		const got = new Uint8Array(result.meetingSecret);
		const want = new Uint8Array(meetingSecret);
		expect(got.byteLength).toBe(want.byteLength);
		expect(got.every((b, i) => b === want[i])).toBe(true);

		const recoveredSigning = await exportEd25519PublicKey(
			await crypto.subtle.importKey(
				"raw",
				new Uint8Array(result.responderSigningPub).buffer as ArrayBuffer,
				{ name: "Ed25519" },
				true,
				["verify"],
			),
		);
		expect(recoveredSigning).toBe(responderSigningPubB64);
	});

	it("envelope signed with a different responder signing key is rejected", async () => {
		const { beginJoinerHandshake, openJoinerEnvelope, buildResponderEnvelope } =
			useE2EEHandshake();
		const joiner = await beginJoinerHandshake("joiner-2", 3, "ignored");

		const responderKp = await x25519KeyPair();
		const responderX25519PubB64 = await exportPublicKey(responderKp.publicKey);
		const responderX25519PubBytes = new Uint8Array(
			await crypto.subtle.exportKey("raw", responderKp.publicKey),
		);

		const signingKp = await ed25519KeyPair();
		const signingPubBytes = new Uint8Array(
			await crypto.subtle.exportKey("raw", signingKp.publicKey),
		);

		const meetingSecret = await generateMeetingSecret();

		const envelope = await buildResponderEnvelope(
			responderKp.privateKey,
			signingKp.privateKey,
			await exportPublicKey(joiner.joinKeyPair.publicKey),
			responderX25519PubBytes,
			signingPubBytes,
			meetingSecret,
			{ meetingId: "vscl-sabe-ykvp", keyVersion: 1 },
		);

		const differentKp = await ed25519KeyPair();
		const differentPub = await crypto.subtle.importKey(
			"raw",
			new Uint8Array(
				await crypto.subtle.exportKey("raw", differentKp.publicKey),
			),
			{ name: "Ed25519" },
			true,
			["verify"],
		);

		await expect(
			openJoinerEnvelope(
				joiner.joinKeyPair,
				responderX25519PubB64,
				differentPub,
				envelope,
				{ meetingId: "vscl-sabe-ykvp", keyVersion: 1 },
			),
		).rejects.toThrow();
	});
});
