<template>
	<div v-if="lobbyUsers.length > 0" class="">
		<div class="px-4 py-2 text-xs font-medium text-ink-gray-5 tracking-wide bg-surface-gray-1 flex items-center justify-between">
			<span>Waiting to join</span>
			<Button
				variant="ghost"
				size="sm"
				@click="$emit('approve-all')"
				class="text-xs font-medium "
			>
				Admit all
			</Button>
		</div>
		<div
			v-for="lobbyUser in lobbyUsers"
			:key="lobbyUser.userId"
			class="flex items-center justify-between mx-4 py-3 border-b last:border-b-0 border-outline-gray-1"
		>
			<div class="flex items-center gap-3">
				<img
					v-if="lobbyUser.avatar"
					:src="lobbyUser.avatar"
					:alt="lobbyUser.name || lobbyUser.userId || 'Guest'"
					class="w-9 h-9 rounded-full object-cover"
				/>
				<div
					v-else
					class="w-9 h-9 rounded-full bg-surface-gray-3 flex items-center justify-center text-sm font-medium text-ink-gray-7"
				>
					{{ getInitials(lobbyUser.name || lobbyUser.userId || 'Guest') }}
				</div>
				<div class="flex items-center gap-2">
					<div class="text-sm font-medium text-ink-gray-8 truncate max-w-40">
						{{ lobbyUser.name || lobbyUser.userId || 'Guest' }}
					</div>
					<Badge v-if="lobbyUser.isGuest" size="sm">
						Guest
					</Badge>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					theme="green"
					@click="$emit('approve', lobbyUser.userId)"
				>
					<lucide-check class="w-4 h-4" />
				</Button>
				<Button
					variant="outline"
					size="sm"
					theme="red"
					@click="$emit('reject', lobbyUser.userId)"
				>
					<lucide-x class="w-4 h-4" />
				</Button>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { Badge, Button } from "frappe-ui";
import { getInitials } from "../utils/text";

interface LobbyUser {
	userId: string;
	name?: string;
	avatar?: string;
	isGuest?: boolean;
	joinedAt?: number;
}

interface Props {
	lobbyUsers: LobbyUser[];
}

const props = withDefaults(defineProps<Props>(), {
	lobbyUsers: () => [],
});

defineEmits<{
	approve: [participantId: string];
	reject: [participantId: string];
	"approve-all": [];
}>();
</script>
