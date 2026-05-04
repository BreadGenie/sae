import { type Ref, ref } from "vue";

export interface ReactionEntry {
	emoji: string;
	expiresAt: number;
	timeoutId: number;
}

export interface ReactionStore {
	reactions: Ref<Record<string, ReactionEntry>>;
	showReactionForUser: (
		userId: string,
		emoji: string,
		duration?: number,
	) => void;
	removeReaction: (userId: string) => void;
	resetReactionStore: () => void;
}

let instance: ReactionStore | null = null;

export function useReactionStore(): ReactionStore {
	if (instance) return instance;

	const reactions = ref<Record<string, ReactionEntry>>({});

	const showReactionForUser = (
		userId: string,
		emoji: string,
		duration = 5000,
	) => {
		const now = Date.now();
		const expiresAt = now + duration;

		const existing = reactions.value[userId];
		if (existing?.timeoutId) {
			clearTimeout(existing.timeoutId);
		}

		const timeoutId = window.setTimeout(() => {
			if (reactions.value[userId]) {
				const updated = { ...reactions.value };
				delete updated[userId];
				reactions.value = updated;
			}
		}, duration);

		reactions.value = {
			...reactions.value,
			[userId]: { emoji, expiresAt, timeoutId },
		};
	};

	const removeReaction = (userId: string) => {
		const existing = reactions.value[userId];
		if (existing?.timeoutId) {
			clearTimeout(existing.timeoutId);
		}
		const updated = { ...reactions.value };
		delete updated[userId];
		reactions.value = updated;
	};

	const resetReactionStore = () => {
		for (const entry of Object.values(reactions.value)) {
			if (entry?.timeoutId) {
				clearTimeout(entry.timeoutId);
			}
		}
		reactions.value = {};
	};

	instance = {
		reactions,
		showReactionForUser,
		removeReaction,
		resetReactionStore,
	};

	return instance;
}
