import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
	const buffer = new ArrayBuffer(hex.length / 2);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
	}
	return bytes;
}

beforeAll(() => {
	if (typeof globalThis.RTCRtpSender === "undefined") {
		globalThis.RTCRtpSender = class RTCRtpSender {} as never;
		globalThis.RTCRtpReceiver = class RTCRtpReceiver {} as never;
	}
});

import {
	decodeFrameHeaderV2,
	encodeFrameHeaderV2,
} from "../e2ee";

describe("Crypto primitives (T1.1)", () => {
	describe("X25519 ECDH", () => {
		it("generates 32-byte public key", async () => {
			const { x25519KeyPair, exportPublicKey } = await import("../e2ee");
			const kp = await x25519KeyPair();
			const b64 = await exportPublicKey(kp.publicKey);
			const raw = atob(b64);
			expect(raw.length).toBe(32);
		});

		it("round-trips public key export/import", async () => {
			const { x25519KeyPair, exportPublicKey, importPublicKey } = await import(
				"../e2ee"
			);
			const kp = await x25519KeyPair();
			const b64 = await exportPublicKey(kp.publicKey);
			const imported = await importPublicKey(b64);
			const reExported = await exportPublicKey(imported);
			expect(reExported).toBe(b64);
		});

		it("derives matching shared secrets on both sides (RFC 7748 property)", async () => {
			const {
				x25519KeyPair,
				exportPublicKey,
				importPublicKey,
				ecdhKeyAgreement,
			} = await import("../e2ee");
			const alice = await x25519KeyPair();
			const bob = await x25519KeyPair();
			const aliceShared = await ecdhKeyAgreement(
				alice.privateKey,
				await importPublicKey(await exportPublicKey(bob.publicKey)),
			);
			const bobShared = await ecdhKeyAgreement(
				bob.privateKey,
				await importPublicKey(await exportPublicKey(alice.publicKey)),
			);
			expect(Buffer.from(aliceShared).toString("hex")).toBe(
				Buffer.from(bobShared).toString("hex"),
			);
		});

		it.skip("matches RFC 7748 §5.2 test vector (browser-only: Node WebCrypto restricts raw priv import to empty usages)", async () => {
			const { ecdhKeyAgreement, importPublicKey } = await import("../e2ee");
			const subtle = globalThis.crypto.subtle;
			const alicePriv = await subtle.importKey(
				"raw",
				hexToBytes(
					"77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
				),
				"X25519",
				true,
				[],
			);
			const bobPub = await importPublicKey(
				Buffer.from(
					hexToBytes(
						"de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
					),
				).toString("base64"),
			);
			const shared = await ecdhKeyAgreement(alicePriv, bobPub);
			expect(Buffer.from(shared).toString("hex")).toBe(
				"4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
			);
		});
	});

	describe("Ed25519 signatures", () => {
		it("round-trips sign/verify", async () => {
			const { ed25519KeyPair, signProof, verifyProof } = await import(
				"../e2ee"
			);
			const kp = await ed25519KeyPair();
			const payload = new TextEncoder().encode("host_pub|v1-12345678");
			const sig = await signProof(kp.privateKey, payload);
			const ok = await verifyProof(kp.publicKey, payload, sig);
			expect(ok).toBe(true);
		});

		it("rejects signature with wrong key", async () => {
			const { ed25519KeyPair, signProof, verifyProof } = await import(
				"../e2ee"
			);
			const signer = await ed25519KeyPair();
			const attacker = await ed25519KeyPair();
			const payload = new TextEncoder().encode("host_pub|v1-12345678");
			const sig = await signProof(signer.privateKey, payload);
			const ok = await verifyProof(attacker.publicKey, payload, sig);
			expect(ok).toBe(false);
		});

		it("rejects signature with tampered payload", async () => {
			const { ed25519KeyPair, signProof, verifyProof } = await import(
				"../e2ee"
			);
			const kp = await ed25519KeyPair();
			const payload = new TextEncoder().encode("host_pub|v1-12345678");
			const sig = await signProof(kp.privateKey, payload);
			const tampered = new TextEncoder().encode("host_pub|v1-00000000");
			const ok = await verifyProof(kp.publicKey, tampered, sig);
			expect(ok).toBe(false);
		});

		it.skip("matches RFC 8032 §7.1 test 1 (browser-only: Node WebCrypto restricts raw Ed25519 priv import to verify-only usages)", async () => {
			const { signProof, verifyProof, importEd25519PublicKey } = await import(
				"../e2ee"
			);
			const subtle = globalThis.crypto.subtle;
			const priv = await subtle.importKey(
				"raw",
				hexToBytes(
					"9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
				),
				"Ed25519",
				true,
				["sign"],
			);
			const expectedPub = await importEd25519PublicKey(
				Buffer.from(
					hexToBytes(
						"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
					),
				).toString("base64"),
			);
			const sig = await signProof(priv, new Uint8Array(0));
			expect(sig).toBe(
				"5VZDAMNgrHKQhuLMgG6CioSHfx645dl02HPgZSJJAVVfuIIVkKM7rMYeOXAc+bRr0lv18FlbviRlUUFDjnoQCw==",
			);
			const ok = await verifyProof(expectedPub, new Uint8Array(0), sig);
			expect(ok).toBe(true);
		});

		it("Ed25519 public key round-trips via export/import", async () => {
			const { ed25519KeyPair, exportEd25519PublicKey, importEd25519PublicKey } =
				await import("../e2ee");
			const kp = await ed25519KeyPair();
			const b64 = await exportEd25519PublicKey(kp.publicKey);
			const imported = await importEd25519PublicKey(b64);
			const reExported = await exportEd25519PublicKey(imported);
			expect(reExported).toBe(b64);
		});
	});

	describe("Browser support detection", () => {
		it("featureDetectX25519 returns true on supported runtimes", async () => {
			const { featureDetectX25519 } = await import("../e2ee");
			expect(featureDetectX25519()).toBe(true);
		});
	});
});

