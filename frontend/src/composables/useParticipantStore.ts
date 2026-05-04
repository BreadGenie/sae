import { type Ref, ref } from "vue";

export interface ParticipantStore {
	participants: Ref<Record<string, unknown>>;
	remoteVideos: Ref<Record<string, HTMLVideoElement>>;
	activeSpeakerIds: Ref<string[]>;
	stableSpeakerIds: Ref<string[]>;
	speakerStartTimes: Ref<Record<string, number>>;
	addParticipant: (participant: Record<string, unknown>) => void;
	removeParticipant: (participantId: string) => void;
	updateParticipant: (
		participantId: string,
		updates: Record<string, unknown>,
	) => void;
	getParticipantName: (participantId: string) => string;
	resetParticipantStore: () => void;
}

let instance: ParticipantStore | null = null;

export function useParticipantStore(): ParticipantStore {
	if (instance) return instance;

	const participants = ref<Record<string, unknown>>({});
	const remoteVideos = ref<Record<string, HTMLVideoElement>>({});
	const activeSpeakerIds = ref<string[]>([]);
	const stableSpeakerIds = ref<string[]>([]);
	const speakerStartTimes = ref<Record<string, number>>({});

	const addParticipant = (participant: Record<string, unknown>) => {
		const userId = participant.user_id as string;
		if (!userId) return;
		participants.value[userId] = participant;
	};

	const removeParticipant = (participantId: string) => {
		delete participants.value[participantId];

		const videoEl = remoteVideos.value[participantId];
		const srcObj = (videoEl as HTMLVideoElement)?.srcObject;
		if (srcObj) {
			for (const track of srcObj.getTracks()) {
				track.stop();
			}
			(videoEl as HTMLVideoElement).srcObject = null;
		}
		delete remoteVideos.value[participantId];
	};

	const updateParticipant = (
		participantId: string,
		updates: Record<string, unknown>,
	) => {
		const participant = participants.value[participantId] as
			| Record<string, unknown>
			| undefined;
		if (participant) {
			participants.value[participantId] = { ...participant, ...updates };
		}
	};

	const getParticipantName = (participantId: string): string => {
		const participant = participants.value[participantId] as
			| Record<string, unknown>
			| undefined;
		return (participant?.user_name as string) || participantId;
	};

	const resetParticipantStore = () => {
		participants.value = {};
		remoteVideos.value = {};
		activeSpeakerIds.value = [];
		stableSpeakerIds.value = [];
		speakerStartTimes.value = {};
	};

	instance = {
		participants,
		remoteVideos,
		activeSpeakerIds,
		stableSpeakerIds,
		speakerStartTimes,
		addParticipant,
		removeParticipant,
		updateParticipant,
		getParticipantName,
		resetParticipantStore,
	};

	return instance;
}
