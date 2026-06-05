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
						description="Convert this meeting to E2EE. The SFU sees only encrypted bytes; media is decrypted on participants' devices."
						v-model="e2eeEnabled"
						:disabled="isConvertingToE2EE || meetingDoc.updateSettings.loading || meetingDoc.get.loading || e2eeEnabled"
						data-testid="e2ee-toggle"
					/>
				</div>

				<div v-if="e2eeEnabled && e2eeFingerprint" class="space-y-2">
					<p class="text-sm font-medium text-ink-gray-8">E2EE Fingerprint</p>
					<ClickToCopyField :text-content="e2eeFingerprint" />
					<p class="text-xs text-ink-gray-6">
						Participants can verify they're in the right meeting by
						comparing this fingerprint.
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
import { useDeviceIdentity } from "../../composables/useDeviceIdentity";
import { useMeetingDoc } from "../../composables/useMeetingDoc";
import {
	exportEd25519PublicKey,
	exportPublicKey,
	formatFingerprint,
	generateE2EEKeyVersion,
	importEd25519PublicKey,
	signProof,
	x25519KeyPair,
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
const e2eeFingerprint = ref<string>("");
const deviceId = ref<string>("");
const isConvertingToE2EE = ref(false);

const meetingDoc = getMeetingDoc(props.meetingId);

const { getIdentity } = useDeviceIdentity();

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
			e2ee_host_public_key?: string | null;
			message?: {
				e2ee_enabled?: boolean;
				e2ee_key_version?: string | null;
				e2ee_host_public_key?: string | null;
			};
		};

		const payload = response.message || response;

		e2eeEnabled.value = Boolean(payload.e2ee_enabled);
		if (payload.e2ee_host_public_key) {
			e2eeFingerprint.value = formatFingerprint(payload.e2ee_host_public_key);
		}
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
		// E2EE: per-device ed25519 auth key + X25519 meeting anchor.
		// See docs/adr/0003-per-device-host-identity.md and
		// docs/refactors/e2ee-modernization.md.
		const identity = await getIdentity();
		deviceId.value = identity.deviceId;

		await ensureDeviceRegistered(identity);

		const meetingKeyPair = await x25519KeyPair();
		const meetingPublicKey = await exportPublicKey(meetingKeyPair.publicKey);
		const keyVersion = generateE2EEKeyVersion();

		// Build the signed proof: bytes(X25519_pub) || bytes(key_version_ascii)
		const pubRaw = Uint8Array.from(atob(meetingPublicKey), (c) =>
			c.charCodeAt(0),
		);
		const message = new Uint8Array(pubRaw.length + keyVersion.length);
		message.set(pubRaw, 0);
		message.set(new TextEncoder().encode(keyVersion), pubRaw.length);
		const keyProof = await signProof(identity.authKeyPair.privateKey, message);

		// Broadcast to this tab and other tabs that E2EE is coming online.
		// Other tabs receive meeting:e2ee_enabled via realtime; the local
		// CustomEvent covers the host's own UI components that listen for
		// "E2EE is now on" without going through the realtime channel.
		document.dispatchEvent(
			new CustomEvent("meet:e2ee-host-enabled", {
				detail: {
					hostX25519KeyPair: meetingKeyPair,
					hostSigningKeyPair: identity.signingKeyPair,
					keyVersion,
				},
			}),
		);

		const hostSigningPublicKey = await exportEd25519PublicKey(
			identity.signingKeyPair.publicKey,
		);

		const response = (await frappeRequest({
			url: "meet.api.meeting.convert_meeting_to_e2ee",
			params: {
				meeting_id: props.meetingId,
				e2ee_key_proof: keyProof,
				e2ee_key_version: keyVersion,
				e2ee_host_public_key: meetingPublicKey,
				e2ee_host_signing_public_key: hostSigningPublicKey,
				e2ee_device_id: identity.deviceId,
			},
		})) as {
			e2ee_enabled?: boolean;
			e2ee_host_public_key?: string;
			message?: { e2ee_enabled?: boolean; e2ee_host_public_key?: string };
		};

		const payload = response.message || response;

		if (payload.e2ee_host_public_key) {
			e2eeFingerprint.value = formatFingerprint(payload.e2ee_host_public_key);
		}

		await meetingDoc.reload();
		toast.success(
			"Meeting is now end-to-end encrypted. Compare the fingerprint to verify authenticity.",
		);
	} catch (error) {
		console.error("Failed to enable E2EE:", error);
		e2eeEnabled.value = false;
		toast.error("Failed to enable E2EE for this meeting");
	} finally {
		isConvertingToE2EE.value = false;
	}
});

async function ensureDeviceRegistered(identity: {
	deviceId: string;
	authPublicKey: string;
}): Promise<void> {
	await frappeRequest({
		url: "meet.api.meeting.register_e2ee_device",
		params: {
			device_id: identity.deviceId,
			ed25519_public_key: identity.authPublicKey,
		},
		method: "POST",
	});
}

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
