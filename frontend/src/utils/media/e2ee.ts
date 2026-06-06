function zeroUint8Array(arr: Uint8Array): void {
	arr.fill(0);
}

type EncodedStreams = {
	readable?: ReadableStream;
	readableStream?: ReadableStream;
	writable?: WritableStream;
	writableStream?: WritableStream;
};

type EncodedFrameLike = {
	data: ArrayBuffer;
	type?: string;
};

type SenderWithInsertableStreams = RTCRtpSender & {
	createEncodedStreams?: () => EncodedStreams;
};

type ReceiverWithInsertableStreams = RTCRtpReceiver & {
	createEncodedStreams?: () => EncodedStreams;
};

type TransformableSender = RTCRtpSender & {
	transform?: unknown;
};

type TransformableReceiver = RTCRtpReceiver & {
	transform?: unknown;
};

type RTCRtpScriptTransformConstructor = new (
	worker: Worker,
	options: Record<string, unknown>,
) => unknown;

type E2EETransformCapability =
	| "legacy-insertable-streams"
	| "rtp-script-transform"
	| "none";

function getSubtle(): SubtleCrypto {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error("SubtleCrypto not available");
	}
	return subtle;
}

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
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

function encodeInfo(s: string): Uint8Array<ArrayBuffer> {
	const src = new TextEncoder().encode(s);
	const out = new Uint8Array(src.length);
	out.set(src);
	return out;
}

export function formatFingerprint(publicKeyB64: string): string {
	try {
		const raw = Uint8Array.from(atob(publicKeyB64), (c) => c.charCodeAt(0));
		const hex = Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join(
			"",
		);
		const groups: string[] = [];
		for (let i = 0; i < hex.length; i += 8) {
			groups.push(hex.slice(i, i + 8));
		}
		return groups.slice(0, 4).join(" ");
	} catch {
		return publicKeyB64;
	}
}

export async function x25519KeyPair(): Promise<CryptoKeyPair> {
	return getSubtle().generateKey("X25519", true, ["deriveBits"]);
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
	const raw = await getSubtle().exportKey("raw", key);
	return bufferToBase64(raw);
}

export async function importPublicKey(b64: string): Promise<CryptoKey> {
	return getSubtle().importKey("raw", base64ToBytes(b64), "X25519", true, []);
}

export async function exportEd25519PublicKey(key: CryptoKey): Promise<string> {
	const raw = await getSubtle().exportKey("raw", key);
	return bufferToBase64(raw);
}

export async function importEd25519PublicKey(b64: string): Promise<CryptoKey> {
	return getSubtle().importKey(
		"raw",
		base64ToBytes(b64),
		{ name: "Ed25519" },
		true,
		["verify"],
	);
}

export async function ed25519KeyPair(): Promise<CryptoKeyPair> {
	return getSubtle().generateKey("Ed25519", true, ["sign", "verify"]);
}

export async function signProof(
	privateKey: CryptoKey,
	payload: Uint8Array<ArrayBuffer>,
): Promise<string> {
	const sig = await getSubtle().sign({ name: "Ed25519" }, privateKey, payload);
	return bufferToBase64(sig);
}

export async function verifyProof(
	publicKey: CryptoKey,
	payload: Uint8Array<ArrayBuffer>,
	signatureB64: string,
): Promise<boolean> {
	return getSubtle().verify(
		{ name: "Ed25519" },
		publicKey,
		base64ToBytes(signatureB64),
		payload,
	);
}

export async function ecdhKeyAgreement(
	localPrivate: CryptoKey,
	remotePublic: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
	const bits = await getSubtle().deriveBits(
		{ name: "X25519", public: remotePublic },
		localPrivate,
		256,
	);
	const out = new Uint8Array(32);
	out.set(new Uint8Array(bits));
	return out;
}

export async function signWithEd25519(
	privateKey: CryptoKey,
	data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	const sig = await getSubtle().sign({ name: "Ed25519" }, privateKey, data);
	const out = new Uint8Array(sig.byteLength);
	out.set(new Uint8Array(sig));
	return out;
}

async function verifyWithEd25519(
	publicKey: CryptoKey,
	signature: Uint8Array<ArrayBuffer>,
	data: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
	return getSubtle().verify({ name: "Ed25519" }, publicKey, signature, data);
}

async function hkdfBits(
	ikm: Uint8Array<ArrayBuffer>,
	info: Uint8Array<ArrayBuffer>,
	length = 32,
): Promise<Uint8Array<ArrayBuffer>> {
	const subtle = getSubtle();
	const baseKey = await subtle.importKey("raw", ikm, "HKDF", false, [
		"deriveBits",
	]);
	const bits = await subtle.deriveBits(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
		baseKey,
		length * 8,
	);
	const out = new Uint8Array(length);
	out.set(new Uint8Array(bits));
	return out;
}

async function hkdfToAESKey(
	ikm: Uint8Array<ArrayBuffer>,
	info: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
	const subtle = getSubtle();
	const baseKey = await subtle.importKey("raw", ikm, "HKDF", false, [
		"deriveKey",
	]);
	return subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: new Uint8Array(0),
			info,
		},
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export async function generateMeetingSecret(): Promise<
	Uint8Array<ArrayBuffer>
