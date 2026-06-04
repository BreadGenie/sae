type EncodedStreams = {
	readable?: ReadableStream;
	readableStream?: ReadableStream;
	writable?: WritableStream;
	writableStream?: WritableStream;
};

type SenderWithInsertableStreams = RTCRtpSender & {
	createEncodedStreams?: () => EncodedStreams;
};

type ReceiverWithInsertableStreams = RTCRtpReceiver & {
	createEncodedStreams?: () => EncodedStreams;
};

type E2EEFrameHeader = {
	keyVersion: string;
	sequenceNumber: number;
};

type SFUClientLike = {
	e2eePassphrase: string | null;
	connectionDetails: {
		e2eeKeyVersion: string | null;
		e2eeSalt?: string | null;
	};
};

type E2EEErrorCode = "decrypt-failure-threshold";

type E2EEErrorHandler = (payload: {
	code: E2EEErrorCode;
	failures: number;
}) => void;

const senderTransforms = new WeakSet<RTCRtpSender>();
const receiverTransforms = new WeakSet<RTCRtpReceiver>();
const senderSequenceNumbers = new WeakMap<RTCRtpSender, number>();
const receiverReplayWindows = new WeakMap<RTCRtpReceiver, Set<number>>();
const receiverDecryptFailures = new WeakMap<RTCRtpReceiver, number>();

let e2eeErrorHandler: E2EEErrorHandler | null = null;
const DECRYPT_FAILURE_ALERT_THRESHOLD = 30;

export function setE2EEErrorHandler(handler: E2EEErrorHandler | null): void {
	e2eeErrorHandler = handler;
}

function hasInsertableStreamSupport(): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	const sender = (globalThis.RTCRtpSender as any)?.prototype;
	if (!sender) {
		return false;
	}

	return typeof sender.createEncodedStreams === "function";
}

async function deriveE2EEKey(
	passphrase: string,
	salt: string,
): Promise<CryptoKey> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error("SubtleCrypto not available");
	}

	const passphraseKey = await subtle.importKey(
		"raw",
		new TextEncoder().encode(passphrase),
		"PBKDF2",
		false,
		["deriveBits"],
	);

	const derivedBits = await subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: new TextEncoder().encode(salt),
			iterations: 100000,
			hash: "SHA-256",
		},
		passphraseKey,
		256,
	);

	return subtle.importKey("raw", derivedBits, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}

