import { type ComputedRef, computed, type Ref, ref } from "vue";

export interface RaiseHandStore {
	raisedHands: Ref<Record<string, string>>;
	setHands: (hands: Record<string, string>) => void;
	raiseHand: (userId: string, timestamp: string) => void;
	lowerHand: (userId: string) => void;
	isHandRaised: ComputedRef<(userId: string) => boolean>;
	resetRaiseHandStore: () => void;
}

let instance: RaiseHandStore | null = null;

export function useRaiseHandStore(): RaiseHandStore {
	if (instance) return instance;

	const raisedHands = ref<Record<string, string>>({});

	const setHands = (hands: Record<string, string>) => {
		raisedHands.value = hands;
	};

	const raiseHand = (userId: string, timestamp: string) => {
		raisedHands.value = { ...raisedHands.value, [userId]: timestamp };
	};

	const lowerHand = (userId: string) => {
		const updated = { ...raisedHands.value };
		delete updated[userId];
		raisedHands.value = updated;
	};

	const isHandRaised = computed(() => {
		return (userId: string) => !!raisedHands.value?.[userId];
	});

	const resetRaiseHandStore = () => {
		raisedHands.value = {};
	};

	instance = {
		raisedHands,
		setHands,
		raiseHand,
		lowerHand,
		isHandRaised,
		resetRaiseHandStore,
	};

	return instance;
}
