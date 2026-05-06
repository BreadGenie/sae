import { createResource } from "frappe-ui";
import { computed, reactive } from "vue";
import router from "@/router";
import { userResource } from "./user";

interface LoginParams {
	email: string;
	password: string;
}

function sessionUser(): string | null {
	const cookies = new URLSearchParams(document.cookie.split("; ").join("&"));
	let _sessionUser = cookies.get("user_id");
	if (_sessionUser === "Guest") {
		_sessionUser = null;
	}
	return _sessionUser;
}

export const session = reactive({
	login: createResource({
		url: "login",
		makeParams({ email, password }: LoginParams) {
			return {
				usr: email,
				pwd: password,
			};
		},
	}),
	logout: createResource({
		url: "logout",
		onSuccess() {
			userResource.reset();
			session.user = computed(() => ({
				sessionUser: sessionUser(),
				...userResource.data,
			}));
			router.replace({ name: "Login" });
		},
	}),
	user: computed(() => ({
		sessionUser: sessionUser(),
		...userResource.data,
	})),
	isLoggedIn: computed(() => !!session.user.sessionUser),
});