> {
	return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

export async function initSenderChain(
	meetingSecret: Uint8Array<ArrayBuffer>,
	senderId: number,
	mediaType: string,
): Promise<Uint8Array<ArrayBuffer>> {
	return hkdfBits(
		meetingSecret,
		encodeInfo(`meet-e2ee|sender|${senderId}|${mediaType}`),
	);
}

export async function advanceChain(
	chainTip: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	return hkdfBits(chainTip, encodeInfo("meet-e2ee|frame"));
}

export async function chainTipToAESKey(
	chainTip: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
	return hkdfToAESKey(chainTip, encodeInfo("meet-e2ee|aes"));
}

async function deriveFrameKey(
	meetingSecret: Uint8Array<ArrayBuffer>,
	senderId: number,
	mediaType: string,
	generation: number,
): Promise<CryptoKey> {
	const info = encodeInfo(
		`meet-e2ee|frame|${senderId}|${mediaType}|${generation}`,
	);
	return hkdfToAESKey(meetingSecret, info);
}

interface OpenEnvelopeResult {
	responderX25519Pub: Uint8Array<ArrayBuffer>;
	responderSigningPub: Uint8Array<ArrayBuffer>;
	meetingSecret: Uint8Array<ArrayBuffer>;
}

class EnvelopeSignatureError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EnvelopeSignatureError";
	}
}

const ENVELOPE_HEADER_SIZE = 32 + 32;
const ENVELOPE_IV_SIZE = 12;
const ENVELOPE_SIGNATURE_SIZE = 64;
const ENVELOPE_MIN_SIZE =
	ENVELOPE_HEADER_SIZE + ENVELOPE_IV_SIZE + ENVELOPE_SIGNATURE_SIZE;

function concatBytes(
	parts: Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
	const total = parts.reduce((n, p) => n + p.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.byteLength;
	}
	return out;
}

export async function createSignedEnvelope(
	hostPriv: CryptoKey,
	hostSigningPriv: CryptoKey,
	joinerPub: CryptoKey,
	responderX25519Pub: Uint8Array<ArrayBuffer>,
	responderSigningPub: Uint8Array<ArrayBuffer>,
	meetingSecret: Uint8Array<ArrayBuffer>,
	context: { meetingId: string; keyVersion: number },
): Promise<Uint8Array<ArrayBuffer>> {
	const shared = await ecdhKeyAgreement(hostPriv, joinerPub);
	const info = encodeInfo(
		`meet-e2ee|envelope|${context.meetingId}|${context.keyVersion}`,
	);
	const aesKey = await hkdfToAESKey(shared, info);
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await getSubtle().encrypt(
		{ name: "AES-GCM", iv },
		aesKey,
		meetingSecret,
	);
	const cipherBytes = new Uint8Array(ciphertext.byteLength);
	cipherBytes.set(new Uint8Array(ciphertext));
	const ctxBytes = encodeInfo(`|${context.meetingId}|${context.keyVersion}`);
	const signedData = concatBytes([
		responderX25519Pub,
		responderSigningPub,
		iv,
		cipherBytes,
		ctxBytes,
	]);
	const signature = await signWithEd25519(hostSigningPriv, signedData);
	const result = new Uint8Array(
		ENVELOPE_HEADER_SIZE +
			ENVELOPE_IV_SIZE +
			cipherBytes.byteLength +
			ENVELOPE_SIGNATURE_SIZE,
	);
	result.set(responderX25519Pub, 0);
	result.set(responderSigningPub, 32);
	result.set(iv, ENVELOPE_HEADER_SIZE);
	result.set(cipherBytes, ENVELOPE_HEADER_SIZE + ENVELOPE_IV_SIZE);
	result.set(
		signature,
		ENVELOPE_HEADER_SIZE + ENVELOPE_IV_SIZE + cipherBytes.byteLength,
	);
	return result;
}

