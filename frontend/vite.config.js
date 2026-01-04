import fs from "node:fs";
import path from "node:path";
import { basename } from "node:path";
import vue from "@vitejs/plugin-vue";
import frappeui from "frappe-ui/vite";
import { defineConfig } from "vite";

/**
 * MediaPipe workaround for Vite/Rollup bundling issues
 * MediaPipe packages are obfuscated and Rollup can't properly analyze them
 * This adds an explicit CommonJS export so Rollup can understand it
 * See: https://github.com/vitejs/vite/issues/4680
 * See: https://github.com/tensorflow/tfjs/issues/7165
 */
function mediapipe_workaround() {
	return {
		name: "mediapipe_workaround",
		load(id) {
			if (basename(id) === "selfie_segmentation.js") {
				let code = fs.readFileSync(id, "utf-8");
				code += "exports.SelfieSegmentation = SelfieSegmentation;";
				return { code };
			}
			return null;
		},
	};
}

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		frappeui({
			frappeProxy: true,
			jinjaBootData: true,
			lucideIcons: true,
			buildConfig: {
				indexHtmlPath: "../meet/www/meet.html",
				emptyOutDir: true,
				sourcemap: true,
			},
		}),
		vue(),
	],
	build: {
		chunkSizeWarningLimit: 1500,
		outDir: "../meet/public/frontend",
		emptyOutDir: true,
		target: "es2015",
		sourcemap: true,
		rollupOptions: {
			plugins: [mediapipe_workaround()],
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"tailwind.config.js": path.resolve(__dirname, "tailwind.config.js"),
		},
	},
	optimizeDeps: {
		include: ["feather-icons", "interactjs", "highlight.js/lib/core"],
		exclude: ["frappe-ui"],
	},
	server: {
		allowedHosts: true,
	},
});
