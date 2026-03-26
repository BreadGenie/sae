import { userResource } from "@/data/user";
import { createRouter, createWebHistory } from "vue-router";
import { session } from "./data/session";

const routes = [
	{
		path: "/",
		name: "Home",
		component: () => import("@/pages/Home.vue"),
	},
	{
		path: "/admin/sfu-dashboard",
		name: "SFUDashboard",
		component: () => import("@/pages/SFUDashboardPage.vue"),
		meta: { requiresAdmin: true },
	},
	{
		path: "/audio-test",
		name: "AudioTest",
		component: () => import("@/pages/AudioTest.vue"),
		meta: { requiresAdmin: true },
	},
	{
		path: "/:meetingId",
		name: "Meeting",
		component: () => import("@/pages/Meeting.vue"),
		meta: { allowGuest: true },
	},
	{
		name: "Login",
		path: "/login",
		component: () => import("@/pages/Login.vue"),
	},
];

const router = createRouter({
	history: createWebHistory(`${__FRONTEND_ROUTE__}/`),
	routes,
});

router.beforeEach(async (to, from, next) => {
	let isLoggedIn = session.isLoggedIn;
	let user = null;
	if (isLoggedIn || to.meta?.requiresAdmin) {
		try {
			if (!userResource.fetched) {
				await userResource.fetch();
			}
			user = userResource.data;
		} catch (error) {
			isLoggedIn = false;
		}
	}

	if (to.meta?.requiresAdmin) {
		if (!isLoggedIn) {
			return next({ name: "Login", query: { next: to.fullPath } });
		}
		const isAdmin = user?.roles?.some((r) =>
			["System Manager", "Administrator"].includes(r),
		);
		if (!isAdmin) {
			return next({ name: "Home" });
		}
	}

	if (to.name === "Login") {
		if (isLoggedIn) return next({ name: "Home" });
		return next();
	}

	if (to.meta?.allowGuest && to.name === "Meeting") {
		return next();
	}

	if (!isLoggedIn) {
		let query = {};
		if (to.name !== "Home") {
			query = { next: to.fullPath };
		}
		return next({ name: "Login", query });
	}

	next();
});

export default router;
