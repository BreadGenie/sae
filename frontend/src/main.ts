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
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { initSocket } from "./socket";

import "./index.css";
import { loadMediaPreferences } from "./data/mediaPreferences";
import { getPlatform } from "./utils/device";
import { installConsoleBuffer } from "./utils/diagnostics/consoleBuffer";

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
const pinia = createPinia();

setConfig("resourceFetcher", frappeRequest);

app.use(pinia);
app.use(router);
app.use(resourcesPlugin);
app.use(pageMetaPlugin);

const socket = initSocket();
app.config.globalProperties.$socket = socket;
app.config.globalProperties.$platform = getPlatform();

for (const [key, component] of Object.entries(globalComponents)) {
	app.component(key, component);
}

loadMediaPreferences();
installConsoleBuffer();

app.mount("#app");