export async function openSignedEnvelope(
	joinerPriv: CryptoKey,
	hostPub: CryptoKey,
	hostSigningPub: CryptoKey,
	signedEnvelope: Uint8Array<ArrayBuffer>,
	context: { meetingId: string; keyVersion: number },
): Promise<OpenEnvelopeResult> {
	if (signedEnvelope.byteLength < ENVELOPE_MIN_SIZE) {
		throw new EnvelopeSignatureError("envelope too short");
	}
	const responderX25519Pub = signedEnvelope.slice(0, 32);
	const responderSigningPub = signedEnvelope.slice(32, 64);
	const iv = signedEnvelope.slice(
		ENVELOPE_HEADER_SIZE,
		ENVELOPE_HEADER_SIZE + ENVELOPE_IV_SIZE,
	);
	const cipherEnd = signedEnvelope.byteLength - ENVELOPE_SIGNATURE_SIZE;
	const ciphertext = signedEnvelope.slice(
		ENVELOPE_HEADER_SIZE + ENVELOPE_IV_SIZE,
		cipherEnd,
	);
	const signature = signedEnvelope.slice(cipherEnd);
	const ctxBytes = encodeInfo(`|${context.meetingId}|${context.keyVersion}`);
	const signedData = concatBytes([
		responderX25519Pub,
		responderSigningPub,
		iv,
		ciphertext,
		ctxBytes,
	]);
	const ok = await verifyWithEd25519(hostSigningPub, signature, signedData);
	if (!ok) {
		throw new EnvelopeSignatureError("envelope signature verification failed");
	}
	const shared = await ecdhKeyAgreement(joinerPriv, hostPub);
	const info = encodeInfo(
		`meet-e2ee|envelope|${context.meetingId}|${context.keyVersion}`,
	);
	const aesKey = await hkdfToAESKey(shared, info);
	const meetingSecret = await getSubtle().decrypt(
		{ name: "AES-GCM", iv },
		aesKey,
		ciphertext,
	);
	const out = new Uint8Array(meetingSecret.byteLength);
	out.set(new Uint8Array(meetingSecret));
	return {
		responderX25519Pub,
		responderSigningPub,
		meetingSecret: out,
	};
}

export async function featureDetectX25519(): Promise<boolean> {
	if (typeof globalThis.crypto?.subtle === "undefined") {
		return false;
	}
	try {
		const subtle = globalThis.crypto.subtle;
		const test = new Uint8Array(32);
		await subtle.importKey("raw", test, "X25519", true, []);
		return true;
	} catch {
		return false;
	}
}

export function generateE2EEKeyVersion(): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `${hex}`;
}

const FRAME_HEADER_FIXED_SIZE = 24;
const FRAME_SIGNATURE_SIZE = 64;
const FRAME_HEADER_TOTAL = FRAME_HEADER_FIXED_SIZE + FRAME_SIGNATURE_SIZE;
const AES_GCM_TAG_SIZE = 16;
const MIN_FRAME_PLAINTEXT_SIZE = 1;
const FRAME_MAGIC = new Uint8Array([0x4d, 0x45, 0x32, 0x45]); // ME2E
const EMPTY_FRAME_MAGIC = new Uint8Array(0);
const MIN_SIGNED_ENCRYPTED_FRAME_SIZE =
	FRAME_MAGIC.byteLength +
	FRAME_HEADER_TOTAL +
	AES_GCM_TAG_SIZE +
	MIN_FRAME_PLAINTEXT_SIZE;
const FRAME_GENERATION_KEYFRAME_FLAG = 0x80000000;
const FRAME_GENERATION_MASK = 0x7fffffff;
const VIDEO_CLEAR_PREFIX_SIZE = 1;

type E2EEFrameHeader = {
	senderId: number;
	generation: number;
	frameType?: string;
	keyVersion: number;
	iv: Uint8Array<ArrayBuffer>;
};

export function encodeFrameHeader(header: E2EEFrameHeader): Uint8Array {
	const encoded = new Uint8Array(FRAME_HEADER_FIXED_SIZE);
	const view = new DataView(encoded.buffer);
	const generation =
		(header.generation & FRAME_GENERATION_MASK) |
		(header.frameType === "key" ? FRAME_GENERATION_KEYFRAME_FLAG : 0);
	view.setUint32(0, header.senderId, true);
	view.setUint32(4, generation, true);
	view.setUint32(8, header.keyVersion, true);
	encoded.set(header.iv.subarray(0, 12), 12);
	return encoded;
}

export function decodeFrameHeader(data: Uint8Array): E2EEFrameHeader | null {
	if (data.length < FRAME_HEADER_FIXED_SIZE) {
		return null;
	}
	const view = new DataView(
		data.buffer,
		data.byteOffset,
		FRAME_HEADER_FIXED_SIZE,
	);
	const iv = new Uint8Array(12);
	iv.set(data.subarray(12, 24));
	const encodedGeneration = view.getUint32(4, true);
	return {
		senderId: view.getUint32(0, true),
		generation: encodedGeneration & FRAME_GENERATION_MASK,
		frameType:
			(encodedGeneration & FRAME_GENERATION_KEYFRAME_FLAG) !== 0
				? "key"
				: "delta",
		keyVersion: view.getUint32(8, true),
		iv,
	};
}

function buildSignedFramePayload(
	headerFixed: Uint8Array<ArrayBuffer>,
	clearPrefix: Uint8Array<ArrayBuffer>,
	frameMagic: Uint8Array<ArrayBuffer>,
	ciphertext: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
	return concatBytes([headerFixed, clearPrefix, frameMagic, ciphertext]);
}

function hasFrameMagic(data: Uint8Array, offset: number): boolean {
	if (data.length < offset + FRAME_MAGIC.byteLength) return false;
	for (let i = 0; i < FRAME_MAGIC.byteLength; i += 1) {
		if (data[offset + i] !== FRAME_MAGIC[i]) return false;
	}
	return true;
}

function getClearPrefixSize(mediaType: string): number {
	return mediaType === "video" ? VIDEO_CLEAR_PREFIX_SIZE : 0;
}

