import { toast } from "frappe-ui";
import audioNotificationManager from "../utils/audioNotifications";
import { getSFUClient } from "../utils/sfu-client.js";
import type { ChatMessage, ChatStore } from "./useChatStore";
import type { CurrentUser } from "./useCurrentUser";

interface ChatAPI {
	setupChatEvents: (notificationQueue: unknown) => void;
	onSendChat: (text: string) => void;
}

export function useChat(deps: {
	chatStore: ChatStore;
	currentUser: CurrentUser;
}): ChatAPI {
	const { chatStore, currentUser } = deps;

	const setupChatEvents = (notificationQueue: unknown) => {
		const sfuClient = getSFUClient();

		sfuClient.on("chat:message", (data: Record<string, unknown>) => {
			if (
				data.fromUser ===
				(currentUser.currentUser.value as Record<string, unknown>)?.user_id
			) {
				return;
			}

			const message: ChatMessage = {
				id: Date.now() + Math.random(),
				user_id: data.fromUser as string,
				user_name: (data.fromName || data.fromUser) as string,
				message: data.message as string,
				timestamp: new Date().toISOString(),
			};

			chatStore.addMessage(message);

			if (
				!chatStore.isChatOpen.value &&
				data.fromUser !==
					(currentUser.currentUser.value as Record<string, unknown>)?.user_id
			) {
				chatStore.hasUnreadMessages.value = true;

				if ((notificationQueue as Record<string, unknown>)?.addNotification) {
					(
						notificationQueue as Record<
							string,
							unknown & { addNotification: (n: unknown) => void }
						>
					).addNotification({
						message: data.message,
						fromUser: data.fromUser,
						fromName: data.fromName || data.fromUser,
						timestamp: message.timestamp,
					});
				}

				audioNotificationManager.playChatNotification();
			}
		});
	};

	const onSendChat = (text: string) => {
		try {
			const message: ChatMessage = {
				id: Date.now() + Math.random(),
				user_id: (currentUser.currentUser.value as Record<string, unknown>)
					?.user_id as string,
				user_name:
					((currentUser.currentUser.value as Record<string, unknown>)
						?.full_name as string) ||
					((currentUser.currentUser.value as Record<string, unknown>)
						?.name as string) ||
					((currentUser.currentUser.value as Record<string, unknown>)
						?.user_id as string),
				message: text,
				timestamp: new Date().toISOString(),
			};
			chatStore.addMessage(message);

			const sfuClient = getSFUClient();
			if (sfuClient.isConnected()) {
				sfuClient.sendChatMessage(text, {
					clientId: (currentUser.currentUser.value as Record<string, unknown>)
						?.user_id,
				});
			}
		} catch (error) {
			console.error("Failed to send chat message:", error);
			toast.error("Failed to send message");
		}
	};

	return {
		setupChatEvents,
		onSendChat,
	};
}
