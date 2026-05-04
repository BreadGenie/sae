import { type Ref, ref } from "vue";

export interface LobbyUser {
	userId: string;
	name: string;
	avatar?: string;
	requested_at?: string;
	isGuest?: boolean;
}

export interface LobbyStore {
	isWaitingForApproval: Ref<boolean>;
	isJoinRequestRejected: Ref<boolean>;
	lobbyUsers: Ref<LobbyUser[]>;
	lobbyParticipantCount: Ref<number>;
	isInLobby: Ref<boolean>;
	waitingUsers: Ref<unknown[]>;
	loadingUsers: Ref<unknown[]>;
	setLobbyUsers: (users: LobbyUser[]) => void;
	addLobbyUser: (user: LobbyUser) => void;
	removeLobbyUser: (userId: string) => void;
	resetLobbyStore: () => void;
}

let instance: LobbyStore | null = null;

export function useLobbyStore(): LobbyStore {
	if (instance) return instance;

	const isWaitingForApproval = ref(false);
	const isJoinRequestRejected = ref(false);
	const lobbyUsers = ref<LobbyUser[]>([]);
	const lobbyParticipantCount = ref(0);
	const isInLobby = ref(false);
	const waitingUsers = ref<unknown[]>([]);
	const loadingUsers = ref<unknown[]>([]);

	const setLobbyUsers = (users: LobbyUser[]) => {
		lobbyUsers.value = users;
	};

	const addLobbyUser = (user: LobbyUser) => {
		const current = lobbyUsers.value || [];
		const exists = current.some((u) => u.userId === user.userId);
		if (!exists) {
			lobbyUsers.value = [...current, user];
		}
	};

	const removeLobbyUser = (userId: string) => {
		lobbyUsers.value = (lobbyUsers.value || []).filter(
			(u) => u.userId !== userId,
		);
	};

	const resetLobbyStore = () => {
		isWaitingForApproval.value = false;
		isJoinRequestRejected.value = false;
		lobbyUsers.value = [];
		lobbyParticipantCount.value = 0;
		isInLobby.value = false;
		waitingUsers.value = [];
		loadingUsers.value = [];
	};

	instance = {
		isWaitingForApproval,
		isJoinRequestRejected,
		lobbyUsers,
		lobbyParticipantCount,
		isInLobby,
		waitingUsers,
		loadingUsers,
		setLobbyUsers,
		addLobbyUser,
		removeLobbyUser,
		resetLobbyStore,
	};

	return instance;
}