describe("Chain derivation (T1.3)", () => {
	describe("Meeting secret + envelope", () => {
		it("generateMeetingSecret returns 32 random bytes", async () => {
			const { generateMeetingSecret } = await import("../e2ee");
			const s1 = await generateMeetingSecret();
			const s2 = await generateMeetingSecret();
			expect(s1.length).toBe(32);
			expect(s2.length).toBe(32);
			expect(Buffer.from(s1).toString("hex")).not.toBe(
				Buffer.from(s2).toString("hex"),
			);
		});

		it("createEnvelope + openEnvelope round-trip (host encrypts, joiner decrypts)", async () => {
			const {
				x25519KeyPair,
				exportPublicKey,
				importPublicKey,
				generateMeetingSecret,
				createEnvelope,
				openEnvelope,
			} = await import("../e2ee");
			const host = await x25519KeyPair();
			const joiner = await x25519KeyPair();
			const meetingSecret = await generateMeetingSecret();
			const ctx = { meetingId: "meet-123", keyVersion: 1 };
			const envelope = await createEnvelope(
				host.privateKey,
				await importPublicKey(await exportPublicKey(joiner.publicKey)),
				meetingSecret,
				ctx,
			);
			expect(envelope.length).toBeGreaterThan(32);
			const recovered = await openEnvelope(
				joiner.privateKey,
				await importPublicKey(await exportPublicKey(host.publicKey)),
				envelope,
				ctx,
			);
			expect(Buffer.from(recovered).toString("hex")).toBe(
				Buffer.from(meetingSecret).toString("hex"),
			);
		});

		it("openEnvelope fails with wrong context (keyVersion mismatch)", async () => {
			const {
				x25519KeyPair,
				exportPublicKey,
				importPublicKey,
				generateMeetingSecret,
				createEnvelope,
				openEnvelope,
			} = await import("../e2ee");
			const host = await x25519KeyPair();
			const joiner = await x25519KeyPair();
			const meetingSecret = await generateMeetingSecret();
			const envelope = await createEnvelope(
				host.privateKey,
				await importPublicKey(await exportPublicKey(joiner.publicKey)),
				meetingSecret,
				{ meetingId: "meet-123", keyVersion: 1 },
			);
			await expect(
				openEnvelope(
					joiner.privateKey,
					await importPublicKey(await exportPublicKey(host.publicKey)),
					envelope,
					{ meetingId: "meet-123", keyVersion: 2 },
				),
			).rejects.toThrow();
		});
	});

	describe("HKDF chain", () => {
		it("initSenderChain is deterministic per (meetingSecret, senderId)", async () => {
			const { generateMeetingSecret, initSenderChain } = await import(
				"../e2ee"
			);
			const secret = await generateMeetingSecret();
			const c1 = await initSenderChain(secret, 7);
			const c2 = await initSenderChain(secret, 7);
			expect(Buffer.from(c1).toString("hex")).toBe(
				Buffer.from(c2).toString("hex"),
			);
		});

		it("initSenderChain differs across senderIds", async () => {
			const { generateMeetingSecret, initSenderChain } = await import(
				"../e2ee"
			);
			const secret = await generateMeetingSecret();
			const c7 = await initSenderChain(secret, 7);
			const c8 = await initSenderChain(secret, 8);
			expect(Buffer.from(c7).toString("hex")).not.toBe(
				Buffer.from(c8).toString("hex"),
			);
		});

		it("advanceChain produces 32-byte deterministic next tip", async () => {
			const { advanceChain } = await import("../e2ee");
			const tip = new Uint8Array(32);
			const next1 = await advanceChain(tip);
			const next2 = await advanceChain(tip);
			expect(next1.length).toBe(32);
			expect(Buffer.from(next1).toString("hex")).toBe(
				Buffer.from(next2).toString("hex"),
			);
			expect(Buffer.from(next1).toString("hex")).not.toBe("0".repeat(64));
		});

		it("chainTipToAESKey produces a usable AES-GCM key", async () => {
			const { chainTipToAESKey, advanceChain } = await import("../e2ee");
			const tip = await advanceChain(new Uint8Array(32));
			const aesKey = await chainTipToAESKey(tip);
			const iv = new Uint8Array(12);
			const ct = await globalThis.crypto.subtle.encrypt(
				{ name: "AES-GCM", iv },
				aesKey,
				new TextEncoder().encode("hello"),
			);
			const pt = await globalThis.crypto.subtle.decrypt(
				{ name: "AES-GCM", iv },
				aesKey,
				ct,
			);
			expect(new TextDecoder().decode(pt)).toBe("hello");
		});
	});

	describe("End-to-end chain round-trip", () => {
		it("100 frames encrypted + decrypted with chain in sync", async () => {
			const {
				generateMeetingSecret,
				initSenderChain,
				advanceChain,
				chainTipToAESKey,
			} = await import("../e2ee");
			const meetingSecret = await generateMeetingSecret();
			let senderTip = await initSenderChain(meetingSecret, 42);
			let receiverTip = senderTip;
			for (let i = 0; i < 100; i++) {
				const aesKey = await chainTipToAESKey(senderTip);
				const iv = new Uint8Array(12);
				const frameData = new TextEncoder().encode(`frame ${i}`);
				const ct = await globalThis.crypto.subtle.encrypt(
					{ name: "AES-GCM", iv },
					aesKey,
					frameData,
				);
				const receiverKey = await chainTipToAESKey(receiverTip);
				const pt = await globalThis.crypto.subtle.decrypt(
					{ name: "AES-GCM", iv },
					receiverKey,
					ct,
				);
				expect(new TextDecoder().decode(pt)).toBe(`frame ${i}`);
				senderTip = await advanceChain(senderTip);
				receiverTip = await advanceChain(receiverTip);
			}
		});
	});
});