function getClearPrefix(
	data: ArrayBuffer,
	prefixSize: number,
): Uint8Array<ArrayBuffer> {
	if (prefixSize === 0) return new Uint8Array(0);
	const source = new Uint8Array(data);
	const prefix = new Uint8Array(Math.min(prefixSize, source.byteLength));
	prefix.set(source.subarray(0, prefix.byteLength));
	return prefix;
}

export class SenderChainState {
	readonly senderId: number;
	readonly mediaType: string;
	private readonly meetingSecret: Uint8Array<ArrayBuffer>;
	private readonly signingPrivateKey: CryptoKey;
	private nextGeneration = 0;

	constructor(
		meetingSecret: Uint8Array<ArrayBuffer>,
		senderId: number,
		mediaType: string,
		signingPrivateKey: CryptoKey,
	) {
		this.meetingSecret = meetingSecret;
		this.senderId = senderId;
		this.mediaType = mediaType;
		this.signingPrivateKey = signingPrivateKey;
	}

	async nextFrameKey(): Promise<{ key: CryptoKey; generation: number }> {
		const generation = this.nextGeneration++;
		const key = await deriveFrameKey(
			this.meetingSecret,
			this.senderId,
			this.mediaType,
			generation,
		);
		return { key, generation };
	}

	async signFramePayload(
		headerFixed: Uint8Array<ArrayBuffer>,
		clearPrefix: Uint8Array<ArrayBuffer>,
		frameMagicOrCiphertext: Uint8Array<ArrayBuffer>,
		maybeCiphertext?: Uint8Array<ArrayBuffer>,
	): Promise<Uint8Array<ArrayBuffer>> {
		const frameMagic = maybeCiphertext
			? frameMagicOrCiphertext
			: EMPTY_FRAME_MAGIC;
		const ciphertext = maybeCiphertext ?? frameMagicOrCiphertext;
		const signed = buildSignedFramePayload(
			headerFixed,
			clearPrefix,
			frameMagic,
			ciphertext,
		);
		return signWithEd25519(this.signingPrivateKey, signed);
	}

	wipe(): void {
		zeroUint8Array(this.meetingSecret);
		this.nextGeneration = 0;
	}
}

const REPLAY_WINDOW = 3;

export class ReceiverChainState {
	private readonly meetingSecret: Uint8Array<ArrayBuffer>;
	private readonly highWaterMark = new Map<string, number>();
	private readonly signingPubs = new Map<number, CryptoKey>();
	private readonly seenFrames = new Map<string, Set<number>>();
	private readonly frameKeyCache = new Map<
		string,
		{ generation: number; key: CryptoKey }
	>();

	constructor(meetingSecret: Uint8Array<ArrayBuffer>) {
		this.meetingSecret = meetingSecret;
	}

	setSenderSigningPub(senderId: number, pub: CryptoKey): void {
		this.signingPubs.set(senderId, pub);
	}

	hasSenderSigningPub(senderId: number): boolean {
		return this.signingPubs.has(senderId);
	}

	async getKeyForFrame(
		senderId: number,
		mediaType: string,
		generation: number,
	): Promise<{ key: CryptoKey } | { error: "replay" }> {
		const key = `${senderId}:${mediaType}`;
		const hwm = this.highWaterMark.get(key) ?? -1;
		if (generation <= hwm - REPLAY_WINDOW) {
			return { error: "replay" };
		}
		const seen = this.seenFrames.get(key) ?? new Set<number>();
		if (seen.has(generation)) {
			return { error: "replay" };
		}
		if (generation > hwm) {
			this.highWaterMark.set(key, generation);
			const pruneAtOrBefore = generation - REPLAY_WINDOW;
			for (const seenGeneration of seen) {
				if (seenGeneration <= pruneAtOrBefore) {
					seen.delete(seenGeneration);
				}
			}
		}
		seen.add(generation);
		this.seenFrames.set(key, seen);
		const cached = this.frameKeyCache.get(key);
		let aesKey: CryptoKey;
		if (cached && cached.generation === generation) {
			aesKey = cached.key;
		} else {
			aesKey = await deriveFrameKey(
				this.meetingSecret,
				senderId,
				mediaType,
				generation,
			);
			this.frameKeyCache.set(key, { generation, key: aesKey });
		}
		return { key: aesKey };
	}

	async verifyFrameSignature(
		senderId: number,
		headerFixed: Uint8Array<ArrayBuffer>,
		clearPrefix: Uint8Array<ArrayBuffer>,
		frameMagicOrCiphertext: Uint8Array<ArrayBuffer>,
		ciphertextOrSignature: Uint8Array<ArrayBuffer>,
		maybeSignature?: Uint8Array<ArrayBuffer>,
	): Promise<boolean> {
		const pub = this.signingPubs.get(senderId);
		if (!pub) return false;
		const frameMagic = maybeSignature
			? frameMagicOrCiphertext
			: EMPTY_FRAME_MAGIC;
		const ciphertext = maybeSignature
			? ciphertextOrSignature
			: frameMagicOrCiphertext;
		const signature = maybeSignature ?? ciphertextOrSignature;
		const signed = buildSignedFramePayload(
			headerFixed,
			clearPrefix,
			frameMagic,
			ciphertext,
		);
		return verifyWithEd25519(pub, signature, signed);
	}

