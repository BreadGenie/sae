import { type Ref, ref } from "vue";

export interface ChatMessage {
	id: number;
	user_id: string;
	user_name: string;
	message: string;
	timestamp: string;
}

export interface ChatStore {
	isChatOpen: Ref<boolean>;
	chatMessages: Ref<ChatMessage[]>;
	hasUnreadMessages: Ref<boolean>;
	toggleChat: () => void;
	markAsRead: () => void;
	addMessage: (message: ChatMessage) => void;
	resetChatStore: () => void;
}

let instance: ChatStore | null = null;

export function useChatStore(): ChatStore {
	if (instance) return instance;

	const isChatOpen = ref(false);
	const chatMessages = ref<ChatMessage[]>([]);
	const hasUnreadMessages = ref(false);

	const toggleChat = () => {
		isChatOpen.value = !isChatOpen.value;
		if (isChatOpen.value) {
			hasUnreadMessages.value = false;
		}
	};

	const markAsRead = () => {
		hasUnreadMessages.value = false;
	};

	const addMessage = (message: ChatMessage) => {
		if (!chatMessages.value) {
			chatMessages.value = [];
		}
		chatMessages.value.push(message);
	};

	const resetChatStore = () => {
		isChatOpen.value = false;
		chatMessages.value = [];
		hasUnreadMessages.value = false;
	};

	instance = {
		isChatOpen,
		chatMessages,
		hasUnreadMessages,
		toggleChat,
		markAsRead,
		addMessage,
		resetChatStore,
	};

	return instance;
}
