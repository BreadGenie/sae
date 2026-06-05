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

export const E2EE_NEEDS_KEY_RESYNC_EVENT = "meet:e2ee-needs-key-resync";

function dispatchE2EEResyncEvent(senderId: number, generation: number): void {
	if (typeof globalThis.dispatchEvent !== "function") return;
	globalThis.dispatchEvent(
		new CustomEvent(E2EE_NEEDS_KEY_RESYNC_EVENT, {
			detail: {
				senderId,
				generation,
				threshold: RESYNC_FRAME_GAP_THRESHOLD,
			},
		}),
	);
}

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
): Promise<Uint8Array<ArrayBuffer>> {
	return hkdfBits(meetingSecret, encodeInfo(`meet-e2ee-v2|sender|${senderId}`));
}

export async function advanceChain(
	chainTip: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	return hkdfBits(chainTip, encodeInfo("meet-e2ee-v2|frame"));
}

export async function chainTipToAESKey(
	chainTip: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
	return hkdfToAESKey(chainTip, encodeInfo("meet-e2ee-v2|aes"));
}

export async function createEnvelope(
	hostPriv: CryptoKey,
	joinerPub: CryptoKey,
	meetingSecret: Uint8Array<ArrayBuffer>,
	context: { meetingId: string; keyVersion: number },
): Promise<Uint8Array<ArrayBuffer>> {
	const shared = await ecdhKeyAgreement(hostPriv, joinerPub);
	const info = encodeInfo(
		`meet-e2ee-v2|envelope|${context.meetingId}|${context.keyVersion}`,
	);
	const aesKey = await hkdfToAESKey(shared, info);
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await getSubtle().encrypt(
		{ name: "AES-GCM", iv },
		aesKey,
		meetingSecret,
	);
	const result = new Uint8Array(iv.length + ciphertext.byteLength);
	result.set(iv, 0);
	result.set(new Uint8Array(ciphertext), iv.length);
	return result;
}

export async function openEnvelope(
	joinerPriv: CryptoKey,
	hostPub: CryptoKey,
	envelope: Uint8Array<ArrayBuffer>,
	context: { meetingId: string; keyVersion: number },
): Promise<Uint8Array<ArrayBuffer>> {
	const shared = await ecdhKeyAgreement(joinerPriv, hostPub);
	const info = encodeInfo(
		`meet-e2ee-v2|envelope|${context.meetingId}|${context.keyVersion}`,
	);
	const aesKey = await hkdfToAESKey(shared, info);
	const iv = envelope.slice(0, 12);
	const ciphertext = envelope.slice(12);
	const meetingSecret = await getSubtle().decrypt(
		{ name: "AES-GCM", iv },
		aesKey,
		ciphertext,
	);
	const out = new Uint8Array(meetingSecret.byteLength);
	out.set(new Uint8Array(meetingSecret));
	return out;
}