	wipe(): void {
		zeroUint8Array(this.meetingSecret);
		this.highWaterMark.clear();
		this.signingPubs.clear();
		this.seenFrames.clear();
		this.frameKeyCache.clear();
	}
}

export function createEncryptionTransformStream(
	chainState: SenderChainState,
	keyVersion: number,
): TransformStream {
	return new TransformStream({
		async transform(encodedFrame, controller) {
			const subtle = getSubtle();
			const typedFrame = encodedFrame as EncodedFrameLike;
			const clearPrefix = getClearPrefix(
				typedFrame.data,
				getClearPrefixSize(chainState.mediaType),
			);
			try {
				const { key, generation } = await chainState.nextFrameKey();
				const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
				const encrypted = await subtle.encrypt(
					{ name: "AES-GCM", iv },
					key,
					encodedFrame.data,
				);
				const header = encodeFrameHeader({
					senderId: chainState.senderId,
					generation,
					frameType: typedFrame.type,
					keyVersion,
					iv,
				});
				const headerBuf = new Uint8Array(header.length);
				headerBuf.set(header);
				const cipherBytes = new Uint8Array(encrypted.byteLength);
				cipherBytes.set(new Uint8Array(encrypted));
				const signature = await chainState.signFramePayload(
					headerBuf,
					clearPrefix,
					FRAME_MAGIC,
					cipherBytes,
				);
				const totalSize =
					clearPrefix.byteLength +
					FRAME_MAGIC.byteLength +
					headerBuf.length +
					signature.byteLength +
					cipherBytes.byteLength;
				const newData = new Uint8Array(totalSize);
				newData.set(clearPrefix, 0);
				newData.set(FRAME_MAGIC, clearPrefix.byteLength);
				newData.set(headerBuf, clearPrefix.byteLength + FRAME_MAGIC.byteLength);
				newData.set(
					signature,
					clearPrefix.byteLength + FRAME_MAGIC.byteLength + headerBuf.length,
				);
				newData.set(
					cipherBytes,
					clearPrefix.byteLength +
						FRAME_MAGIC.byteLength +
						headerBuf.length +
						signature.byteLength,
				);
				encodedFrame.data = newData.buffer;
				controller.enqueue(encodedFrame);
			} catch (error) {
				console.warn("E2EE: encryption failed, dropping frame:", error);
			}
		},
	});
}

export function createDecryptionTransformStream(
	chainState: ReceiverChainState,
	expectedKeyVersion: number,
	_receiver: RTCRtpReceiver | undefined,
	mediaType: string,
): TransformStream {
	return new TransformStream({
		async transform(encodedFrame, controller) {
			const subtle = getSubtle();
			const data = new Uint8Array(encodedFrame.data);
			const clearPrefixSize = getClearPrefixSize(mediaType);
			if (data.length < clearPrefixSize + MIN_SIGNED_ENCRYPTED_FRAME_SIZE) {
				return;
			}
			const clearPrefix = data.slice(0, clearPrefixSize);
			const magicOffset = clearPrefixSize;
			if (!hasFrameMagic(data, magicOffset)) {
				return;
			}
			const frameMagic = data.slice(
				magicOffset,
				magicOffset + FRAME_MAGIC.byteLength,
			);
			const headerOffset = magicOffset + FRAME_MAGIC.byteLength;
			const headerEnd = headerOffset + FRAME_HEADER_FIXED_SIZE;
			const signatureEnd = headerOffset + FRAME_HEADER_TOTAL;
			const header = decodeFrameHeader(data.subarray(headerOffset, headerEnd));
			if (!header) {
				return;
			}
			if (header.keyVersion !== expectedKeyVersion) {
				console.warn("[E2EE] decrypt: key version mismatch", {
					header: header.keyVersion,
					expected: expectedKeyVersion,
					senderId: header.senderId,
					mediaType,
				});
				return;
			}
			const headerFixed = new Uint8Array(FRAME_HEADER_FIXED_SIZE);
			headerFixed.set(data.subarray(headerOffset, headerEnd));
			const signature = data.slice(headerEnd, signatureEnd);
			const ciphertext = data.slice(signatureEnd);
			const sigOk = await chainState.verifyFrameSignature(
				header.senderId,
				headerFixed,
				clearPrefix,
				frameMagic,
				ciphertext,
				signature,
			);
			if (!sigOk) {
				console.warn("[E2EE] decrypt: signature verification failed", {
					senderId: header.senderId,
					mediaType,
				});
				return;
			}
			const result = await chainState.getKeyForFrame(
				header.senderId,
				mediaType,
				header.generation,
			);
			if ("error" in result) {
				return;
			}
			try {
				const decrypted = await subtle.decrypt(
					{ name: "AES-GCM", iv: header.iv },
					result.key,
					ciphertext,
				);
				encodedFrame.data = decrypted;
				controller.enqueue(encodedFrame);
			} catch (error) {
				console.warn("E2EE: decrypt failed, dropping frame:", error);
			}
		},
	});
}

