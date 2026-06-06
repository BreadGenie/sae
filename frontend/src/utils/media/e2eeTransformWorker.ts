const FRAME_HEADER_FIXED_SIZE = 24;
const FRAME_SIGNATURE_SIZE = 64;
const FRAME_HEADER_TOTAL = FRAME_HEADER_FIXED_SIZE + FRAME_SIGNATURE_SIZE;
const AES_GCM_TAG_SIZE = 16;
const MIN_FRAME_PLAINTEXT_SIZE = 1;
const FRAME_MAGIC = new Uint8Array([0x4d, 0x45, 0x32, 0x45]); // ME2E
const MIN_SIGNED_ENCRYPTED_FRAME_SIZE =
	FRAME_MAGIC.byteLength +
	FRAME_HEADER_TOTAL +
	AES_GCM_TAG_SIZE +
	MIN_FRAME_PLAINTEXT_SIZE;
const REPLAY_WINDOW = 100;
const FRAME_GENERATION_KEYFRAME_FLAG = 0x80000000;
const FRAME_GENERATION_MASK = 0x7fffffff;
const VIDEO_CLEAR_PREFIX_SIZE = 1;
const SENDER_KEY_CACHE_MAX = 64;
const DUMMY_VERIFY_MSG = new Uint8Array(0);
const DUMMY_VERIFY_SIG = new Uint8Array(64);

type EncodedFrame = {
	data: ArrayBuffer;
	type?: string;
};

type E2EEFrameHeader = {
	senderId: number;
	generation: number;
	frameType?: string;
	keyVersion: number;
	iv: Uint8Array<ArrayBuffer>;
};

type WorkerOptions = {
	direction: "send" | "recv";
	meetingSecret: Uint8Array<ArrayBuffer>;
	keyVersion: number;
	senderId: number;
	mediaType: string;
	senderSigningPrivateKey?: CryptoKey;
	senderSigningPubs?: Array<[number, CryptoKey]>;
};

type WorkerMessage =
	| { type: "addSenderSigningPub"; senderId: number; signingPub: CryptoKey }
	| {
			type: "prewarm";
			mediaType: string;
			senderSigningPubs: Array<[number, CryptoKey]>;
	  }
	| { type: "wipe" };

function getSubtle(): SubtleCrypto {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error("SubtleCrypto not available");
	return subtle;
}

async function warmSubtleCrypto(): Promise<void> {
	try {
		await getSubtle().digest("SHA-256", new Uint8Array(0));
	} catch {
		// best-effort: ignore warm-up errors
	}
}

void warmSubtleCrypto();

function encodeInfo(s: string): Uint8Array<ArrayBuffer> {
	const src = new TextEncoder().encode(s);
	const out = new Uint8Array(src.length);
	out.set(src);
	return out;
}

