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
	async function importEd25519PublicKey(
		rawBytes: Uint8Array,
	): Promise<CryptoKey> {
		return crypto.subtle.importKey(
			"raw",
			rawBytes as BufferSource,
			{ name: "Ed25519" },
			true,
			["verify"],
		);
	}

	async function makeHostKeyMaterial() {
		const hostX25519KeyPair = await x25519KeyPair();
		const hostX25519PublicKey = await exportPublicKey(
			hostX25519KeyPair.publicKey,
		);
		const hostX25519PublicKeyBytes = new Uint8Array(
			await crypto.subtle.exportKey("raw", hostX25519KeyPair.publicKey),
		);

		const hostSigningKeyPair = await ed25519KeyPair();
		const hostSigningPublicKeyBase64 = await exportEd25519PublicKey(
			hostSigningKeyPair.publicKey,
		);
		const hostSigningPublicKeyBytes = new Uint8Array(
			await crypto.subtle.exportKey("raw", hostSigningKeyPair.publicKey),
		);

		return {
			hostX25519KeyPair,
			hostX25519PublicKey,
			hostX25519PublicKeyBytes,
			hostSigningKeyPair,
			hostSigningPublicKeyBase64,
			hostSigningPublicKeyBytes,
		};
	}

	it("host-signed envelope opens for a joiner and recovers the meeting secret", async () => {
		const { openJoinerEnvelope, buildHostEnvelope } = useE2EEHandshake();

		const joinerKeyPair = await x25519KeyPair();
		const host = await makeHostKeyMaterial();

		const meetingSecret = await generateMeetingSecret();
		const context = { meetingId: "vscl-sabe-ykvp", keyVersion: 1 };

		const envelope = await buildHostEnvelope(
			host.hostX25519KeyPair.privateKey,
			host.hostSigningKeyPair.privateKey,
			await exportPublicKey(joinerKeyPair.publicKey),
			host.hostX25519PublicKeyBytes,
			host.hostSigningPublicKeyBytes,
			meetingSecret,
			context,
		);

		const result = await openJoinerEnvelope(
			joinerKeyPair,
			host.hostX25519PublicKey,
			await importEd25519PublicKey(host.hostSigningPublicKeyBytes),
			envelope,
			context,
		);

		const got = new Uint8Array(result.meetingSecret);
		const want = new Uint8Array(meetingSecret);
		expect(got.byteLength).toBe(want.byteLength);
		expect(got.every((b, i) => b === want[i])).toBe(true);

		const recoveredSigning = await exportEd25519PublicKey(
			await importEd25519PublicKey(new Uint8Array(result.hostSigningPublicKey)),
		);
		expect(recoveredSigning).toBe(host.hostSigningPublicKeyBase64);
	});

	it("rejects an envelope signed by a non-host key (regression for the responder/host rename)", async () => {
		const { openJoinerEnvelope, buildHostEnvelope } = useE2EEHandshake();

		const joinerKeyPair = await x25519KeyPair();
		const realHost = await makeHostKeyMaterial();
		const attacker = await makeHostKeyMaterial();
		const meetingSecret = await generateMeetingSecret();
		const context = { meetingId: "vscl-sabe-ykvp", keyVersion: 1 };

		const attackerEnvelope = await buildHostEnvelope(
			attacker.hostX25519KeyPair.privateKey,
			attacker.hostSigningKeyPair.privateKey,
			await exportPublicKey(joinerKeyPair.publicKey),
			attacker.hostX25519PublicKeyBytes,
			attacker.hostSigningPublicKeyBytes,
			meetingSecret,
			context,
		);

		await expect(
			openJoinerEnvelope(
				joinerKeyPair,
				realHost.hostX25519PublicKey,
				await importEd25519PublicKey(realHost.hostSigningPublicKeyBytes),
				attackerEnvelope,
				context,
			),
		).rejects.toThrow();
	});
});