// ---------------------------------------------------------------------------
// E2EE chain registry
//
// Module-level singleton that tracks the meeting secret
// (populated when the handshake completes via
// `meet:e2ee-handshake-complete`) and the per-sender chain state.
//
// Producers/consumers register themselves with the registry at
// `createProducer` / consumer-creation time. The transform isn't
// actually installed until the meeting secret is available; this is
// the lazy-activation pattern.
// ---------------------------------------------------------------------------

interface PendingSender {
	sender: RTCRtpSender;
	senderId: number;
	mediaType: string;
}

interface PendingReceiver {
	receiver: RTCRtpReceiver;
	senderId: number;
	mediaType: string;
}

let meetingSecret: Uint8Array<ArrayBuffer> | null = null;
let keyVersion: number | null = null;
let senderSigningPriv: CryptoKey | null = null;
const senderChains = new Map<string, SenderChainState>();
const senderSigningPubs = new Map<number, CryptoKey>();
let receiverChain: ReceiverChainState | null = null;
const pendingSenders = new Set<PendingSender>();
const pendingReceivers = new Set<PendingReceiver>();
const activeSenderTransforms = new WeakSet<RTCRtpSender>();
const activeReceiverTransforms = new WeakSet<RTCRtpReceiver>();
const scriptTransformWorkers = new Set<Worker>();

export function setMeetingContext(
	meetingSecretArg: Uint8Array<ArrayBuffer>,
	keyVersionArg: number,
	senderSigningPrivArg?: CryptoKey,
): void {
	meetingSecret = meetingSecretArg;
	keyVersion = keyVersionArg;
	senderSigningPriv = senderSigningPrivArg ?? null;
	senderChains.clear();
	receiverChain = null;
	void setupPendingTransforms();
}

export function hasMeetingContext(): boolean {
	return meetingSecret !== null && keyVersion !== null;
}

export function setSenderSigningPub(
	senderId: number,
	signingPub: CryptoKey,
): void {
	senderSigningPubs.set(senderId, signingPub);
	receiverChain?.setSenderSigningPub(senderId, signingPub);
	for (const worker of scriptTransformWorkers) {
		worker.postMessage({ type: "addSenderSigningPub", senderId, signingPub });
	}
}

export function hasSenderSigningPub(senderId: number): boolean {
	return (
		receiverChain?.hasSenderSigningPub(senderId) ??
		senderSigningPubs.has(senderId)
	);
}

export function wipeMeetingContext(): void {
	if (meetingSecret) zeroUint8Array(meetingSecret);
	meetingSecret = null;
	keyVersion = null;
	senderSigningPriv = null;
	for (const chain of senderChains.values()) {
		chain.wipe();
	}
	senderChains.clear();
	if (receiverChain) {
		receiverChain.wipe();
		receiverChain = null;
	}
	pendingSenders.clear();
	pendingReceivers.clear();
	senderSigningPubs.clear();
	for (const worker of scriptTransformWorkers) {
		worker.postMessage({ type: "wipe" });
	}
	scriptTransformWorkers.clear();
	chatKeyCache = null;
}

let chatKeyCache: { meetingSecretVersion: number; key: CryptoKey } | null =
	null;

export async function getE2EEChatKey(): Promise<CryptoKey | null> {
	if (!meetingSecret) return null;
	if (chatKeyCache && chatKeyCache.meetingSecretVersion === keyVersion) {
		return chatKeyCache.key;
	}
	const subtle = getSubtle();
	const ikm = meetingSecret;
	const salt = new Uint8Array(32);
	const info = new TextEncoder().encode("meet-e2ee|chat");
	const hkdfKey = await subtle.importKey(
		"raw",
		ikm as BufferSource,
		"HKDF",
		false,
		["deriveBits"],
	);
	const bits = await subtle.deriveBits(
		{ name: "HKDF", hash: "SHA-256", salt, info: info as BufferSource },
		hkdfKey,
		256,
	);
	const key = await subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [
		"encrypt",
		"decrypt",
	]);
	chatKeyCache = { meetingSecretVersion: keyVersion, key };
	return key;
}

function getOrCreateSenderChain(
	senderId: number,
	mediaType: string,
): SenderChainState | null {
	if (!meetingSecret) {
		return null;
	}
	if (!senderSigningPriv) {
		console.warn(
			"[E2EE] getOrCreateSenderChain: no sender signing key (deferring)",
		);
		return null;
	}
	const key = `${senderId}:${mediaType}`;
	let chain = senderChains.get(key);
	if (!chain) {
		chain = new SenderChainState(
			meetingSecret,
			senderId,
			mediaType,
			senderSigningPriv,
		);
		senderChains.set(key, chain);
	}
	return chain;
}