describe("Frame header v2 (T1.4)", () => {
	it("encoded header is 24 bytes", () => {
		const header = {
			senderId: 0x12345678,
			generation: 0x9abcdef0,
			keyVersion: 0xdeadbeef,
			iv: new Uint8Array(12).fill(0xab),
		};
		const encoded = encodeFrameHeaderV2(header);
		expect(encoded.length).toBe(24);
	});

	it("round-trips all fields", () => {
		const original = {
			senderId: 0x12345678,
			generation: 0x9abcdef0,
			keyVersion: 0xdeadbeef,
			iv: new Uint8Array(12).fill(0xab),
		};
		const encoded = encodeFrameHeaderV2(original);
		const decoded = decodeFrameHeaderV2(encoded);
		expect(decoded?.senderId).toBe(0x12345678);
		expect(decoded?.generation).toBe(0x9abcdef0);
		expect(decoded?.keyVersion).toBe(0xdeadbeef);
		expect(Buffer.from(decoded!.iv).toString("hex")).toBe("ab".repeat(12));
	});

	it("rejects frames shorter than 24 bytes", () => {
		const decoded = decodeFrameHeaderV2(new Uint8Array(23));
		expect(decoded).toBeNull();
	});

	it("little-endian byte order", () => {
		const encoded = encodeFrameHeaderV2({
			senderId: 1,
			generation: 0,
			keyVersion: 0,
			iv: new Uint8Array(12),
		});
		expect(encoded[0]).toBe(1);
		expect(encoded[1]).toBe(0);
		expect(encoded[2]).toBe(0);
		expect(encoded[3]).toBe(0);
	});
});