function encodeFrameHeader(header: E2EEFrameHeader): Uint8Array<ArrayBuffer> {
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

function decodeFrameHeader(data: Uint8Array): E2EEFrameHeader | null {
	if (data.length < FRAME_HEADER_FIXED_SIZE) return null;
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

async function hkdfToAESKey(
	ikm: Uint8Array<ArrayBuffer>,
	info: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
	const subtle = getSubtle();
	const baseKey = await subtle.importKey("raw", ikm, "HKDF", false, [
		"deriveKey",
	]);
	return subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

async function deriveFrameKey(
	meetingSecret: Uint8Array<ArrayBuffer>,
	senderId: number,
	mediaType: string,
	generation: number,
): Promise<CryptoKey> {
	return hkdfToAESKey(
		meetingSecret,
		encodeInfo(`meet-e2ee|frame|${senderId}|${mediaType}|${generation}`),
	);
}

function buildSignedFramePayload(
	headerFixed: Uint8Array<ArrayBuffer>,
	clearPrefix: Uint8Array<ArrayBuffer>,
	frameMagic: Uint8Array<ArrayBuffer>,
	ciphertext: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(
		headerFixed.byteLength +
			clearPrefix.byteLength +
			frameMagic.byteLength +
			ciphertext.byteLength,
	);
	out.set(headerFixed, 0);
	out.set(clearPrefix, headerFixed.byteLength);
	out.set(frameMagic, headerFixed.byteLength + clearPrefix.byteLength);
	out.set(
		ciphertext,
		headerFixed.byteLength + clearPrefix.byteLength + frameMagic.byteLength,
	);
	return out;
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

class SendState {
	private nextGeneration = 0;

	constructor(
		private meetingSecret: Uint8Array<ArrayBuffer>,
		private senderId: number,
		private mediaType: string,
		private signingPrivateKey: CryptoKey,
	) {}

	async encrypt(
		frame: EncodedFrame,
		keyVersion: number,
	): Promise<EncodedFrame | null> {
		const subtle = getSubtle();
		const generation = this.nextGeneration++;
		const clearPrefix = getClearPrefix(
			frame.data,
			getClearPrefixSize(this.mediaType),
		);
		const key = await deriveFrameKey(
			this.meetingSecret,
			this.senderId,
			this.mediaType,
			generation,
		);
		const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
		const encrypted = await subtle.encrypt(
			{ name: "AES-GCM", iv },
			key,
			frame.data,
		);
		const header = encodeFrameHeader({
			senderId: this.senderId,
			generation,
			frameType: frame.type,
			keyVersion,
			iv,
		});
		const ciphertext = new Uint8Array(encrypted.byteLength);
		ciphertext.set(new Uint8Array(encrypted));
		const signed = buildSignedFramePayload(
			header,
			clearPrefix,
			FRAME_MAGIC,
			ciphertext,
		);
		const signature = new Uint8Array(
			await subtle.sign({ name: "Ed25519" }, this.signingPrivateKey, signed),
		);
		const out = new Uint8Array(
			clearPrefix.byteLength +
				FRAME_MAGIC.byteLength +
				header.byteLength +
				signature.byteLength +
				ciphertext.byteLength,
		);
		out.set(clearPrefix, 0);
		out.set(FRAME_MAGIC, clearPrefix.byteLength);
		out.set(header, clearPrefix.byteLength + FRAME_MAGIC.byteLength);
		out.set(
			signature,
			clearPrefix.byteLength + FRAME_MAGIC.byteLength + header.byteLength,
		);
		out.set(
			ciphertext,
			clearPrefix.byteLength +
				FRAME_MAGIC.byteLength +
				header.byteLength +
				signature.byteLength,
		);
		frame.data = out.buffer;
		return frame;
	}

	wipe(): void {
		this.meetingSecret.fill(0);
	}
}

class RecvState {
	private signingPubs = new Map<number, CryptoKey>();
	private highWaterMark = new Map<string, number>();
	private seenFrames = new Map<string, Set<number>>();
	private frameKeyCache = new Map<
		string,
		{ generation: number; key: CryptoKey }
	>();

	constructor(
		private meetingSecret: Uint8Array<ArrayBuffer>,
		initialSigningPubs: Array<[number, CryptoKey]>,
	) {
		for (const [senderId, pub] of initialSigningPubs) {
			this.signingPubs.set(senderId, pub);
		}
	}

	setSenderSigningPub(senderId: number, signingPub: CryptoKey): void {
		this.signingPubs.set(senderId, signingPub);
	}

	async warmSigningPub(pub: CryptoKey): Promise<void> {
		try {
			await getSubtle().verify(
				{ name: "Ed25519" },
				pub,
				DUMMY_VERIFY_SIG,
				DUMMY_VERIFY_MSG,
			);
		} catch {
			// best-effort: a verify against an obviously-bad signature must fail;
			// the goal is to warm the Ed25519 code path, not to authenticate.
		}
	}

	async prewarmFrameKeys(mediaType: string): Promise<void> {
		const senderIds = Array.from(this.signingPubs.keys());
		await Promise.all(
			senderIds.map(async (senderId) => {
				const key = await deriveFrameKey(
					this.meetingSecret,
					senderId,
					mediaType,
					0,
				);
				this.cacheFrameKey(senderId, mediaType, 0, key);
			}),
		);
	}

	private cacheFrameKey(
		senderId: number,
		mediaType: string,
		generation: number,
		key: CryptoKey,
	): void {
		const cacheKey = `${senderId}:${mediaType}`;
		const existing = this.frameKeyCache.get(cacheKey);
		if (existing && existing.generation === generation) return;
		this.frameKeyCache.set(cacheKey, { generation, key });
		while (this.frameKeyCache.size > SENDER_KEY_CACHE_MAX) {
			const oldestKey = this.frameKeyCache.keys().next().value;
			if (oldestKey === undefined) break;
			this.frameKeyCache.delete(oldestKey);
		}
	}

	private getCachedFrameKey(
		senderId: number,
		mediaType: string,
		generation: number,
	): CryptoKey | null {
		const cacheKey = `${senderId}:${mediaType}`;
		const entry = this.frameKeyCache.get(cacheKey);
		if (!entry || entry.generation !== generation) return null;
		return entry.key;
	}

	async decrypt(
		frame: EncodedFrame,
		expectedKeyVersion: number,
		mediaType: string,
	): Promise<EncodedFrame | null> {
		const subtle = getSubtle();
		const data = new Uint8Array(frame.data);
		const clearPrefixSize = getClearPrefixSize(mediaType);
		if (data.length < clearPrefixSize + MIN_SIGNED_ENCRYPTED_FRAME_SIZE) {
			return null;
		}
		const clearPrefix = data.slice(0, clearPrefixSize);
		const magicOffset = clearPrefixSize;
		if (!hasFrameMagic(data, magicOffset)) return null;
		const frameMagic = data.slice(
			magicOffset,
			magicOffset + FRAME_MAGIC.byteLength,
		);
		const headerOffset = magicOffset + FRAME_MAGIC.byteLength;
		const headerEnd = headerOffset + FRAME_HEADER_FIXED_SIZE;
		const signatureEnd = headerOffset + FRAME_HEADER_TOTAL;
		const header = decodeFrameHeader(data.subarray(headerOffset, headerEnd));
		if (!header || header.keyVersion !== expectedKeyVersion) return null;
		const signingPub = this.signingPubs.get(header.senderId);
		if (!signingPub) return null;
		const headerFixed = new Uint8Array(FRAME_HEADER_FIXED_SIZE);
		headerFixed.set(data.subarray(headerOffset, headerEnd));
		const signature = data.slice(headerEnd, signatureEnd);
		const ciphertext = data.slice(signatureEnd);
		const signed = buildSignedFramePayload(
			headerFixed,
			clearPrefix,
			frameMagic,
			ciphertext,
		);
		const sigOk = await subtle.verify(
			{ name: "Ed25519" },
			signingPub,
			signature,
			signed,
		);
		if (
			!sigOk ||
			!this.markSeen(header.senderId, mediaType, header.generation)
		) {
			return null;
		}
		const cached = this.getCachedFrameKey(
			header.senderId,
			mediaType,
			header.generation,
		);
		const key =
			cached ??
			(await deriveFrameKey(
				this.meetingSecret,
				header.senderId,
				mediaType,
				header.generation,
			));
		if (!cached) {
			this.cacheFrameKey(header.senderId, mediaType, header.generation, key);
		}
		try {
			frame.data = await subtle.decrypt(
				{ name: "AES-GCM", iv: header.iv },
				key,
				ciphertext,
			);
		} catch {
			return null;
		}
		void this.deriveNextFrameKey(header.senderId, mediaType, header.generation);
		return frame;
	}

	private async deriveNextFrameKey(
		senderId: number,
		mediaType: string,
		currentGeneration: number,
	): Promise<void> {
		try {
			const nextGeneration = currentGeneration + 1;
			const nextKey = await deriveFrameKey(
				this.meetingSecret,
				senderId,
				mediaType,
				nextGeneration,
			);
			this.cacheFrameKey(senderId, mediaType, nextGeneration, nextKey);
		} catch {
			// best-effort: a background pre-derive failure is not fatal
		}
	}

	private markSeen(
		senderId: number,
		mediaType: string,
		generation: number,
	): boolean {
		const key = `${senderId}:${mediaType}`;
		let seen = this.seenFrames.get(key);
		if (!seen) seen = new Set<number>();
		const hwm = this.highWaterMark.get(key) ?? -1;
		if (generation <= hwm - REPLAY_WINDOW || seen.has(generation)) return false;
		if (generation > hwm) {
			this.highWaterMark.set(key, generation);
			const pruneAtOrBefore = generation - REPLAY_WINDOW;
			for (const seenGeneration of seen) {
				if (seenGeneration <= pruneAtOrBefore) seen.delete(seenGeneration);
			}
		}
		seen.add(generation);
		this.seenFrames.set(key, seen);
		return true;
	}

	wipe(): void {
		this.meetingSecret.fill(0);
		this.signingPubs.clear();
		this.highWaterMark.clear();
		this.seenFrames.clear();
		this.frameKeyCache.clear();
	}
}

let recvState: RecvState | null = null;
let sendState: SendState | null = null;
let pendingRecvPrewarm: {
	mediaType: string;
	senderSigningPubs: Array<[number, CryptoKey]>;
} | null = null;

async function applyPendingPrewarm(state: RecvState): Promise<void> {
	if (!pendingRecvPrewarm) return;
	const { mediaType, senderSigningPubs } = pendingRecvPrewarm;
	pendingRecvPrewarm = null;
	await Promise.all(
		senderSigningPubs.map(([, pub]) => state.warmSigningPub(pub)),
	);
	await state.prewarmFrameKeys(mediaType);
}

self.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
	if (event.data.type === "addSenderSigningPub") {
		recvState?.setSenderSigningPub(event.data.senderId, event.data.signingPub);
		if (recvState) {
			void recvState.warmSigningPub(event.data.signingPub);
		} else {
			const existing = pendingRecvPrewarm?.senderSigningPubs ?? [];
			pendingRecvPrewarm = {
				mediaType: pendingRecvPrewarm?.mediaType ?? "video",
				senderSigningPubs: [
					...existing,
					[event.data.senderId, event.data.signingPub],
				],
			};
		}
		return;
	}
	if (event.data.type === "prewarm") {
		const incoming = event.data;
		if (recvState) {
			void (async () => {
				await Promise.all(
					incoming.senderSigningPubs.map(([, pub]) =>
						recvState?.warmSigningPub(pub),
					),
				);
				await recvState.prewarmFrameKeys(incoming.mediaType);
			})();
			return;
		}
		const merged = new Map<number, CryptoKey>();
		for (const [id, pub] of pendingRecvPrewarm?.senderSigningPubs ?? []) {
			merged.set(id, pub);
		}
		for (const [id, pub] of incoming.senderSigningPubs) {
			merged.set(id, pub);
		}
		pendingRecvPrewarm = {
			mediaType: incoming.mediaType,
			senderSigningPubs: Array.from(merged.entries()),
		};
		return;
	}
	if (event.data.type === "wipe") {
		recvState?.wipe();
		sendState?.wipe();
		recvState = null;
		sendState = null;
		pendingRecvPrewarm = null;
	}
});

self.addEventListener("rtctransform", (event: Event) => {
	const transformer = (
		event as Event & {
			transformer: {
				readable: ReadableStream<EncodedFrame>;
				writable: WritableStream<EncodedFrame>;
				options: WorkerOptions;
			};
		}
	).transformer;
	const options = transformer.options;

	const transform = new TransformStream<EncodedFrame, EncodedFrame>({
		async transform(frame, controller) {
			if (options.direction === "send") {
				if (!options.senderSigningPrivateKey) return;
				if (!sendState) {
					sendState = new SendState(
						options.meetingSecret,
						options.senderId,
						options.mediaType,
						options.senderSigningPrivateKey,
					);
				}
				const encrypted = await sendState.encrypt(frame, options.keyVersion);
				if (encrypted) controller.enqueue(encrypted);
				return;
			}

			if (!recvState) {
				recvState = new RecvState(
					options.meetingSecret,
					options.senderSigningPubs ?? [],
				);
			}
			await applyPendingPrewarm(recvState);
			const decrypted = await recvState.decrypt(
				frame,
				options.keyVersion,
				options.mediaType,
			);
			if (decrypted) controller.enqueue(decrypted);
		},
	});

	transformer.readable.pipeThrough(transform).pipeTo(transformer.writable);
});

export {};
