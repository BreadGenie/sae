<template>
	<div class="space-y-3">
		<Switch
			class="w-full !px-0"
			label="End-to-end encryption"
			:description="e2eeDescription"
			v-model="e2eeEnabled"
			:disabled="isToggleDisabled"
			data-testid="e2ee-toggle"
		/>

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

<script setup lang="ts">
import { frappeRequest, Switch, toast } from "frappe-ui";
import { computed, onMounted, ref, watch } from "vue";
import { useDeviceIdentity } from "../../composables/useDeviceIdentity";
import {
	exportEd25519PublicKey,
	exportPublicKey,
	featureDetectX25519,
	formatFingerprint,
	generateE2EEKeyVersion,
	signProof,
	x25519KeyPair,
} from "../../utils/media/e2ee";
import { bytesFromBase64 } from "../../utils/media/e2eePrimitives";
import ClickToCopyField from "../ClickToCopyField.vue";

interface MeetingDocument {
	allow_guest?: boolean;
	meeting_type?: string;
	e2ee_enabled?: boolean;
	host_only_chat?: boolean;
}

interface E2EESettingsSectionProps {
	meetingId: string;
	meetingDoc: {
		doc?: MeetingDocument;
		reload: () => Promise<void>;
		updateSettings: { loading: boolean };
		get: { loading: boolean };
	};
	globallyEnabled: boolean;
}

const props = defineProps<E2EESettingsSectionProps>();

const { getIdentity } = useDeviceIdentity();

const e2eeEnabled = ref<boolean>(props.globallyEnabled);
const e2eeFingerprint = ref<string>("");
const isConvertingToE2EE = ref(false);
const isX25519Supported = ref<boolean | null>(null);

let detailsLoaded = false;

const e2eeDescription = computed(() => {
	if (isX25519Supported.value === false) {
		return "E2EE requires X25519 support in WebCrypto. Update your browser to enable it.";
	}
	return "Convert this meeting to E2EE. The SFU sees only encrypted bytes; media is decrypted on participants' devices.";
});

const isToggleDisabled = computed(
	() =>
		isConvertingToE2EE.value ||
		props.meetingDoc.updateSettings.loading ||
		props.meetingDoc.get.loading ||
		e2eeEnabled.value ||
		isX25519Supported.value !== true,
);

onMounted(async () => {
	try {
		isX25519Supported.value = await featureDetectX25519();
		e2eeEnabled.value = props.globallyEnabled;
		if (e2eeEnabled.value) {
			await loadE2EEDetails();
		}
	} catch (error) {
		console.error("Failed to load E2EE settings:", error);
	} finally {
		detailsLoaded = true;
	}
});

const loadE2EEDetails = async () => {
	try {
		const response = (await frappeRequest({
			url: "meet.api.meeting.get_meeting_e2ee_details",
			params: { meeting_id: props.meetingId },
		})) as {
			e2ee_enabled?: boolean;
			e2ee_host_public_key?: string | null;
			message?: {
				e2ee_enabled?: boolean;
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

const registerE2EEDevice = async (identity: {
	deviceId: string;
	authPublicKey: string;
}): Promise<void> => {
	await frappeRequest({
		url: "meet.api.meeting.register_e2ee_device",
		params: {
			device_id: identity.deviceId,
			ed25519_public_key: identity.authPublicKey,
		},
		method: "POST",
	});
};

watch(e2eeEnabled, async (val, oldVal) => {
	if (!detailsLoaded) return;
	if (!val || oldVal) return;
	if (isConvertingToE2EE.value) return;
	if (!(await featureDetectX25519())) {
		e2eeEnabled.value = false;
		isX25519Supported.value = false;
		toast.error("E2EE requires a newer browser with X25519 support.");
		return;
	}

	isConvertingToE2EE.value = true;
	try {
		// E2EE: per-device ed25519 auth key + X25519 meeting anchor.
		// See docs/adr/0003-per-device-host-identity.md and
		// docs/refactors/e2ee-modernization.md.
		const identity = await getIdentity();
		await registerE2EEDevice(identity);

		const meetingKeyPair = await x25519KeyPair();
		const meetingPublicKey = await exportPublicKey(meetingKeyPair.publicKey);
		const keyVersion = generateE2EEKeyVersion();

		// Build the signed proof: bytes(X25519_pub) || bytes(key_version_ascii)
		const pubRaw = bytesFromBase64(meetingPublicKey);
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
			e2ee_host_public_key?: string;
			message?: { e2ee_host_public_key?: string };
		};

		const payload = response.message || response;

		if (payload.e2ee_host_public_key) {
			e2eeFingerprint.value = formatFingerprint(payload.e2ee_host_public_key);
		}

		await props.meetingDoc.reload();
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
</script>
