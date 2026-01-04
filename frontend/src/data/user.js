import router from "@/router";
import { createResource } from "frappe-ui";

export const userResource = createResource({
	url: "meet.api.account.get_logged_in_user",
	cache: "User",
	onError(error) {
		if (error && error.exc_type === "AuthenticationError") {
			router.push({ name: "Login" });
		}
	},
});
