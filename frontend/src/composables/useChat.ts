import { toast } from "frappe-ui";
import audioNotificationManager from "../utils/audioNotifications";
import type { SFUClient } from "../utils/SFUClient";
import type { ChatMessage, ChatStore } from "./useChatStore";
import type { CurrentUser } from "./useCurrentUser";

interface ChatAPI {
	setupChatEvents: (notificationQueue: unknown) => void;
	onSendChat: (text: string) => void;
}

export function useChat(deps: {
	chatStore: ChatStore;
	currentUser: CurrentUser;
	sfuClient: SFUClient;
}): ChatAPI {
	const { chatStore, currentUser, sfuClient } = deps;

	const setupChatEvents = (notificationQueue: unknown) => {
		sfuClient.on("chat:message", (data: Record<string, unknown>) => {
			if (data.fromUser === currentUser.currentUser.value?.user_id) {
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
				!chatStore.isChatOpen &&
				data.fromUser !== currentUser.currentUser.value?.user_id
			) {
				chatStore.hasUnreadMessages = true;

				(
					notificationQueue as { addNotification?: (n: unknown) => void }
				)?.addNotification?.({
					message: data.message,
					fromUser: data.fromUser,
					fromName: data.fromName || data.fromUser,
					timestamp: message.timestamp,
				});
				audioNotificationManager.playChatNotification();
			}
		});
	};

	const onSendChat = (text: string) => {
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
				sfuClient.sendChatMessage(text, {
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
		onSendChat,
	};
}
