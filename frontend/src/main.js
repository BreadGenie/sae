import {
	Alert,
	Badge,
	Button,
	Dialog,
	ErrorMessage,
	FormControl,
	frappeRequest,
	Input,
	pageMetaPlugin,
	resourcesPlugin,
	setConfig,
	TextInput,
} from "frappe-ui";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { initSocket } from "./socket";

import "./index.css";
import { loadMediaPreferences } from "./data/mediaPreferences";
import { getPlatform } from "./utils/device";

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
