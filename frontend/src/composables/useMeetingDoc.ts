import { createDocumentResource } from "frappe-ui";
import { type ComputedRef, type Ref, computed, ref } from "vue";
import { session } from "../data/session.js";

interface MeetingDocument {
	allow_guest?: boolean;
	meeting_type?: string;
	owner?: string;
	title?: string;
	name?: string;
}

interface DocumentResource {
	doc?: MeetingDocument;
	setValue: {
		submit(params: Record<string, unknown>): Promise<unknown>;
	};
	reload(): Promise<void>;
}

interface UseMeetingDocReturn {
	getMeetingDoc: (meetingId: string) => DocumentResource;
	getCurrentMeetingDoc: () => DocumentResource | null;
	clearMeetingDoc: () => void;
	meetingTitle: ComputedRef<string>;
	meetingOwner: ComputedRef<string>;
	isCurrentUserHost: ComputedRef<boolean>;
	meetingType: ComputedRef<string>;
	allowGuest: ComputedRef<boolean>;
}

const meetingDoc: Ref<DocumentResource | null> = ref(null);
const currentMeetingId: Ref<string | null> = ref(null);

export function useMeetingDoc(): UseMeetingDocReturn {
	const getMeetingDoc = (meetingId: string): DocumentResource => {
		if (meetingDoc.value && currentMeetingId.value === meetingId) {
			return meetingDoc.value;
		}

		const docResource = createDocumentResource({
			doctype: "Sae Meeting",
			name: meetingId,
			auto: session.isLoggedIn,
		});

		meetingDoc.value = docResource;
		currentMeetingId.value = meetingId;

		return docResource;
	};

	const getCurrentMeetingDoc = (): DocumentResource | null => {
		return meetingDoc.value;
	};

	const clearMeetingDoc = (): void => {
		meetingDoc.value = null;
		currentMeetingId.value = null;
	};

	const meetingTitle = computed((): string => {
		const doc = meetingDoc.value?.doc;
		return doc?.title || doc?.name || currentMeetingId.value || "";
	});

	const meetingOwner = computed((): string => {
		return meetingDoc.value?.doc?.owner || "";
	});

	const isCurrentUserHost = computed((): boolean => {
		const currentUserId = session.user?.sessionUser;
		const ownerId = meetingOwner.value;
		return Boolean(currentUserId && ownerId && currentUserId === ownerId);
	});

	const meetingType = computed((): string => {
		return meetingDoc.value?.doc?.meeting_type || "open";
	});

	const allowGuest = computed((): boolean => {
		return Boolean(meetingDoc.value?.doc?.allow_guest);
	});

	return {
		getMeetingDoc,
		getCurrentMeetingDoc,
		clearMeetingDoc,
		meetingTitle,
		meetingOwner,
		isCurrentUserHost,
		meetingType,
		allowGuest,
	};
}
