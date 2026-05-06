import { defineStore } from "pinia";
import { ref } from "vue";

export interface ChatMessage {
	id: number;
	user_id: string;
	user_name: string;
	message: string;
	timestamp: string;
}

export interface ChatStore {
	isChatOpen: boolean;
	chatMessages: ChatMessage[];
	hasUnreadMessages: boolean;
	toggleChat: () => void;
	markAsRead: () => void;
	addMessage: (message: ChatMessage) => void;
	$reset: () => void;
}

export const useChatStore = defineStore("chat", () => {
	const isChatOpen = ref(false);
	const chatMessages = ref<ChatMessage[]>([]);
	const hasUnreadMessages = ref(false);

	function toggleChat() {
		isChatOpen.value = !isChatOpen.value;
		if (isChatOpen.value) {
			hasUnreadMessages.value = false;
		}
	}

	function markAsRead() {
		hasUnreadMessages.value = false;
	}

	function addMessage(message: ChatMessage) {
		if (!chatMessages.value) {
			chatMessages.value = [];
		}
		chatMessages.value.push(message);
	}

	function $reset() {
		isChatOpen.value = false;
		chatMessages.value = [];
		hasUnreadMessages.value = false;
	}

	return {
		isChatOpen,
		chatMessages,
		hasUnreadMessages,
		toggleChat,
		markAsRead,
		addMessage,
		$reset,
	};
});
