import audioNotificationManager from "../utils/audioNotifications";
import type { SFUClient } from "../utils/SFUClient";
import type { CurrentUser } from "./useCurrentUser";
import type { RaiseHandStore } from "./useRaiseHandStore";

interface RaiseHandAPI {
	setupRaiseHandEvents: () => void;
	toggleRaiseHand: () => Promise<void>;
}

export function useRaiseHand(deps: {
	raiseHandStore: RaiseHandStore;
	currentUser: CurrentUser;
	sfuClient: SFUClient;
}): RaiseHandAPI {
	const { raiseHandStore, currentUser, sfuClient } = deps;

	const setupRaiseHandEvents = () => {
		sfuClient.on("hand_raised", (data: Record<string, unknown>) => {
			const participantId = data.participantId as string;
			const raised = data.raised as boolean;

			if (raised) {
				raiseHandStore.raiseHand(
					participantId,
					(data.timestamp as string) || new Date().toISOString(),
				);
				audioNotificationManager.playRaiseHandNotification();
			} else {
				raiseHandStore.lowerHand(participantId);
			}
		});

		sfuClient.on("existing_raised_hands", (data: Record<string, unknown>) => {
			raiseHandStore.setHands((data.hands as Record<string, string>) || {});
		});
	};

	const toggleRaiseHand = async () => {
		try {
			const currentUserId = currentUser.currentUser.value?.user_id as string;
			if (!currentUserId) return;

			const isCurrentlyRaised = !!raiseHandStore.raisedHands?.[currentUserId];
			const newRaisedState = !isCurrentlyRaised;

			if (newRaisedState) {
				raiseHandStore.raiseHand(currentUserId, new Date().toISOString());
			} else {
				raiseHandStore.lowerHand(currentUserId);
			}

			if (sfuClient.isConnected()) {
				try {
					await sfuClient.sendRaiseHand(newRaisedState);
				} catch (serverError) {
					if (isCurrentlyRaised) {
						raiseHandStore.raiseHand(currentUserId, new Date().toISOString());
					} else {
						raiseHandStore.lowerHand(currentUserId);
					}
					console.error("Failed to toggle raise hand on server:", serverError);
				}
			} else {
				if (isCurrentlyRaised) {
					raiseHandStore.raiseHand(currentUserId, new Date().toISOString());
				} else {
					raiseHandStore.lowerHand(currentUserId);
				}
				console.error("Cannot toggle raise hand: not connected to SFU");
			}
		} catch (error) {
			console.error("Failed to toggle raise hand:", error);
		}
	};

	return {
		setupRaiseHandEvents,
		toggleRaiseHand,
	};
}
