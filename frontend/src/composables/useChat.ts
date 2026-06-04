import { toast } from "frappe-ui";
import audioNotificationManager from "../utils/audioNotifications";
import type { SFUClient } from "../utils/SFUClient";
import type { ChatMessage, ChatStore } from "./useChatStore";
import type { CurrentUser } from "./useCurrentUser";

interface ChatAPI {
	setupChatEvents: (notificationQueue: unknown) => void;
	onSendChat: (text: string) => void;
	toggleRestriction: (enabled: boolean) => void;
}

const E2EE_CHAT_PREFIX = "e2ee:";

function isEncryptedChatMessage(message: string): boolean {
	return message.startsWith(E2EE_CHAT_PREFIX);
}

function e2eePassphrase(sfuClient: SFUClient): string | null {
	return sfuClient.e2eePassphrase;
}

function e2eeSalt(sfuClient: SFUClient): string {
	return (
		sfuClient.connectionDetails.e2eeSalt ||
		`meet-e2ee-${sfuClient.connectionDetails.e2eeKeyVersion}`
	);
}

async function deriveChatKey(
	passphrase: string,
	salt: string,
): Promise<CryptoKey> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error("SubtleCrypto not available");
	}
	const payload = `chat-e2ee:${salt}:${passphrase}`;
	const hash = await subtle.digest(
		"SHA-256",
		new TextEncoder().encode(payload),
	);
	return subtle.importKey("raw", hash, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}

async function encryptChatMessage(
	key: CryptoKey,
	text: string,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(text);
	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		encoded,
	);

	const combined = new Uint8Array(iv.length + encrypted.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(encrypted), iv.length);

	const binary = Array.from(combined)
		.map((b) => String.fromCharCode(b))
		.join("");
	return E2EE_CHAT_PREFIX + btoa(binary);
}

async function decryptChatMessage(
	key: CryptoKey,
	encryptedMessage: string,
): Promise<string> {
	const payload = encryptedMessage.slice(E2EE_CHAT_PREFIX.length);
	const binary = atob(payload);
	const combined = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		combined[i] = binary.charCodeAt(i);
	}

	const iv = combined.slice(0, 12);
	const ciphertext = combined.slice(12);

	const decrypted = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		ciphertext,
	);
	return new TextDecoder().decode(decrypted);
}

function shouldEncryptChat(sfuClient: SFUClient): boolean {
	return (
		sfuClient.connectionDetails.e2eeRequired &&
		Boolean(sfuClient.e2eePassphrase)
	);
}

export function useChat(deps: {
	chatStore: ChatStore;
	currentUser: CurrentUser;
	sfuClient: SFUClient;
}): ChatAPI {
	const { chatStore, currentUser, sfuClient } = deps;

	let chatCryptoKey: CryptoKey | undefined;
	let chatCryptoKeyPromise: Promise<CryptoKey> | undefined;

	async function getChatKey(): Promise<CryptoKey> {
		if (chatCryptoKey) return chatCryptoKey;
		if (!chatCryptoKeyPromise) {
			const passphrase = e2eePassphrase(sfuClient);
			const salt = e2eeSalt(sfuClient);
			if (!passphrase) throw new Error("E2EE passphrase not set");
			chatCryptoKeyPromise = deriveChatKey(passphrase, salt);
		}
		chatCryptoKey = await chatCryptoKeyPromise;
		return chatCryptoKey;
	}

	const setupChatEvents = (notificationQueue: unknown) => {
		sfuClient.on("chat:message", async (data: Record<string, unknown>) => {
			if (data.fromUser === currentUser.currentUser.value?.user_id) {
				return;
			}

			let plaintext = data.message as string;

			if (isEncryptedChatMessage(plaintext)) {
				if (!sfuClient.e2eePassphrase) {
					console.warn(
						"E2EE chat: received encrypted message but no passphrase set",
					);
					plaintext = "[Encrypted message]";
				} else {
					try {
						const key = await getChatKey();
						plaintext = await decryptChatMessage(key, plaintext);
					} catch (e) {
						console.error("E2EE chat: decryption failed", e);
						const errName = e instanceof Error ? e.name : "Error";
						plaintext = `[Encrypted: ${errName}]`;
					}
				}
			}

			const message: ChatMessage = {
				id: Date.now() + Math.random(),
				user_id: data.fromUser as string,
				user_name: (data.fromName || data.fromUser) as string,
				message: plaintext,
				timestamp: new Date().toISOString(),
			};

			chatStore.addMessage(message);

			if (
				!chatStore.isChatOpen &&
				data.fromUser !== currentUser.currentUser.value?.user_id
			) {
				chatStore.hasUnreadMessages = true;

				(
					notificationQueue as { addNotification?: (n: unknown) => void }
				)?.addNotification?.({
					message: plaintext,
					fromUser: data.fromUser,
					fromName: data.fromName || data.fromUser,
					timestamp: message.timestamp,
				});
				audioNotificationManager.playChatNotification();
			}
		});
		sfuClient.on("chat:restriction_updated", (data: any) => {
			chatStore.hostOnlyChat = data.enabled;
		});

		sfuClient.on("sfu_error", (data: any) => {
			if (data?.code === "HOST_ONLY_CHAT") {
				toast.error("The host has restricted chat to hosts and co-hosts only.");
				chatStore.hostOnlyChat = true;
			}
		});
	};

	const toggleRestriction = (enabled: boolean) => {
		if (sfuClient.isConnected()) {
			sfuClient.sendEvent("chat:toggle_restriction", { enabled });
		}
	};

	const onSendChat = async (text: string) => {
		try {
			const message: ChatMessage = {
				id: Date.now() + Math.random(),
				user_id: currentUser.currentUser.value?.user_id as string,
				user_name:
					(currentUser.currentUser.value?.full_name as string) ||
					(currentUser.currentUser.value?.name as string) ||
					(currentUser.currentUser.value?.user_id as string),
				message: text,
				timestamp: new Date().toISOString(),
			};
			chatStore.addMessage(message);

			if (sfuClient.isConnected()) {
				let messageToSend = text;

				if (shouldEncryptChat(sfuClient)) {
					const key = await getChatKey();
					messageToSend = await encryptChatMessage(key, text);
				}

				sfuClient.sendChatMessage(messageToSend, {
					clientId: currentUser.currentUser.value?.user_id,
				});
			}
		} catch (error) {
			console.error("Failed to send chat message:", error);
			toast.error("Failed to send message");
		}
	};

	return {
		setupChatEvents,
		toggleRestriction,
		onSendChat,
	};
}