function getOrCreateReceiverChain(): ReceiverChainState | null {
	if (!meetingSecret) {
		return null;
	}
	if (!receiverChain) {
		receiverChain = new ReceiverChainState(meetingSecret);
		for (const [senderId, pub] of senderSigningPubs) {
			receiverChain.setSenderSigningPub(senderId, pub);
		}
	}
	return receiverChain;
}

function hasLegacyInsertableStreamSupport(): boolean {
	if (typeof globalThis.RTCRtpSender === "undefined") return false;
	if (typeof globalThis.RTCRtpReceiver === "undefined") return false;
	try {
		const senderProto = globalThis.RTCRtpSender.prototype as unknown as {
			createEncodedStreams?: () => unknown;
		};
		const receiverProto = globalThis.RTCRtpReceiver.prototype as unknown as {
			createEncodedStreams?: () => unknown;
		};
		return (
			Object.hasOwn(senderProto, "createEncodedStreams") &&
			Object.hasOwn(receiverProto, "createEncodedStreams") &&
			typeof senderProto.createEncodedStreams === "function" &&
			typeof receiverProto.createEncodedStreams === "function"
		);
	} catch {
		return false;
	}
}

function getRTCRtpScriptTransform(): RTCRtpScriptTransformConstructor | null {
	return (
		(
			globalThis as typeof globalThis & {
				RTCRtpScriptTransform?: RTCRtpScriptTransformConstructor;
			}
		).RTCRtpScriptTransform ?? null
	);
}

export function getE2EETransformCapability(): E2EETransformCapability {
	if (hasLegacyInsertableStreamSupport()) return "legacy-insertable-streams";
	if (getRTCRtpScriptTransform()) return "rtp-script-transform";
	return "none";
}

function createE2EEWorker(): Worker {
	const worker = new Worker(
		new URL("./e2eeTransformWorker.ts", import.meta.url),
		{
			type: "module",
		},
	);
	scriptTransformWorkers.add(worker);
	return worker;
}

function postTransformWorkerPrewarm(
	worker: Worker,
	payload: {
		mediaType: string;
		senderSigningPubs?: Array<[number, CryptoKey]>;
	},
): void {
	try {
		worker.postMessage({
			type: "prewarm",
			mediaType: payload.mediaType,
			senderSigningPubs: payload.senderSigningPubs ?? [],
		});
	} catch {
		// best-effort: a failed pre-warm post is not fatal
	}
}

function installScriptTransform(
	target: TransformableSender | TransformableReceiver,
	options: Record<string, unknown>,
): Worker | null {
	const RTCRtpScriptTransform = getRTCRtpScriptTransform();
	if (!RTCRtpScriptTransform) return null;
	const worker = createE2EEWorker();
	target.transform = new RTCRtpScriptTransform(worker, options);
	return worker;
}

const preCreatedReceiverStreams = new WeakMap<
	RTCRtpReceiver,
	{
		readable: ReadableStream<unknown>;
		writable: WritableStream<unknown>;
	}
>();

export function preCreateReceiverStreams(receiver: RTCRtpReceiver): boolean {
	const capability = getE2EETransformCapability();
	if (capability === "none") {
		console.warn(
			"[E2EE] preCreateReceiverStreams: no insertable stream support",
		);
		return false;
	}
	if (capability === "rtp-script-transform") {
		return true;
	}
	if (preCreatedReceiverStreams.has(receiver)) {
		return true;
	}
	const streams = (
		receiver as ReceiverWithInsertableStreams
	).createEncodedStreams?.();
	if (!streams) {
		console.warn(
			"[E2EE] preCreateReceiverStreams: createEncodedStreams returned null",
		);
		return false;
	}
	const readable = streams.readable || streams.readableStream;
	const writable = streams.writable || streams.writableStream;
	if (!readable || !writable) {
		console.warn("[E2EE] preCreateReceiverStreams: missing readable/writable");
		return false;
	}
	preCreatedReceiverStreams.set(receiver, { readable, writable });
	return true;
}

