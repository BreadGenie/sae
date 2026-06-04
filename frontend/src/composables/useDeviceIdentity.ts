// E2EE v2 device identity: per-device ed25519 auth keypair + device_id.
//
// The host's ed25519 public key is the device's identity anchor. The
// server stores it in `tabUser.device_keys[device_id].ed25519_pub` and
// uses it to verify the host's signature when enabling E2EE on a
// meeting (see docs/adr/0003-per-device-host-identity.md).
//
// The private key never leaves the device; it's stored in IndexedDB
// (Key format: JWK; CryptoKey can't be stored cross-realm reliably).

import { ed25519KeyPair, exportEd25519PublicKey } from "../utils/media/e2ee";

const DB_NAME = "Meet_E2EE_v2";
const DB_VERSION = 1;
const STORE_NAME = "identity";
const DEVICE_ID_STORAGE_KEY = "meet:e2ee:device_id";

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
	});
}

async function idbGet(key: string): Promise<JsonWebKey | null> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const req = store.get(key);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve((req.result as JsonWebKey) ?? null);
		tx.oncomplete = () => db.close();
	});
}

async function idbPut(key: string, value: JsonWebKey): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		const req = store.put(value, key);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve();
		tx.oncomplete = () => db.close();
	});
}

function generateDeviceId(): string {
	const bytes = new Uint8Array(12);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getOrCreateDeviceId(): string {
	let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
	if (id && /^[a-zA-Z0-9._-]{1,64}$/.test(id)) {
		return id;
	}
	id = generateDeviceId();
	localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
	return id;
}

interface DeviceIdentity {
	deviceId: string;
	authKeyPair: CryptoKeyPair;
	authPublicKey: string;
}

let cachedIdentity: Promise<DeviceIdentity> | null = null;

export function useDeviceIdentity() {
	async function loadOrCreate(): Promise<DeviceIdentity> {
		const deviceId = getOrCreateDeviceId();
		const existing = await idbGet("authKey");
		let authKeyPair: CryptoKeyPair;
		if (existing) {
			const priv = await globalThis.crypto.subtle.importKey(
				"jwk",
				existing,
				{ name: "Ed25519" },
				false,
				["sign"],
			);
			const pubJwk = (await idbGet("authPub")) ?? null;
			const pub = pubJwk
				? await globalThis.crypto.subtle.importKey(
						"jwk",
						pubJwk,
						{ name: "Ed25519" },
						true,
						["verify"],
					)
				: null;
			authKeyPair = { privateKey: priv, publicKey: pub as CryptoKey };
		} else {
			authKeyPair = await ed25519KeyPair();
			await idbPut(
				"authKey",
				await globalThis.crypto.subtle.exportKey("jwk", authKeyPair.privateKey),
			);
			if (authKeyPair.publicKey) {
				await idbPut(
					"authPub",
					await globalThis.crypto.subtle.exportKey(
						"jwk",
						authKeyPair.publicKey,
					),
				);
			}
		}
		const authPublicKey = authKeyPair.publicKey
			? await exportEd25519PublicKey(authKeyPair.publicKey)
			: "";
		return { deviceId, authKeyPair, authPublicKey };
	}

	function getIdentity(): Promise<DeviceIdentity> {
		if (!cachedIdentity) {
			cachedIdentity = loadOrCreate();
		}
		return cachedIdentity;
	}

	function clearCache(): void {
		cachedIdentity = null;
	}

	return {
		getIdentity,
		clearCache,
	};
}