const E2EE_KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateE2EEKey(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const chars: string[] = [];
	for (let i = 0; i < bytes.length; i++) {
		chars.push(E2EE_KEY_ALPHABET[bytes[i] % E2EE_KEY_ALPHABET.length]);
	}
	return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}`;
}

export function generateE2EEKeyVersion(): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `v1-${hex}`;
}

export async function computeE2EEKeyProof(
	keyVersion: string,
	key: string,
): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error("SubtleCrypto not available");
	}
	const payload = `${keyVersion}:${key}`;
	const hash = await subtle.digest(
		"SHA-256",
		new TextEncoder().encode(payload),
	);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function encodeFrameHeader(header: E2EEFrameHeader): Uint8Array {
	const encoded = new Uint8Array(10);
	const versionBytes = new TextEncoder().encode(header.keyVersion);
	encoded[0] = Math.min(versionBytes.length, 4);
	encoded.set(versionBytes.slice(0, 4), 1);
	const seqView = new DataView(encoded.buffer, 5, 4);
	seqView.setUint32(0, header.sequenceNumber, true);
	return encoded;
}

export function decodeFrameHeader(data: Uint8Array): E2EEFrameHeader | null {
	if (data.length < 10) {
		return null;
	}

	const versionLen = data[0];
	const version = new TextDecoder().decode(data.slice(1, 1 + versionLen));
	const seqView = new DataView(data.buffer, 5, 4);
	const sequenceNumber = seqView.getUint32(0, true);

	return { keyVersion: version, sequenceNumber };
}

function createEncryptionTransformStream(
	cryptoKey: CryptoKey,
	keyVersion: string,
	sender?: RTCRtpSender,
): TransformStream {
	return new TransformStream({
		async transform(encodedFrame, controller) {
			const subtle = globalThis.crypto?.subtle;
			if (!subtle || !cryptoKey) {
				controller.enqueue(encodedFrame);
				return;
			}

			const seq = (senderSequenceNumbers.get(sender!) ?? 0) + 1;
			if (sender) {
				senderSequenceNumbers.set(sender, seq);
			}

			const header = encodeFrameHeader({ keyVersion, sequenceNumber: seq });
			const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

			const encrypted = await subtle.encrypt(
				{
					name: "AES-GCM",
					iv,
				},
				cryptoKey,
				encodedFrame.data,
			);

			const newData = new Uint8Array(
				header.length + iv.length + encrypted.byteLength,
			);
			newData.set(header, 0);
			newData.set(new Uint8Array(iv), header.length);
			newData.set(new Uint8Array(encrypted), header.length + iv.length);

			encodedFrame.data = newData.buffer;
			controller.enqueue(encodedFrame);
		},
	});
}

function createDecryptionTransformStream(
	cryptoKey: CryptoKey,
	receiver?: RTCRtpReceiver,
): TransformStream {
	const replayWindow = new Set<number>();

	return new TransformStream({
		async transform(encodedFrame, controller) {
			const subtle = globalThis.crypto?.subtle;
			if (!subtle || !cryptoKey || encodedFrame.data.byteLength < 26) {
				controller.enqueue(encodedFrame);
				return;
			}

			const data = new Uint8Array(encodedFrame.data);
			const header = decodeFrameHeader(data);
			if (!header) {
				console.warn("E2EE: Invalid frame header");
				return;
			}

			if (replayWindow.has(header.sequenceNumber)) {
				console.warn(
					"E2EE: Replay detected for sequence",
					header.sequenceNumber,
				);
				return;
			}

			const ivStart = 10;
			const ivEnd = ivStart + 12;
			const encryptedStart = ivEnd;

			const iv = data.slice(ivStart, ivEnd);
			const encrypted = data.slice(encryptedStart);

			try {
				const decrypted = await subtle.decrypt(
					{
						name: "AES-GCM",
						iv,
					},
					cryptoKey,
					encrypted,
				);

				replayWindow.add(header.sequenceNumber);
				if (receiver) {
					receiverDecryptFailures.set(receiver, 0);
				}
				if (replayWindow.size > 128) {
					const minSeq = Math.min(...Array.from(replayWindow));
					replayWindow.delete(minSeq);
				}

				encodedFrame.data = decrypted;
				controller.enqueue(encodedFrame);
			} catch (error) {
				if (receiver) {
					const failures = (receiverDecryptFailures.get(receiver) ?? 0) + 1;
					receiverDecryptFailures.set(receiver, failures);
					if (
						failures === DECRYPT_FAILURE_ALERT_THRESHOLD &&
						typeof e2eeErrorHandler === "function"
					) {
						e2eeErrorHandler({
							code: "decrypt-failure-threshold",
							failures,
						});
					}
				}
				console.warn("E2EE: Decryption failed:", error);
			}
		},
	});
}

export async function setupSenderTransform(
	sender?: RTCRtpSender,
	sfuClient?: SFUClientLike,
): Promise<boolean> {
	if (!sender || senderTransforms.has(sender)) {
		return false;
	}

	if (!hasInsertableStreamSupport()) {
		return false;
	}

	if (
		!sfuClient?.e2eePassphrase ||
		!sfuClient.connectionDetails.e2eeKeyVersion
	) {
		return false;
	}

	const senderWithInsertable = sender as SenderWithInsertableStreams;
	const streams = senderWithInsertable.createEncodedStreams?.();
	if (!streams) {
		return false;
	}

	const readable = streams.readable || streams.readableStream;
	const writable = streams.writable || streams.writableStream;
	if (!readable || !writable) {
		return false;
	}

	try {
		const roomSalt =
			sfuClient.connectionDetails.e2eeSalt ||
			`meet-e2ee-${sfuClient.connectionDetails.e2eeKeyVersion}`;
		const cryptoKey = await deriveE2EEKey(sfuClient.e2eePassphrase, roomSalt);

		readable
			.pipeThrough(
				createEncryptionTransformStream(
					cryptoKey,
					sfuClient.connectionDetails.e2eeKeyVersion,
					sender,
				),
			)
			.pipeTo(writable)
			.catch((error: unknown) => {
				console.warn("E2EE sender transform pipeline failed:", error);
			});

		senderTransforms.add(sender);
		return true;
	} catch (error) {
		console.error("E2EE: Failed to setup sender transform:", error);
		return false;
	}
}

export async function setupReceiverTransform(
	receiver?: RTCRtpReceiver,
	sfuClient?: SFUClientLike,
): Promise<boolean> {
	if (!receiver || receiverTransforms.has(receiver)) {
		return false;
	}

	if (!hasInsertableStreamSupport()) {
		return false;
	}

	if (
		!sfuClient?.e2eePassphrase ||
		!sfuClient.connectionDetails.e2eeKeyVersion
	) {
		return false;
	}

	const receiverWithInsertable = receiver as ReceiverWithInsertableStreams;
	const streams = receiverWithInsertable.createEncodedStreams?.();
	if (!streams) {
		return false;
	}

	const readable = streams.readable || streams.readableStream;
	const writable = streams.writable || streams.writableStream;
	if (!readable || !writable) {
		return false;
	}

	try {
		const roomSalt =
			sfuClient.connectionDetails.e2eeSalt ||
			`meet-e2ee-${sfuClient.connectionDetails.e2eeKeyVersion}`;
		const cryptoKey = await deriveE2EEKey(sfuClient.e2eePassphrase, roomSalt);

		readable
			.pipeThrough(createDecryptionTransformStream(cryptoKey, receiver))
			.pipeTo(writable)
			.catch((error: unknown) => {
				console.warn("E2EE receiver transform pipeline failed:", error);
			});

		receiverTransforms.add(receiver);
		return true;
	} catch (error) {
		console.error("E2EE: Failed to setup receiver transform:", error);
		return false;
	}
}