export function featureDetectX25519(): boolean {
	if (typeof globalThis.crypto?.subtle === "undefined") {
		return false;
	}
	try {
		const subtle = globalThis.crypto.subtle;
		const test = new Uint8Array(32);
		subtle.importKey("raw", test, "X25519", true, []);
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
	return `v1-${hex}`;
}

type E2EEFrameHeaderV2 = {
	senderId: number;
	generation: number;
	keyVersion: number;
	iv: Uint8Array<ArrayBuffer>;
};

export function encodeFrameHeaderV2(header: E2EEFrameHeaderV2): Uint8Array {
	const encoded = new Uint8Array(24);
	const view = new DataView(encoded.buffer);
	view.setUint32(0, header.senderId, true);
	view.setUint32(4, header.generation, true);
	view.setUint32(8, header.keyVersion, true);
	encoded.set(header.iv.subarray(0, 12), 12);
	return encoded;
}

export function decodeFrameHeaderV2(
	data: Uint8Array,
): E2EEFrameHeaderV2 | null {
	if (data.length < 24) {
		return null;
	}
	const view = new DataView(data.buffer, data.byteOffset, 24);
	const iv = new Uint8Array(12);
	iv.set(data.subarray(12, 24));
	return {
		senderId: view.getUint32(0, true),
		generation: view.getUint32(4, true),
		keyVersion: view.getUint32(8, true),
		iv,
	};
}

export class SenderChainState {
	readonly senderId: number;
	private readonly meetingSecret: Uint8Array<ArrayBuffer>;
	private chainTip: Uint8Array<ArrayBuffer> | null = null;
	private currentGeneration = 0;

	constructor(meetingSecret: Uint8Array<ArrayBuffer>, senderId: number) {
		this.meetingSecret = meetingSecret;
		this.senderId = senderId;
	}

	private async ensureChainTip(): Promise<Uint8Array<ArrayBuffer>> {
		if (this.chainTip === null) {
			this.chainTip = await initSenderChain(this.meetingSecret, this.senderId);
		}
		return this.chainTip;
	}

	async nextFrameKey(): Promise<{ key: CryptoKey; generation: number }> {
		const tip = await this.ensureChainTip();
		const key = await chainTipToAESKey(tip);
		const generation = this.currentGeneration++;
		this.chainTip = await advanceChain(tip);
		return { key, generation };
	}

	wipe(): void {
		this.chainTip = null;
		this.currentGeneration = 0;
	}
}

export const RESYNC_FRAME_GAP_THRESHOLD = 100;

export class ReceiverChainState {
	private readonly meetingSecret: Uint8Array<ArrayBuffer>;
	private readonly chainTips = new Map<
		number,
		{ tip: Uint8Array<ArrayBuffer>; expectedGeneration: number }
	>();

	constructor(meetingSecret: Uint8Array<ArrayBuffer>) {
		this.meetingSecret = meetingSecret;
	}

	async getKeyForFrame(
		senderId: number,
		generation: number,
	): Promise<{ key: CryptoKey } | { error: "replay" | "resync" }> {
		let entry = this.chainTips.get(senderId);
		if (!entry) {
			const tip = await initSenderChain(this.meetingSecret, senderId);
			entry = { tip, expectedGeneration: 0 };
			this.chainTips.set(senderId, entry);
		}
		if (generation < entry.expectedGeneration) {
			return { error: "replay" };
		}
		const gap = generation - entry.expectedGeneration;
		if (gap >= RESYNC_FRAME_GAP_THRESHOLD) {
			return { error: "resync" };
		}
		for (let i = 0; i < gap; i++) {
			entry.tip = await advanceChain(entry.tip);
			entry.expectedGeneration++;
		}
		const key = await chainTipToAESKey(entry.tip);
		entry.tip = await advanceChain(entry.tip);
		entry.expectedGeneration++;
		return { key };
	}

	wipe(): void {
		this.chainTips.clear();
	}
}

export function createEncryptionTransformStreamV2(
	chainState: SenderChainState,
	keyVersion: number,
): TransformStream {
	return new TransformStream({
		async transform(encodedFrame, controller) {
			const subtle = getSubtle();
			try {
				const { key, generation } = await chainState.nextFrameKey();
				const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
				const encrypted = await subtle.encrypt(
					{ name: "AES-GCM", iv },
					key,
					encodedFrame.data,
				);
				const header = encodeFrameHeaderV2({
					senderId: chainState.senderId,
					generation,
					keyVersion,
					iv,
				});
				const newData = new Uint8Array(header.length + encrypted.byteLength);
				newData.set(header, 0);
				newData.set(new Uint8Array(encrypted), header.length);
				encodedFrame.data = newData.buffer;
				controller.enqueue(encodedFrame);
			} catch (error) {
				console.warn("E2EE v2: encryption failed, dropping frame:", error);
			}
		},
	});
}

export function createDecryptionTransformStreamV2(
	chainState: ReceiverChainState,
	expectedKeyVersion: number,
	receiver?: RTCRtpReceiver,
): TransformStream {
	return new TransformStream({
		async transform(encodedFrame, controller) {
			const subtle = getSubtle();
			if (encodedFrame.data.byteLength < 40) {
				return;
			}
			const data = new Uint8Array(encodedFrame.data);
			const header = decodeFrameHeaderV2(data);
			if (!header) {
				return;
			}
			if (header.keyVersion !== expectedKeyVersion) {
				return;
			}
			const result = await chainState.getKeyForFrame(
				header.senderId,
				header.generation,
			);
			if ("error" in result) {
				if (result.error === "resync") {
					dispatchE2EEResyncEvent(header.senderId, header.generation);
				}
				return;
			}
			const ciphertext = data.slice(24);
			try {
				const decrypted = await subtle.decrypt(
					{ name: "AES-GCM", iv: header.iv },
					result.key,
					ciphertext,
				);
				encodedFrame.data = decrypted;
				controller.enqueue(encodedFrame);
			} catch (error) {
				console.warn("E2EE v2: decrypt failed, dropping frame:", error);
			}
		},
	});
}

// ---------------------------------------------------------------------------
// E2EE v2 chain registry
//
// Module-level singleton that tracks the meeting_sharing meeting_secret
// (populated when the v2 handshake completes via
// `meet:e2ee-handshake-complete`) and the per-sender chain state.
//
// Producers/consumers register themselves with the registry at
// `createProducer` / consumer-creation time. The transform isn't
// actually installed until the meeting_secret is available; this is
// the same lazy-activation pattern v1 used with e2eePassphrase.
// ---------------------------------------------------------------------------

interface PendingSender {
	sender: RTCRtpSender;
	senderId: number;
}

interface PendingReceiver {
	receiver: RTCRtpReceiver;
}

let v2MeetingSecret: Uint8Array<ArrayBuffer> | null = null;
let v2KeyVersion: number | null = null;
const v2SenderChains = new Map<number, SenderChainState>();
let v2ReceiverChain: ReceiverChainState | null = null;
const v2PendingSenders = new Set<PendingSender>();
const v2PendingReceivers = new Set<PendingReceiver>();
const v2ActiveSenderTransforms = new WeakSet<RTCRtpSender>();
const v2ActiveReceiverTransforms = new WeakSet<RTCRtpReceiver>();

export function setV2MeetingContext(
	meetingSecret: Uint8Array<ArrayBuffer>,
	keyVersion: number,
): void {
	v2MeetingSecret = meetingSecret;
	v2KeyVersion = keyVersion;
	v2SenderChains.clear();
	v2ReceiverChain = null;
	void setupPendingV2Transforms();
}

function getV2KeyVersion(): number | null {
	return v2KeyVersion;
}

export function hasV2MeetingContext(): boolean {
	return v2MeetingSecret !== null && v2KeyVersion !== null;
}

export function wipeV2MeetingContext(): void {
	v2MeetingSecret = null;
	v2KeyVersion = null;
	for (const chain of v2SenderChains.values()) {
		chain.wipe();
	}
	v2SenderChains.clear();
	if (v2ReceiverChain) {
		v2ReceiverChain.wipe();
		v2ReceiverChain = null;
	}
	v2PendingSenders.clear();
	v2PendingReceivers.clear();
	chatKeyCache = null;
}

let chatKeyCache: { meetingSecretVersion: number; key: CryptoKey } | null =
	null;

export async function getE2EEChatKeyV2(): Promise<CryptoKey | null> {
	if (!v2MeetingSecret) return null;
	if (chatKeyCache && chatKeyCache.meetingSecretVersion === v2KeyVersion) {
		return chatKeyCache.key;
	}
	const subtle = getSubtle();
	const ikm = v2MeetingSecret;
	const salt = new Uint8Array(32);
	const info = new TextEncoder().encode("meet-e2ee-v2|chat");
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
	chatKeyCache = { meetingSecretVersion: v2KeyVersion, key };
	return key;
}

function getOrCreateSenderChain(senderId: number): SenderChainState | null {
	if (!v2MeetingSecret) {
		return null;
	}
	let chain = v2SenderChains.get(senderId);
	if (!chain) {
		chain = new SenderChainState(v2MeetingSecret, senderId);
		v2SenderChains.set(senderId, chain);
	}
	return chain;
}

function getOrCreateReceiverChain(): ReceiverChainState | null {
	if (!v2MeetingSecret) {
		return null;
	}
	if (!v2ReceiverChain) {
		v2ReceiverChain = new ReceiverChainState(v2MeetingSecret);
	}
	return v2ReceiverChain;
}

function hasInsertableStreamSupportV2(): boolean {
	if (typeof globalThis.RTCRtpSender === "undefined") return false;
	if (typeof globalThis.RTCRtpReceiver === "undefined") return false;
	try {
		const proto = globalThis.RTCRtpSender.prototype as unknown as {
			createEncodedStreams?: () => unknown;
		};
		return typeof proto.createEncodedStreams === "function";
	} catch {
		return false;
	}
}

export async function setupSenderTransformV2(
	sender: RTCRtpSender | undefined,
	senderId: number,
): Promise<boolean> {
	if (!sender || v2ActiveSenderTransforms.has(sender)) {
		return false;
	}
	if (!hasInsertableStreamSupportV2()) {
		return false;
	}
	if (!hasV2MeetingContext()) {
		v2PendingSenders.add({ sender, senderId });
		return false;
	}
	const chain = getOrCreateSenderChain(senderId);
	if (!chain) {
		return false;
	}
	const streams = (
		sender as SenderWithInsertableStreams
	).createEncodedStreams?.();
	if (!streams) return false;
	const readable = streams.readable || streams.readableStream;
	const writable = streams.writable || streams.writableStream;
	if (!readable || !writable) return false;
	try {
		readable
			.pipeThrough(createEncryptionTransformStreamV2(chain, v2KeyVersion!))
			.pipeTo(writable)
			.catch((error: unknown) => {
				console.warn("E2EE v2 sender transform pipeline failed:", error);
			});
		v2ActiveSenderTransforms.add(sender);
		return true;
	} catch (error) {
		console.error("E2EE v2: Failed to setup sender transform:", error);
		return false;
	}
}

export async function setupReceiverTransformV2(
	receiver: RTCRtpReceiver | undefined,
): Promise<boolean> {
	if (!receiver || v2ActiveReceiverTransforms.has(receiver)) {
		return false;
	}
	if (!hasInsertableStreamSupportV2()) {
		return false;
	}
	if (!hasV2MeetingContext()) {
		v2PendingReceivers.add({ receiver });
		return false;
	}
	const chain = getOrCreateReceiverChain();
	if (!chain) return false;
	const streams = (
		receiver as ReceiverWithInsertableStreams
	).createEncodedStreams?.();
	if (!streams) return false;
	const readable = streams.readable || streams.readableStream;
	const writable = streams.writable || streams.writableStream;
	if (!readable || !writable) return false;
	try {
		readable
			.pipeThrough(createDecryptionTransformStreamV2(chain, v2KeyVersion!))
			.pipeTo(writable)
			.catch((error: unknown) => {
				console.warn("E2EE v2 receiver transform pipeline failed:", error);
			});
		v2ActiveReceiverTransforms.add(receiver);
		return true;
	} catch (error) {
		console.error("E2EE v2: Failed to setup receiver transform:", error);
		return false;
	}
}

async function setupPendingV2Transforms(): Promise<void> {
	for (const pending of Array.from(v2PendingSenders)) {
		const ok = await setupSenderTransformV2(pending.sender, pending.senderId);
		if (ok) v2PendingSenders.delete(pending);
	}
	for (const pending of Array.from(v2PendingReceivers)) {
		const ok = await setupReceiverTransformV2(pending.receiver);
		if (ok) v2PendingReceivers.delete(pending);
	}
}
