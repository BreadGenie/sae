import { beforeAll, describe, expect, it, vi } from "vitest";

// Mock RTCRtpSender and RTCRtpReceiver
beforeAll(() => {
	if (typeof globalThis !== "undefined") {
		globalThis.RTCRtpSender = class RTCRtpSender {} as never;
		globalThis.RTCRtpReceiver = class RTCRtpReceiver {} as never;
	}
});

import { setupReceiverTransform, setupSenderTransform } from "../e2ee";

describe("E2EE Encryption/Decryption", () => {
	const mockSFUClient = {
		e2eePassphrase: "test-passphrase-123",
		connectionDetails: {
			e2eeKeyVersion: "v1",
		},
	};

	const mockInvalidSFUClient = {
		e2eePassphrase: null,
		connectionDetails: {
			e2eeKeyVersion: null,
		},
	};

	describe("setupSenderTransform", () => {
		it("rejects setup when passphrase is missing", async () => {
			const sender = {} as RTCRtpSender;
			const result = await setupSenderTransform(
				sender,
				mockInvalidSFUClient as never,
			);
			expect(result).toBe(false);
		});

		it("rejects setup when keyVersion is missing", async () => {
			const sender = {} as RTCRtpSender;
			const invalidClient = {
				e2eePassphrase: "test",
				connectionDetails: { e2eeKeyVersion: null },
			};
			const result = await setupSenderTransform(sender, invalidClient as never);
			expect(result).toBe(false);
		});

		it("rejects setup when sender already has transform", async () => {
			const sender = {
				createEncodedStreams: vi.fn(() => ({
					readable: {
						pipeThrough: vi.fn().mockReturnThis(),
						pipeTo: vi.fn().mockResolvedValue(undefined),
					},
					writable: {},
				})),
			} as unknown as RTCRtpSender;

			const result1 = await setupSenderTransform(
				sender,
				mockSFUClient as never,
			);
			const result2 = await setupSenderTransform(
				sender,
				mockSFUClient as never,
			);

			expect(result2).toBe(false);
		});

		it("rejects setup when insertable streams not supported", async () => {
			const sender = {} as RTCRtpSender;
			const result = await setupSenderTransform(sender, mockSFUClient as never);
			expect(result).toBe(false);
		});
	});

	describe("setupReceiverTransform", () => {
		it("rejects setup when passphrase is missing", async () => {
			const receiver = {} as RTCRtpReceiver;
			const result = await setupReceiverTransform(
				receiver,
				mockInvalidSFUClient as never,
			);
			expect(result).toBe(false);
		});

		it("rejects setup when keyVersion is missing", async () => {
			const receiver = {} as RTCRtpReceiver;
			const invalidClient = {
				e2eePassphrase: "test",
				connectionDetails: { e2eeKeyVersion: null },
			};
			const result = await setupReceiverTransform(
				receiver,
				invalidClient as never,
			);
			expect(result).toBe(false);
		});

		it("rejects setup when receiver already has transform", async () => {
			const receiver = {
				createEncodedStreams: vi.fn(() => ({
					readable: {
						pipeThrough: vi.fn().mockReturnThis(),
						pipeTo: vi.fn().mockResolvedValue(undefined),
					},
					writable: {},
				})),
			} as unknown as RTCRtpReceiver;

			const result1 = await setupReceiverTransform(
				receiver,
				mockSFUClient as never,
			);
			const result2 = await setupReceiverTransform(
				receiver,
				mockSFUClient as never,
			);

			expect(result2).toBe(false);
		});

		it("rejects setup when insertable streams not supported", async () => {
			const receiver = {} as RTCRtpReceiver;
			const result = await setupReceiverTransform(
				receiver,
				mockSFUClient as never,
			);
			expect(result).toBe(false);
		});
	});

	describe("Frame encryption format", () => {
		it("frame header encodes keyVersion and sequence number", async () => {
			const { encodeFrameHeader, decodeFrameHeader } = await import("../e2ee");

			const header = { keyVersion: "v1", sequenceNumber: 42 };
			const encoded = encodeFrameHeader(header);

			expect(encoded.length).toBeGreaterThanOrEqual(10);
			expect(encoded[0]).toBe(2);
			expect(encoded[1]).toBe(118);
			expect(encoded[2]).toBe(49);

			const decoded = decodeFrameHeader(encoded);
			expect(decoded?.keyVersion).toBe("v1");
			expect(decoded?.sequenceNumber).toBe(42);
		});

		it("rejects frame with invalid header size", async () => {
			const { decodeFrameHeader } = await import("../e2ee");
			const tooSmall = new Uint8Array(5);
			const decoded = decodeFrameHeader(tooSmall);
			expect(decoded).toBeNull();
		});

		it("handles keyVersion up to 4 bytes", async () => {
			const { encodeFrameHeader, decodeFrameHeader } = await import("../e2ee");

			const longVersion = "longkey";
			const header = { keyVersion: longVersion, sequenceNumber: 1000 };
			const encoded = encodeFrameHeader(header);
			const decoded = decodeFrameHeader(encoded);

			expect(decoded?.keyVersion.startsWith("long")).toBe(true);
		});
	});
});
