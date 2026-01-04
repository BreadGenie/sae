<template>
	<div class="flex h-screen overflow-hidden mt-20 justify-center">
		<div class="w-full max-w-sm mt-4 space-y-6">
			<FrappeMeetingLogo class="h-10 w-auto" />
			<h1 class="text-2xl font-bold leading-5 tracking-tight text-gray-900">Login to Frappe Meet</h1>
			<form class="flex flex-col space-y-4 w-full px-1" @submit.prevent="submit">
				<FormControl
					required
					variant="outline"
					name="email"
					type="text"
					placeholder="johndoe@email.com"
					label="User ID"
				/>
				<FormControl
					required
					variant="outline"
					name="password"
					type="password"
					placeholder="••••••"
					label="Password"
				/>
				<Button :loading="session.login.loading" variant="solid" type="submit">Login</Button>
			</form>
			<div v-if="oAuthProviders.data?.length">
				<div  class="mt-6 border-t text-center">
					<div class="-translate-y-1/2 transform">
						<span
							class="relative bg-surface-white px-2 text-sm font-medium leading-8 text-ink-gray-8"
						>
							or
						</span>
					</div>
				</div>
				<Button
					v-for="provider in oAuthProviders.data"
					:key="provider.name"
					class="mb-2 w-full"
					:link="provider.auth_url"
				>
					<div class="flex items-center">
						<div v-html="provider.icon" />
						<span class="ml-2">
							Continue with
							{{ provider.provider_name }}
						</span>
					</div>
				</Button>
			</div>
		</div>
	</div>
</template>

<script lang="ts" setup>
import { Button, FormControl, createResource, toast } from "frappe-ui";
import { useRoute, useRouter } from "vue-router";
import { session } from "../data/session";
import { userResource } from "../data/user";
import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";

const router = useRouter();
const route = useRoute();

const oAuthProviders = createResource({
	url: "meet.api.account.oauth_providers",
	params: {
		redirect_url: route.query.next || "",
	},
	auto: true,
});

function submit(e: Event) {
	const formData = new FormData(e.target as HTMLFormElement);
	session.login.submit(
		{
			email: formData.get("email"),
			password: formData.get("password"),
		},
		{
			onSuccess: async () => {
				await userResource.reload();
				await session.login.reset();
				const nextPath = route.query.next;
				if (typeof nextPath === "string" && nextPath.length) {
					if (nextPath.startsWith("/")) {
						router.push({
							name: "Meeting",
							params: { meetingId: nextPath.slice(1) },
						});
						return;
					}
				}
				router.push({ name: "Home" });
			},
			onError: (error: { message?: string } | Error) => {
				const msg = (error as { message?: string })?.message ?? String(error);
				toast.error(`Login failed: ${msg}`);
			},
		},
	);
}
</script>