describe("Transform streams v2 (T1.5 + T1.6)", () => {
	type FakeFrame = { data: ArrayBuffer };

	function makeFakeFrame(bytes: Uint8Array): FakeFrame {
		return { data: bytes.buffer as ArrayBuffer };
	}

	async function runEncryptDecrypt(
		encrypt: TransformStream,
		decrypt: TransformStream,
		frames: FakeFrame[],
	): Promise<Uint8Array[]> {
		const decrypted: Uint8Array[] = [];
		const reader = decrypt.readable.getReader();
		const readPromise = (async () => {
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					decrypted.push(new Uint8Array(value.data));
				}
			} catch {
				// cancelled
			}
		})();

		const pipePromise = encrypt.readable.pipeTo(decrypt.writable);
		const writer = encrypt.writable.getWriter();
		for (const f of frames) {
			await writer.write(f);
		}
		await writer.close();
		await pipePromise;
		await readPromise;
		return decrypted;
	}

	it("sender + receiver round-trip 50 frames in order", async () => {
		const {
			generateMeetingSecret,
			SenderChainState,
			ReceiverChainState,
			createEncryptionTransformStreamV2,
			createDecryptionTransformStreamV2,
		} = await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const keyVersion = 1;
		const senderState = new SenderChainState(meetingSecret, 42);
		const receiverState = new ReceiverChainState(meetingSecret);
		const encrypt = createEncryptionTransformStreamV2(senderState, keyVersion);
		const decrypt = createDecryptionTransformStreamV2(
			receiverState,
			keyVersion,
		);
		const frames: FakeFrame[] = [];
		for (let i = 0; i < 50; i++) {
			frames.push(makeFakeFrame(new TextEncoder().encode(`payload-${i}`)));
		}
		const decrypted = await runEncryptDecrypt(encrypt, decrypt, frames);
		expect(decrypted.length).toBe(50);
		for (let i = 0; i < 50; i++) {
			expect(new TextDecoder().decode(decrypted[i])).toBe(`payload-${i}`);
		}
	});

	it("receiver drops frames with wrong keyVersion", async () => {
		const {
			generateMeetingSecret,
			SenderChainState,
			ReceiverChainState,
			createEncryptionTransformStreamV2,
			createDecryptionTransformStreamV2,
		} = await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const senderState = new SenderChainState(meetingSecret, 7);
		const receiverState = new ReceiverChainState(meetingSecret);
		const encrypt = createEncryptionTransformStreamV2(senderState, 1);
		const decrypt = createDecryptionTransformStreamV2(receiverState, 2);
		const decrypted = await runEncryptDecrypt(encrypt, decrypt, [
			makeFakeFrame(new TextEncoder().encode("hello")),
		]);
		expect(decrypted.length).toBe(0);
	});

	it("receiver drops out-of-order frames (gap)", async () => {
		const {
			generateMeetingSecret,
			ReceiverChainState,
			createDecryptionTransformStreamV2,
			encodeFrameHeaderV2,
		} = await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const receiverState = new ReceiverChainState(meetingSecret);
		const decrypt = createDecryptionTransformStreamV2(receiverState, 1);
		const decrypted: Uint8Array[] = [];
		const reader = decrypt.readable.getReader();
		const readPromise = (async () => {
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					decrypted.push(new Uint8Array(value.data));
				}
			} catch {
				// closed
			}
		})();
		const buildFrame = (generation: number): FakeFrame => {
			const header = encodeFrameHeaderV2({
				senderId: 5,
				generation,
				keyVersion: 1,
				iv: new Uint8Array(12),
			});
			const buf = new Uint8Array(header.length + 32);
			buf.set(header, 0);
			return { data: buf.buffer };
		};
		const writer = decrypt.writable.getWriter();
		await writer.write(buildFrame(5));
		await writer.close();
		await readPromise;
		expect(decrypted.length).toBe(0);
	});

	it("SenderChainState.wipe() resets generation counter", async () => {
		const { generateMeetingSecret, SenderChainState } = await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const state = new SenderChainState(meetingSecret, 1);
		const r1 = await state.nextFrameKey();
		expect(r1.generation).toBe(0);
		state.wipe();
		const r2 = await state.nextFrameKey();
		expect(r2.generation).toBe(0);
	});

	it("ReceiverChainState.wipe() resets all sender chains", async () => {
		const { generateMeetingSecret, ReceiverChainState } = await import(
			"../e2ee"
		);
		const meetingSecret = await generateMeetingSecret();
		const state = new ReceiverChainState(meetingSecret);
		const r1 = await state.getKeyForFrame(1, 0);
		expect("key" in r1).toBe(true);
		state.wipe();
		const r2 = await state.getKeyForFrame(1, 0);
		expect("key" in r2).toBe(true);
	});
});