export async function setupSenderTransform(
	sender: RTCRtpSender | undefined,
	senderId: number,
	mediaType: string,
): Promise<boolean> {
	if (!sender) {
		return false;
	}
	const capability = getE2EETransformCapability();
	if (
		activeSenderTransforms.has(sender) &&
		capability !== "rtp-script-transform"
	) {
		return false;
	}
	if (capability === "none") {
		console.warn(
			"[E2EE] setupSenderTransform: insertable stream support missing",
		);
		return false;
	}
	if (!hasMeetingContext()) {
		console.warn(
			"[E2EE] setupSenderTransform: no meeting context (deferring)",
			{ senderId, mediaType },
		);
		pendingSenders.add({ sender, senderId, mediaType });
		return false;
	}
	const senderKeyVersion = keyVersion;
	if (senderKeyVersion == null) return false;
	if (capability === "rtp-script-transform") {
		if (!meetingSecret || !senderSigningPriv) {
			pendingSenders.add({ sender, senderId, mediaType });
			return false;
		}
		const worker = installScriptTransform(sender as TransformableSender, {
			direction: "send",
			meetingSecret: new Uint8Array(meetingSecret),
			keyVersion: senderKeyVersion,
			senderId,
			mediaType,
			senderSigningPrivateKey: senderSigningPriv,
		});
		const installed = worker !== null;
		if (installed) {
			activeSenderTransforms.add(sender);
			postTransformWorkerPrewarm(worker as Worker, { mediaType });
		}
		return installed;
	}
	const chain = getOrCreateSenderChain(senderId, mediaType);
	if (!chain) {
		console.warn("[E2EE] setupSenderTransform: chain is null");
		return false;
	}
	const streams = (
		sender as SenderWithInsertableStreams
	).createEncodedStreams?.();
	if (!streams) {
		console.warn(
			"[E2EE] setupSenderTransform: createEncodedStreams returned nothing",
			{
				hasProto: typeof (sender as SenderWithInsertableStreams)
					.createEncodedStreams,
			},
		);
		return false;
	}
	const readable = streams.readable || streams.readableStream;
	const writable = streams.writable || streams.writableStream;
	if (!readable || !writable) return false;
	try {
		readable
			.pipeThrough(createEncryptionTransformStream(chain, senderKeyVersion))
			.pipeTo(writable)
			.catch((error: unknown) => {
				console.warn("E2EE sender transform pipeline failed:", error);
			});
		activeSenderTransforms.add(sender);
		return true;
	} catch (error) {
		console.error("E2EE: Failed to setup sender transform:", error);
		return false;
	}
}

export async function setupReceiverTransform(
	receiver: RTCRtpReceiver | undefined,
	senderId: number,
	mediaType: string,
): Promise<boolean> {
	if (!receiver) {
		console.warn("[E2EE] setupReceiverTransform: no receiver");
		return false;
	}
	if (activeReceiverTransforms.has(receiver)) {
		console.warn("[E2EE] setupReceiverTransform: already active", {
			senderId,
			mediaType,
		});
		return false;
	}
	const capability = getE2EETransformCapability();
	if (capability === "none") {
		console.warn("[E2EE] setupReceiverTransform: no insertable stream support");
		return false;
	}
	if (!hasMeetingContext()) {
		pendingReceivers.add({ receiver, senderId, mediaType });
		return false;
	}
	const receiverKeyVersion = keyVersion;
	if (receiverKeyVersion == null) return false;
	if (capability === "rtp-script-transform") {
		if (!meetingSecret) return false;
		const worker = installScriptTransform(receiver as TransformableReceiver, {
			direction: "recv",
			meetingSecret: new Uint8Array(meetingSecret),
			keyVersion: receiverKeyVersion,
			senderId,
			mediaType,
			senderSigningPubs: Array.from(senderSigningPubs.entries()),
		});
		const installed = worker !== null;
		if (installed) {
			activeReceiverTransforms.add(receiver);
			postTransformWorkerPrewarm(worker as Worker, {
				mediaType,
				senderSigningPubs: Array.from(senderSigningPubs.entries()),
			});
		}
		return installed;
	}
	const chain = getOrCreateReceiverChain();
	if (!chain) {
		console.warn("[E2EE] setupReceiverTransform: chain is null");
		return false;
	}
	let readable: ReadableStream<unknown> | undefined;
	let writable: WritableStream<unknown> | undefined;
	const preCreated = preCreatedReceiverStreams.get(receiver);
	if (preCreated) {
		readable = preCreated.readable;
		writable = preCreated.writable;
	} else {
		const streams = (
			receiver as ReceiverWithInsertableStreams
		).createEncodedStreams?.();
		if (!streams) {
			console.warn(
				"[E2EE] setupReceiverTransform: createEncodedStreams returned null",
				{ senderId, mediaType },
			);
			return false;
		}
		readable = streams.readable || streams.readableStream;
		writable = streams.writable || streams.writableStream;
	}
	if (!readable || !writable) {
		console.warn("[E2EE] setupReceiverTransform: missing readable/writable", {
			senderId,
			mediaType,
			hasReadable: !!readable,
			hasWritable: !!writable,
		});
		return false;
	}
	try {
		readable
			.pipeThrough(
				createDecryptionTransformStream(
					chain,
					receiverKeyVersion,
					receiver,
					mediaType,
				),
			)
			.pipeTo(writable)
			.catch((error: unknown) => {
				console.warn("E2EE receiver transform pipeline failed:", error);
			});
		activeReceiverTransforms.add(receiver);
		return true;
	} catch (error) {
		console.error("E2EE: Failed to setup receiver transform:", error);
		return false;
	}
}

async function setupPendingTransforms(): Promise<void> {
	for (const pending of Array.from(pendingSenders)) {
		const ok = await setupSenderTransform(
			pending.sender,
			pending.senderId,
			pending.mediaType,
		);
		if (ok) pendingSenders.delete(pending);
	}
	for (const pending of Array.from(pendingReceivers)) {
		const ok = await setupReceiverTransform(
			pending.receiver,
			pending.senderId,
			pending.mediaType,
		);
		if (ok) pendingReceivers.delete(pending);
	}
}
