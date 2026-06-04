<template>
	<SettingsLayoutBase
		title="Meeting Access"
		description="Manage how participants can join and interact in the meeting."
	>
		<template #content>
			<div class="space-y-6">
				<!-- Allow Guest Toggle -->
				<div class="space-y-3">
					<Switch
						class="w-full !px-0"
						label="Allow Guests"
						description="Allow non-registered users to join this meeting"
						v-model="allowGuest"
						:disabled="meetingDoc.updateSettings.loading || meetingDoc.get.loading"
					/>
				</div>

				<!-- Meeting Type Selector -->
				<div>
					<FormControl
						v-model="meetingType"
						type="select"
						label="Control who can join this meeting"
						:options="[
							{
								label: 'Open - Anyone can join directly',
								value: 'open',
							},
							{
								label: 'Restricted - Requires host approval',
								value: 'restricted',
							},
						]"
						:disabled="meetingDoc.updateSettings.loading || meetingDoc.get.loading"
					/>
				</div>

				<div class="space-y-3">
					<Switch
						class="w-full !px-0"
						label="Host Only Chat"
						description="Restrict chat so only hosts and co-hosts can send messages"
						v-model="hostOnlyChat"
						:disabled="meetingDoc.updateSettings.loading || meetingDoc.get.loading"
					/>
				</div>

				<!-- E2EE Toggle -->
				<div class="space-y-3">
					<Switch
						class="w-full !px-0"
						label="End-to-end encryption"
						description="Convert this meeting to E2EE to require a meeting key on join."
						v-model="e2eeEnabled"
						:disabled="isConvertingToE2EE || meetingDoc.updateSettings.loading || meetingDoc.get.loading || e2eeEnabled"
					/>
				</div>

				<div v-if="showKeyField" class="space-y-2">
					<p class="text-sm font-medium text-ink-gray-8">Meeting key</p>
					<ClickToCopyField :text-content="e2eeKey" />
					<p class="text-xs text-ink-gray-6">
						Share this key with participants through a secure channel (in
						person, encrypted messenger, etc.). Anyone with the key can join
						the meeting.
					</p>
				</div>
			</div>
		</template>
	</SettingsLayoutBase>
</template>

<script setup lang="ts">
import { debounce, FormControl, frappeRequest, Switch, toast } from "frappe-ui";
import { computed, onMounted, ref, watch } from "vue";
import { useChatStore } from "@/composables/useChatStore";
import { useMeetingDoc } from "../../composables/useMeetingDoc";
import {
	computeE2EEKeyProof,
	generateE2EEKey,
	generateE2EEKeyVersion,
} from "../../utils/media/e2ee";
import ClickToCopyField from "../ClickToCopyField.vue";
import SettingsLayoutBase from "./SettingsLayoutBase.vue";

const props = defineProps({
	meetingId: {
		type: String,
		required: true,
	},
});

const {
	getMeetingDoc,
	allowGuest: globalAllowGuest,
	meetingType: globalMeetingType,
	e2eeEnabled: globalE2EEEnabled,
} = useMeetingDoc();

const chatStore = useChatStore();

const allowGuest = ref<boolean>(globalAllowGuest.value);
const meetingType = ref<string>(globalMeetingType.value);
const hostOnlyChat = ref<boolean>(chatStore.hostOnlyChat);
const e2eeEnabled = ref<boolean>(globalE2EEEnabled.value);
const e2eeKey = ref<string>("");
const isConvertingToE2EE = ref(false);
const showKeyField = computed(
	() => e2eeEnabled.value && Boolean(e2eeKey.value),
);

const meetingDoc = getMeetingDoc(props.meetingId);

let detailsLoaded = false;

onMounted(async () => {
	try {
		allowGuest.value = globalAllowGuest.value;
		meetingType.value = globalMeetingType.value;
		if (meetingDoc.doc?.host_only_chat !== undefined) {
			hostOnlyChat.value = !!meetingDoc.doc.host_only_chat;
		}
		e2eeEnabled.value = globalE2EEEnabled.value;
		if (e2eeEnabled.value) {
			await loadE2EEDetails();
		}
	} catch (error) {
		console.error("Failed to load meeting settings");
	} finally {
		detailsLoaded = true;
	}
});

const loadE2EEDetails = async () => {
	try {
		const response = (await frappeRequest({
			url: "meet.api.meeting.get_meeting_e2ee_details",
			params: {
				meeting_id: props.meetingId,
			},
		})) as {
			e2ee_enabled?: boolean;
			e2ee_key_version?: string | null;
			message?: {
				e2ee_enabled?: boolean;
				e2ee_key_version?: string | null;
			};
		};

		const payload = response.message || response;

		e2eeEnabled.value = Boolean(payload.e2ee_enabled);
	} catch (error) {
		console.error("Failed to load E2EE details:", error);
	}
};

watch(e2eeEnabled, async (val, oldVal) => {
	if (!detailsLoaded) return;
	if (!val || oldVal) return;
	if (isConvertingToE2EE.value) return;

	isConvertingToE2EE.value = true;
	try {
		const key = generateE2EEKey();
		const keyVersion = generateE2EEKeyVersion();
		const keyProof = await computeE2EEKeyProof(keyVersion, key);

		// Prime this tab's SfuClient with the key BEFORE the API call so the
		// host's mid-meeting reconfigure (triggered by meeting:e2ee_enabled)
		// doesn't have to ask the host to re-enter a key they just generated.
		// We dispatch before the API call because the server emits the realtime
		// event as a side effect of the API call, and either may arrive first.
		// If the API call fails, the SfuClient retains an unused passphrase
		// which is benign (only consumed when the meeting is actually E2EE).
		// Guests in other tabs still see the dialog because they don't
		// receive this event.
		document.dispatchEvent(
			new CustomEvent("meet:e2ee-key-set", {
				detail: { key },
			}),
		);

		const response = (await frappeRequest({
			url: "meet.api.meeting.convert_meeting_to_e2ee",
			params: {
				meeting_id: props.meetingId,
				e2ee_key_proof: keyProof,
				e2ee_key_version: keyVersion,
			},
		})) as {
			e2ee_enabled?: boolean;
			message?: { e2ee_enabled?: boolean };
		};

		const payload = response.message || response;

		e2eeKey.value = key;

		await meetingDoc.reload();
		toast.success(
			"Meeting converted to E2EE. Share the key with participants through a secure channel.",
		);
	} catch (error) {
		console.error("Failed to enable E2EE:", error);
		e2eeEnabled.value = false;
		toast.error("Failed to enable E2EE for this meeting");
	} finally {
		isConvertingToE2EE.value = false;
	}
});

const saveSettings = debounce(async () => {
	if (meetingDoc.updateSettings.loading) return;

	try {
		await meetingDoc.updateSettings.submit({
			allow_guest: allowGuest.value,
			meeting_type: meetingType.value,
			host_only_chat: hostOnlyChat.value,
		});

		await meetingDoc.reload();
	} catch (error) {
		console.error("Failed to update meeting settings:", error);
		toast.error("Failed to update meeting settings");

		if (meetingDoc.doc?.host_only_chat !== undefined) {
			hostOnlyChat.value = !!meetingDoc.doc.host_only_chat;
		}
	}
}, 300);

watch(hostOnlyChat, (newValue) => {
	chatStore.hostOnlyChat = newValue;
});
watch([allowGuest, meetingType, hostOnlyChat], () => {
	if (!meetingDoc.get.loading) {
		saveSettings();
	}
});
</script>
