<template>
	<div>
		<FrappeUIProvider>
			<router-view />
			<Dialogs />
		</FrappeUIProvider>
	</div>
</template>

<script setup lang="ts">
import { Dialogs, FrappeUIProvider } from "frappe-ui";
</script>