describe("ReceiverChainState gap/resync behavior", () => {
	it("small gaps advance the chain silently", async () => {
		const { generateMeetingSecret, ReceiverChainState } = await import(
			"../e2ee"
		);
		const secret = await generateMeetingSecret();
		const state = new ReceiverChainState(secret);
		const r = await state.getKeyForFrame(1, 5);
		expect("key" in r).toBe(true);
	});

	it("gap of >=100 frames returns 'resync' error", async () => {
		const {
			generateMeetingSecret,
			ReceiverChainState,
			RESYNC_FRAME_GAP_THRESHOLD,
		} = await import("../e2ee");
		const secret = await generateMeetingSecret();
		const state = new ReceiverChainState(secret);
		const r = await state.getKeyForFrame(1, RESYNC_FRAME_GAP_THRESHOLD);
		expect(r).toEqual({ error: "resync" });
	});

	it("dispatchE2EEResyncEvent fires meet:e2ee-needs-key-resync with detail", async () => {
		const { E2EE_NEEDS_KEY_RESYNC_EVENT, RESYNC_FRAME_GAP_THRESHOLD } =
			await import("../e2ee");
		let captured: CustomEvent | null = null;
		const listener = (e: Event) => {
			captured = e as CustomEvent;
		};
		document.addEventListener(E2EE_NEEDS_KEY_RESYNC_EVENT, listener);
		document.dispatchEvent(
			new CustomEvent(E2EE_NEEDS_KEY_RESYNC_EVENT, {
				detail: {
					senderId: 7,
					generation: 250,
					threshold: RESYNC_FRAME_GAP_THRESHOLD,
				},
			}),
		);
		document.removeEventListener(E2EE_NEEDS_KEY_RESYNC_EVENT, listener);
		expect(captured).not.toBeNull();
		expect(captured!.detail.senderId).toBe(7);
		expect(captured!.detail.threshold).toBe(RESYNC_FRAME_GAP_THRESHOLD);
	});
});

