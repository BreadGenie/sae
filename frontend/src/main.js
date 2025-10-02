import { createApp } from "vue";

import App from "./App.vue";
import router from "./router";
import { initSocket } from "./socket";

import {
	Alert,
	Badge,
	Button,
	Dialog,
	ErrorMessage,
	FormControl,
	Input,
	TextInput,
	frappeRequest,
	pageMetaPlugin,
	resourcesPlugin,
	setConfig,
} from "frappe-ui";

import "./index.css";
import { loadMediaPreferences } from "./data/mediaPreferences.js";
import { getPlatform } from "./utils/device";
import { deviceManager } from "./utils/media/DeviceManager.js";

const globalComponents = {
	Button,
	TextInput,
	Input,
	FormControl,
	ErrorMessage,
	Dialog,
	Alert,
	Badge,
};

const app = createApp(App);

setConfig("resourceFetcher", frappeRequest);

app.use(router);
app.use(resourcesPlugin);
app.use(pageMetaPlugin);

const socket = initSocket();
app.config.globalProperties.$socket = socket;
app.config.globalProperties.$platform = getPlatform();

for (const key in globalComponents) {
	app.component(key, globalComponents[key]);
}

loadMediaPreferences();

app.mount("#app");
