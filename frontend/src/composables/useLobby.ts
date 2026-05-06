import { frappeRequest, toast } from "frappe-ui";
import { getErrorMessage } from "../utils/error";
import type { LobbyStore } from "./useLobbyStore";

interface LobbyAPI {
	approveUser: (userId: string) => Promise<void>;
	approveAllUsers: () => Promise<void>;
	rejectUser: (userId: string) => Promise<void>;
}

export function useLobby(deps: {
	lobbyStore: LobbyStore;
	meetingId: string;
}): LobbyAPI {
	const { lobbyStore, meetingId } = deps;

	const approveUser = async (userId: string) => {
		try {
			await frappeRequest({
				url: "meet.api.meeting.approve_join_request",
				params: {
					meeting_id: meetingId,
					user_id: userId,
				},
			});

			lobbyStore.removeLobbyUser(userId);
		} catch (error) {
			console.error("Failed to approve user:", error);
			toast.error(getErrorMessage(error));
		}
	};

	const approveAllUsers = async () => {
		try {
			await frappeRequest({
				url: "meet.api.meeting.approve_all_join_requests",
				params: {
					meeting_id: meetingId,
				},
			});

			lobbyStore.setLobbyUsers([]);
		} catch (error) {
			console.error("Failed to approve all users:", error);
			toast.error(getErrorMessage(error));
		}
	};

	const rejectUser = async (userId: string) => {
		try {
			await frappeRequest({
				url: "meet.api.meeting.reject_join_request",
				params: {
					meeting_id: meetingId,
					user_id: userId,
				},
			});

			lobbyStore.removeLobbyUser(userId);
		} catch (error) {
			console.error("Failed to reject user:", error);
			toast.error(getErrorMessage(error));
		}
	};

	return {
		approveUser,
		approveAllUsers,
		rejectUser,
	};
}
