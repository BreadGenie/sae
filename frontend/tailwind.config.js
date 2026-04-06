import frappeUIPreset from "frappe-ui/tailwind";

export default {
	presets: [frappeUIPreset],
	content: [
		"./index.html",
		"./src/**/*.{vue,js,ts,jsx,tsx}",
		"./node_modules/frappe-ui/src/components/**/*.{vue,js,ts,jsx,tsx}",
	],
	safelist: [
		"grid-cols-1",
		"grid-cols-2",
		"grid-cols-3",
		"grid-cols-4",
		"sm:grid-cols-1",
		"sm:grid-cols-2",
		"md:grid-cols-2",
		"md:grid-cols-3",
		"lg:grid-cols-3",
		"lg:grid-cols-4",
	],
	theme: {
		extend: {},
	},
	plugins: [],
};
