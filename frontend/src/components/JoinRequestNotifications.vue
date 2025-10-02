<template>
	<Teleport to="body">
		<div v-if="joinRequests.length > 0" class="fixed bottom-4 right-4 z-50 space-y-2">
			<TransitionGroup name="notification" tag="div" class="relative space-y-2">
				<div
					v-for="request in joinRequests"
					:key="request.user_id"
					class="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-4 min-w-80 max-w-96"
				>
					<div class="flex items-center space-x-3 mb-4">
						<div
							class="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0"
						>
							<img
								v-if="request.user_image"
								:src="request.user_image"
								:alt="request.user_name"
								class="w-10 h-10 rounded-full object-cover"
							/>
							<span v-else class="text-sm font-medium text-blue-400">
								{{ getInitials(request.user_name || request.user_id) }}
							</span>
						</div>

						<div class="flex-1 min-w-0">
							<p class="text-sm text-gray-200">
								<span class="font-semibold text-white">
									{{ request.user_name || request.user_id }}
								</span>
								wants to join the meeting
							</p>
						</div>
					</div>

					<div class="flex space-x-2">
						<Button
							variant="outline"
							size="sm"
							theme="green"
							@click="$emit('approve-user', request.user_id)"
							:disabled="loadingUsers.includes(request.user_id)"
							class="flex-1"
						>
							<template #prefix>
								<lucide-check class="w-3 h-3 mr-1" />
							</template>
							Admit
						</Button>
						<Button
							variant="outline"
							theme="red"
							size="sm"
							@click="$emit('reject-user', request.user_id)"
							:disabled="loadingUsers.includes(request.user_id)"
							class="flex-1"
						>
							<template #prefix>
								<lucide-x class="w-3 h-3 mr-1" />
							</template>
							Deny
						</Button>
					</div>
				</div>
			</TransitionGroup>
		</div>
	</Teleport>
</template>

<script setup>
import { Button } from "frappe-ui";
import { computed, ref, watch } from "vue";
import { getInitials } from "../utils/text";

const props = defineProps({
	waitingUsers: {
		type: [Array, Object],
		default: () => [],
	},
	loadingUsers: {
		type: [Array, Object],
		default: () => [],
	},
	maxVisible: {
		type: Number,
		default: 3,
	},
});

defineEmits(["approve-user", "reject-user", "view-all-requests"]);

const dismissedRequests = ref([]);

const waitingUsers = computed(() => {
	const users = props.waitingUsers?.value || props.waitingUsers;
	return Array.isArray(users) ? users : [];
});

const loadingUsers = computed(() =>
	Array.isArray(props.loadingUsers) ? props.loadingUsers : [],
);

const joinRequests = computed(() => {
	return waitingUsers.value
		.filter((user) => !dismissedRequests.value.includes(user.user_id))
		.slice(-props.maxVisible)
		.reverse();
});

const forceHide = (userId) => {
	if (!dismissedRequests.value.includes(userId)) {
		dismissedRequests.value.push(userId);
	}
};

defineExpose({ forceHide });

const previousWaitingUsers = ref([]);
watch(
	() => waitingUsers.value,
	(newUsersArray, oldUsersArray) => {
		if (oldUsersArray && newUsersArray.length < oldUsersArray.length) {
			// Some users were removed, clear dismissed list
			const currentUserIds = new Set(newUsersArray.map((u) => u.user_id));
			dismissedRequests.value = dismissedRequests.value.filter((id) =>
				currentUserIds.has(id),
			);
		}
		previousWaitingUsers.value = [...newUsersArray];
	},
	{ immediate: true },
);
</script>

<style scoped>
.notification-enter-active,
.notification-leave-active {
	transition: all 0.4s ease;
}

.notification-leave-active {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	z-index: 10;
	width: 100%;
}

.notification-enter-from,
.notification-leave-to {
	opacity: 0;
	transform: translateX(100%) scale(0.95);
}

.notification-move {
	transition: transform 0.4s ease;
}
</style>
