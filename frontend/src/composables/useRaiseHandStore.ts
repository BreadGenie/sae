import { defineStore } from "pinia";
import { computed, ref } from "vue";

export interface RaiseHandStore {
	raisedHands: Record<string, string>;
	setHands: (hands: Record<string, string>) => void;
	raiseHand: (userId: string, timestamp: string) => void;
	lowerHand: (userId: string) => void;
	isHandRaised: (userId: string) => boolean;
	$reset: () => void;
}

export const useRaiseHandStore = defineStore("raiseHand", () => {
	const raisedHands = ref<Record<string, string>>({});

	function setHands(hands: Record<string, string>) {
		raisedHands.value = hands;
	}

	function raiseHand(userId: string, timestamp: string) {
		raisedHands.value = { ...raisedHands.value, [userId]: timestamp };
	}

	function lowerHand(userId: string) {
		const updated = { ...raisedHands.value };
		delete updated[userId];
		raisedHands.value = updated;
	}

	const isHandRaised = computed(() => {
		return (userId: string) => !!raisedHands.value?.[userId];
	});

	function $reset() {
		raisedHands.value = {};
	}

	return {
		raisedHands,
		setHands,
		raiseHand,
		lowerHand,
		isHandRaised,
		$reset,
	};
});
