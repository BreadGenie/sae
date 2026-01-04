<template>
	<div class="space-y-6">
		<!-- SFU Status Card -->
		<Card title="SFU Connection Status" class="w-full">
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center space-x-2">
						<div
							:class="[
								'w-3 h-3 rounded-full',
								sfuStatus.connected ? 'bg-green-500' : 'bg-red-500',
							]"
						></div>
						<span class="font-medium">
							{{ sfuStatus.connected ? "Connected" : "Disconnected" }}
						</span>
					</div>
					<Button @click="testConnection" :loading="testing" variant="outline" size="sm">
						Test Connection
					</Button>
				</div>

				<div class="grid grid-cols-2 gap-4 text-sm">
					<div>
						<span class="text-gray-600">Server URL:</span>
						<div class="font-mono">
							{{ sfuConfig.sfu_server_url || "Not configured" }}
						</div>
					</div>
					<div>
						<span class="text-gray-600">Port:</span>
						<div class="font-mono">
							{{ sfuConfig.sfu_server_port || "Not configured" }}
						</div>
					</div>
				</div>

				<div
					v-if="!sfuStatus.config_valid"
					class="p-3 bg-yellow-50 border border-yellow-200 rounded"
				>
					<div class="text-yellow-800 text-sm">
						<strong>Configuration Required:</strong> Please configure SFU settings in
						your site_config.json
					</div>
				</div>
			</div>
		</Card>

		<!-- Active Meetings Card -->
		<Card title="Active Meetings" class="w-full">
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<div class="text-2xl font-bold">{{ activeMeetings.length }}</div>
					<Button @click="refreshMeetings" variant="outline" size="sm"> Refresh </Button>
				</div>

				<div v-if="activeMeetings.length === 0" class="text-gray-500 text-center py-4">
					No active meetings
				</div>

				<div v-else class="space-y-2">
					<div
						v-for="meeting in activeMeetings"
						:key="meeting.name"
						class="flex items-center justify-between p-3 border rounded"
					>
						<div>
							<div class="font-medium">{{ meeting.name }}</div>
							<div class="text-sm text-gray-600">
								{{ meeting.participant_count }} participants
							</div>
						</div>
						<div class="text-xs text-gray-500">
							{{ formatDate(meeting.creation) }}
						</div>
					</div>
				</div>
			</div>
		</Card>

		<!-- Quick Actions Card -->
		<Card title="Quick Actions" class="w-full">
			<div class="space-y-3">
				<Button @click="createMeeting" :loading="creatingMeeting" class="w-full">
					Create New Meeting
				</Button>

				<Button
					@click="reconnectSFU"
					:loading="reconnecting"
					variant="outline"
					class="w-full"
				>
					Reconnect to SFU
				</Button>

				<Button @click="viewAnalytics" variant="outline" class="w-full">
					View Analytics
				</Button>
			</div>
		</Card>

		<!-- Configuration Help -->
		<Card title="Configuration Help" class="w-full">
			<div class="space-y-3 text-sm">
				<p>To configure the SFU connection, add the following to your site_config.json:</p>
				<pre class="bg-gray-100 p-3 rounded text-xs overflow-x-auto"><code>{
  "sfu_server_url": "http://localhost",
  "sfu_server_port": 3000,
  "sfu_api_key": "your-api-key",
  "sfu_secret": "your-secret",
  "turn_servers": [
    {
      "urls": "turn:your-turn-server.com:3478",
      "username": "username", 
      "credential": "password"
    }
  ]
}</code></pre>
			</div>
		</Card>
	</div>
</template>

<script setup>
import { createResource } from "frappe-ui";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();

// Reactive data
const sfuStatus = ref({
	connected: false,
	config_valid: false,
	active_rooms: 0,
});

const sfuConfig = ref({
	sfu_server_url: "",
	sfu_server_port: "",
	sfu_timeout: 30,
	enable_sfu_logging: false,
});

const activeMeetings = ref([]);
const testing = ref(false);
const creatingMeeting = ref(false);
const reconnecting = ref(false);

// Resources
const statusResource = createResource({
	url: "meet.api.config.get_sfu_status",
	auto: true,
	onSuccess: (data) => {
		sfuStatus.value = data.status;
		sfuConfig.value = data.config;
	},
});

const meetingsResource = createResource({
	url: "meet.api.config.get_active_meetings",
	auto: true,
	onSuccess: (data) => {
		activeMeetings.value = data.meetings;
	},
});

const testConnectionResource = createResource({
	url: "meet.api.config.test_sfu_connection",
	onSuccess: (data) => {
		if (data.success) {
			sfuStatus.value.connected = data.connected;
			// Show success message
			console.log("SFU connection test successful");
		}
	},
});

const createMeetingResource = createResource({
	url: "meet.api.meeting.create",
	onSuccess: (meetingId) => {
		router.push({ name: "Meeting", params: { id: meetingId } });
	},
});

const reconnectResource = createResource({
	url: "meet.api.config.reconnect_sfu",
	onSuccess: (data) => {
		if (data.success) {
			sfuStatus.value.connected = data.connected;
			console.log("SFU reconnection successful");
		}
	},
});

// Methods
const testConnection = async () => {
	testing.value = true;
	try {
		await testConnectionResource.submit();
	} finally {
		testing.value = false;
	}
};

const createMeeting = async () => {
	creatingMeeting.value = true;
	try {
		await createMeetingResource.submit();
	} finally {
		creatingMeeting.value = false;
	}
};

const reconnectSFU = async () => {
	reconnecting.value = true;
	try {
		await reconnectResource.submit();
	} finally {
		reconnecting.value = false;
	}
};

const refreshMeetings = () => {
	meetingsResource.reload();
};

const viewAnalytics = () => {
	// Navigate to analytics page or show analytics modal
	console.log("View analytics clicked");
};

const formatDate = (dateString) => {
	return new Date(dateString).toLocaleString();
};

onMounted(() => {
	// Initial load
	statusResource.reload();
	meetingsResource.reload();
});
</script>
