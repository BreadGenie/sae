import { type ComputedRef, computed, type Ref, ref } from "vue";
import { getInitials } from "../utils/text";

export interface CurrentUser {
	currentUser: Ref<Record<string, unknown>>;
	userInitials: ComputedRef<string>;
	userAvatar: ComputedRef<string>;
	isCreator: Ref<boolean>;
	setCurrentUser: (user: Record<string, unknown>) => void;
	resetCurrentUser: () => void;
}

let instance: CurrentUser | null = null;

export function useCurrentUser(): CurrentUser {
	if (instance) return instance;

	const currentUser = ref<Record<string, unknown>>({});
	const isCreator = ref(false);

	const userInitials = computed(() => {
		const name =
			(currentUser.value as Record<string, unknown>)?.full_name ??
			(currentUser.value as Record<string, unknown>)?.name ??
			"You";
		return getInitials(name as string);
	});

	const userAvatar = computed(() => {
		return (
			((currentUser.value as Record<string, unknown>)?.avatar as string) || ""
		);
	});

	const setCurrentUser = (user: Record<string, unknown>) => {
		currentUser.value = user;
	};

	const resetCurrentUser = () => {
		currentUser.value = {};
		isCreator.value = false;
	};

	instance = {
		currentUser,
		userInitials,
		userAvatar,
		isCreator,
		setCurrentUser,
		resetCurrentUser,
	};

	return instance;
}