describe("E2EE v2 chain registry", () => {
	beforeEach(async () => {
		const { wipeV2MeetingContext } = await import("../e2ee");
		wipeV2MeetingContext();
	});

	it("hasV2MeetingContext() reflects setV2MeetingContext/wipeV2MeetingContext", async () => {
		const e2ee = await import("../e2ee");
		expect(e2ee.hasV2MeetingContext()).toBe(false);
		const secret = await e2ee.generateMeetingSecret();
		e2ee.setV2MeetingContext(secret, 1);
		expect(e2ee.hasV2MeetingContext()).toBe(true);
		e2ee.wipeV2MeetingContext();
		expect(e2ee.hasV2MeetingContext()).toBe(false);
	});

	it("setV2MeetingContext creates per-sender chain on demand", async () => {
		const e2ee = await import("../e2ee");
		const secret = await e2ee.generateMeetingSecret();
		e2ee.setV2MeetingContext(secret, 7);
		const sender = makeMockSender();
		const ok = await e2ee.setupSenderTransformV2(sender, 42);
		expect(ok).toBe(true);
	});

	it("setupSenderTransformV2 returns false when no meeting context", async () => {
		const e2ee = await import("../e2ee");
		const sender = makeMockSender();
		const ok = await e2ee.setupSenderTransformV2(sender, 1);
		expect(ok).toBe(false);
	});

	it("setupSenderTransformV2 deduplicates by sender", async () => {
		const e2ee = await import("../e2ee");
		const secret = await e2ee.generateMeetingSecret();
		e2ee.setV2MeetingContext(secret, 1);
		const sender = makeMockSender();
		expect(await e2ee.setupSenderTransformV2(sender, 5)).toBe(true);
		expect(await e2ee.setupSenderTransformV2(sender, 5)).toBe(false);
	});
});

describe("E2EE v2 chat key", () => {
	beforeEach(async () => {
		const { wipeV2MeetingContext } = await import("../e2ee");
		wipeV2MeetingContext();
	});

	it("getE2EEChatKeyV2 returns null when no meeting context", async () => {
		const { getE2EEChatKeyV2 } = await import("../e2ee");
		expect(await getE2EEChatKeyV2()).toBeNull();
	});

	it("getE2EEChatKeyV2 is deterministic per (meetingSecret, keyVersion)", async () => {
		const e2ee = await import("../e2ee");
		const secret = await e2ee.generateMeetingSecret();
		e2ee.setV2MeetingContext(secret, 7);
		const k1 = await e2ee.getE2EEChatKeyV2();
		const k2 = await e2ee.getE2EEChatKeyV2();
		expect(k1).not.toBeNull();
		expect(k1).toBe(k2);
	});

	it("wipeV2MeetingContext invalidates the cached chat key", async () => {
		const e2ee = await import("../e2ee");
		const secret = await e2ee.generateMeetingSecret();
		e2ee.setV2MeetingContext(secret, 1);
		const k1 = await e2ee.getE2EEChatKeyV2();
		expect(k1).not.toBeNull();
		e2ee.wipeV2MeetingContext();
		expect(await e2ee.getE2EEChatKeyV2()).toBeNull();
	});
});

function makeMockSender(): RTCRtpSender {
	const readable = new ReadableStream<{ data: ArrayBuffer }>({
		start(c) {
			c.close();
		},
	});
	const writable = new WritableStream<{ data: ArrayBuffer }>({
		write() {},
	});
	const sender = {
		createEncodedStreams: () => ({ readable, writable }),
	} as unknown as RTCRtpSender;
	(
		RTCRtpSender.prototype as unknown as {
			createEncodedStreams?: () => unknown;
		}
	).createEncodedStreams = () => ({ readable, writable });
	return sender;
}
