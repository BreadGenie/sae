import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";
import { toast } from "frappe-ui";
import { type Ref, onUnmounted, ref } from "vue";
import { availableBackgroundImages } from "../data/backgroundEffects";
import {
	CompositingError,
	applyBlurEffect,
	applyVirtualBackground,
	getBackgroundImageData,
} from "../utils/compositing";
import { WebGLManager } from "../utils/webglShaders";

// Types and interfaces
interface BackgroundEffectOptions {
	backgroundBlurEnabled?: boolean;
	backgroundImageEnabled?: boolean;
	selectedBackgroundImage?: string | null;
	blurIntensity?: number;
}

interface BackgroundImage {
	name: string;
	label: string;
	url: string;
	isCustom?: boolean;
	metadata?: {
		size: number;
		width: number;
		height: number;
		format: string;
		createdAt: string;
	};
}

interface BackgroundEffectsResult {
	stream: MediaStream;
	cleanup: () => void;
	updateOptions: (options: BackgroundEffectOptions) => Promise<void>;
}

interface SelfieSegmentationResults {
	segmentationMask: ImageBitmap;
	image?: unknown;
}

interface UseBackgroundEffectsReturn {
	isProcessing: Ref<boolean>;
	processedStream: Ref<MediaStream | null>;
	error: Ref<string | null>;
	applyBackgroundEffects: (
		inputStream: MediaStream,
		options?: BackgroundEffectOptions,
	) => Promise<BackgroundEffectsResult>;
	stopProcessing: () => void;
	loadModel: () => Promise<SelfieSegmentation>;
}

interface HaltProcessingOptions {
	disposeWebGL?: boolean;
}

// MediaPipe Selfie Segmentation instance
let selfieSegmentation: SelfieSegmentation | null = null;
const backgroundImages = new Map<string, HTMLImageElement>();
let latestResults: SelfieSegmentationResults | null = null;
let modelInitializationPromise: Promise<SelfieSegmentation> | null = null;
let activeInstanceCount = 0;

export function useBackgroundEffects(): UseBackgroundEffectsReturn {
	const isProcessing = ref<boolean>(false);
	const processedStream = ref<MediaStream | null>(null);
	const error = ref<string | null>(null);
	let instanceSessionCounter = 0;
	let activeSessionId = 0;
	let isDisposed = false;

	activeInstanceCount++;

	let animationId: number | null = null;

	let webglManager: WebGLManager | null = null;

	const defaultOptions: Required<BackgroundEffectOptions> = {
		backgroundBlurEnabled: false,
		backgroundImageEnabled: false,
		selectedBackgroundImage: null,
		blurIntensity: 4,
	};

	async function loadModel(): Promise<SelfieSegmentation> {
		try {
			if (selfieSegmentation) {
				return selfieSegmentation;
			}

			if (!modelInitializationPromise) {
				modelInitializationPromise = (async () => {
					try {
						const instance = new SelfieSegmentation({
							locateFile: (file) => {
								return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
							},
						});

						instance.setOptions({
							modelSelection: 1, // Use landscape model for better performance
						});

						instance.onResults((results) => {
							latestResults = results as SelfieSegmentationResults;
						});

						await instance.initialize();

						selfieSegmentation = instance;
						latestResults = null;
						return instance;
					} finally {
						modelInitializationPromise = null;
					}
				})();
			}

			const model = await modelInitializationPromise;
			return model;
		} catch (err) {
			console.error("Failed to load MediaPipe Selfie Segmentation model:", err);
			error.value = "Failed to load background effects model";
			toast.error(
				"Failed to load the background effects model. Please try again.",
			);
			throw err;
		}
	}

	async function loadBackgroundImage(
		imageUrl: string,
	): Promise<HTMLImageElement> {
		if (backgroundImages.has(imageUrl)) {
			const cached = backgroundImages.get(imageUrl);
			if (cached) return cached;
		}

		try {
			const img = new Image();
			img.crossOrigin = "anonymous";

			return new Promise<HTMLImageElement>((resolve, reject) => {
				img.onload = () => {
					backgroundImages.set(imageUrl, img);
					resolve(img);
				};
				img.onerror = (err) => {
					console.error("Failed to load background image:", err);
					reject(err);
				};
				img.src = imageUrl;
			});
		} catch (err) {
			console.error("Failed to load background image:", err);
			throw err;
		}
	}

	async function applyBackgroundEffects(
		inputStream: MediaStream,
		options: BackgroundEffectOptions = {},
	): Promise<BackgroundEffectsResult> {
		if (!inputStream)
			return {
				stream: inputStream,
				cleanup: () => {},
				updateOptions: async () => {},
			};

		await haltProcessing({ disposeWebGL: true });
		const preStartResetSucceeded = await resetSegmentationState();
		if (!preStartResetSucceeded) {
			await releaseSegmentation();
		}

		animationId = null;

		const settings = { ...defaultOptions, ...options };
		if (!settings.selectedBackgroundImage) {
			settings.selectedBackgroundImage = null;
		}

		const shouldContinueProcessing = (
			sessionId: number,
			model: SelfieSegmentation | null,
		): boolean => {
			return (
				isProcessing.value &&
				sessionId === activeSessionId &&
				model === selfieSegmentation
			);
		};

		const convertMaskToFloat32Array = async (
			mask: ImageBitmap,
			canvasWidth: number,
			canvasHeight: number,
		): Promise<Float32Array> => {
			// alpha channel determines if a pixel belongs to person or background
			// 255 = fully person, 0 = fully background
			const extractAlphaChannel = (imageData: ImageData): Float32Array => {
				const length = imageData.data.length / 4;
				const result = new Float32Array(length);
				for (let i = 0; i < length; i++) {
					result[i] = imageData.data[i * 4 + 3] / 255;
				}
				return result;
			};

			const tempCanvas = document.createElement("canvas");
			const tempCtx = tempCanvas.getContext("2d");
			if (!tempCtx) {
				throw new Error("Failed to get canvas context for mask conversion");
			}

			tempCanvas.width = canvasWidth;
			tempCanvas.height = canvasHeight;
			tempCtx.drawImage(mask, 0, 0, canvasWidth, canvasHeight);
			const maskImageData = tempCtx.getImageData(
				0,
				0,
				canvasWidth,
				canvasHeight,
			);
			return extractAlphaChannel(maskImageData);
		};
		try {
			isProcessing.value = true;
			error.value = null;

			if (!webglManager) {
				try {
					const webglCanvas = document.createElement("canvas");
					webglManager = new WebGLManager(webglCanvas);
					webglManager.initializeShaders();
				} catch (error) {
					console.warn("WebGL initialization failed:", error);
					toast.warning(
						"WebGL is not available. Background blur effects will be disabled.",
					);
					webglManager = null;
				}
			}

			let model = await loadModel();
			let sessionId = ++instanceSessionCounter;
			activeSessionId = sessionId;
			const videoTrack = inputStream.getVideoTracks()[0];

			if (!videoTrack) {
				isProcessing.value = false;
				return {
					stream: inputStream,
					cleanup: () => {},
					updateOptions: async () => {},
				};
			}

			// Create canvas for processing
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) throw new Error("Failed to get canvas context");

			// Create video element to capture frames
			const video = document.createElement("video");
			video.srcObject = new MediaStream([videoTrack]);
			video.muted = true;
			video.playsInline = true;

			try {
				await video.play();
			} catch (err) {
				console.warn("Autoplay prevented, attempting muted playback", err);
			}

			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;

			let backgroundImageData: ImageData | null = null;
			let backgroundImageKey: string | null = null;
			let backgroundImageUpdatePromise: Promise<void> | null = null;

			const loadBackgroundImageData = async (
				selectedKey: string,
			): Promise<void> => {
				let bgImage: BackgroundImage | null = null;
				const predefinedImages = availableBackgroundImages;
				bgImage =
					predefinedImages.find((img) => img.name === selectedKey) || null;

				if (!bgImage) {
					const { customBackgroundImages } = await import(
						"../data/backgroundEffects"
					);
					const customImage = customBackgroundImages.value.find(
						(img: BackgroundImage) => img.name === selectedKey,
					);
					if (customImage) {
						bgImage = customImage;
					}
				}

				if (!bgImage) {
					throw new Error(`Background image not found for key: ${selectedKey}`);
				}

				const img = await loadBackgroundImage(bgImage.url);
				backgroundImageData = getBackgroundImageData(
					img,
					canvas.width,
					canvas.height,
				);
				backgroundImageKey = selectedKey;
			};

			const ensureBackgroundImage = () => {
				if (!settings.backgroundImageEnabled) {
					backgroundImageData = null;
					backgroundImageKey = null;
					return Promise.resolve();
				}

				const selectedKey = settings.selectedBackgroundImage;
				if (!selectedKey) {
					backgroundImageData = null;
					backgroundImageKey = null;
					return Promise.resolve();
				}

				if (
					backgroundImageKey === selectedKey &&
					backgroundImageData &&
					backgroundImageData.width === canvas.width &&
					backgroundImageData.height === canvas.height
				) {
					return Promise.resolve();
				}

				backgroundImageUpdatePromise = (
					backgroundImageUpdatePromise
						? backgroundImageUpdatePromise.catch(() => undefined)
						: Promise.resolve()
				).then(() => loadBackgroundImageData(selectedKey));
				return backgroundImageUpdatePromise;
			};

			await ensureBackgroundImage();

			// Create output canvas for the processed stream
			const outputCanvas = document.createElement("canvas");
			const outputCtx = outputCanvas.getContext("2d", {
				willReadFrequently: true,
			});
			if (!outputCtx) throw new Error("Failed to get output canvas context");

			outputCanvas.width = canvas.width;
			outputCanvas.height = canvas.height;

			let lastFrameTime = 0;
			const targetFrameRate = 1000 / 30; // 30 FPS

			const processFrame = async (currentTime = 0) => {
				try {
					if (!shouldContinueProcessing(sessionId, model)) {
						return;
					}

					// skip frames if we're processing too fast
					if (currentTime - lastFrameTime < targetFrameRate) {
						animationId = requestAnimationFrame(processFrame);
						return;
					}
					lastFrameTime = currentTime;

					if (
						video.videoWidth === 0 ||
						video.videoHeight === 0 ||
						video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
					) {
						animationId = requestAnimationFrame(processFrame);
						return;
					}
					// Draw current video frame to canvas
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

					// Send the rendered canvas frame to MediaPipe for segmentation. Firefox can surface
					// zero-dimension frames while the HTMLVideoElement resolves its layout; providing the
					// canvas ensures consistent frame sizing across browsers.
					await model.send({ image: canvas });

					if (!shouldContinueProcessing(sessionId, model)) {
						return;
					}

					// Use the latest results from the onResults callback
					const results = latestResults;
					if (!results || !results.segmentationMask) {
						outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
						outputCtx.drawImage(canvas, 0, 0);
						animationId = requestAnimationFrame(processFrame);
						return;
					}

					// we convert segmentation mask to Float32Array
					// since we need the alpha channel for compositing
					const maskData = await convertMaskToFloat32Array(
						results.segmentationMask,
						canvas.width,
						canvas.height,
					);

					// Clear output canvas
					outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
					if (maskData.length !== canvas.width * canvas.height) {
						console.warn(
							"Segmentation mask size mismatch. Falling back to original frame.",
							maskData.length,
							canvas.width * canvas.height,
						);
						outputCtx.drawImage(canvas, 0, 0);
						animationId = requestAnimationFrame(processFrame);
						return;
					}
					if (settings.backgroundBlurEnabled) {
						try {
							// Apply blur effect using compositing utilities
							const currentImageData = ctx.getImageData(
								0,
								0,
								canvas.width,
								canvas.height,
							);

							const compositedImageData = applyBlurEffect(
								currentImageData,
								maskData,
								canvas.width,
								canvas.height,
								{
									blurIntensity: settings.blurIntensity,
									webglManager: webglManager || undefined,
								},
							);

							outputCtx.putImageData(compositedImageData, 0, 0);
						} catch (error) {
							if (
								error instanceof CompositingError &&
								error.code === "WEBGL_UNAVAILABLE"
							) {
								toast.error(
									"Background blur requires WebGL but it's not available on this device. Blur effects have been disabled.",
								);
								// Disable blur for future frames
								settings.backgroundBlurEnabled = false;
							} else if (
								error instanceof CompositingError &&
								error.code === "WEBGL_BLUR_FAILED"
							) {
								toast.error(
									"Background blur failed due to WebGL error. Blur effects have been disabled.",
								);
								// Disable blur for future frames
								settings.backgroundBlurEnabled = false;
							} else {
								console.error("Blur effect failed:", error);
							}
							// Fall back to no effect for this frame
							outputCtx.drawImage(canvas, 0, 0);
						}
					} else if (backgroundImageData) {
						// Apply virtual background using compositing utilities
						const currentImageData = ctx.getImageData(
							0,
							0,
							canvas.width,
							canvas.height,
						);

						const compositedImageData = applyVirtualBackground(
							currentImageData,
							maskData,
							backgroundImageData,
						);

						outputCtx.putImageData(compositedImageData, 0, 0);
					} else {
						// No effect, just draw original
						outputCtx.drawImage(canvas, 0, 0);
					}
					if (isProcessing.value) {
						animationId = requestAnimationFrame(processFrame);
					}
				} catch (err) {
					console.error("Frame processing error:", err);

					if (!isProcessing.value) {
						return;
					}

					const errorName = err instanceof Error ? err.name : "";
					const errorMessage = err instanceof Error ? err.message : String(err);
					const isFatalError =
						errorName === "RuntimeError" ||
						errorName === "BindingError" ||
						errorMessage.includes("RuntimeError") ||
						errorMessage.includes("BindingError") ||
						errorMessage.includes("index out of bounds");

					if (isFatalError) {
						try {
							const resetSucceeded = await resetSegmentationState();
							if (!resetSucceeded) {
								await releaseSegmentation();
							}
							model = await loadModel();
							sessionId = ++instanceSessionCounter;
							activeSessionId = sessionId;
						} catch (recoveryError) {
							console.error(
								"Failed to recover from frame error:",
								recoveryError,
							);
							await haltProcessing();
							return;
						}

						if (isProcessing.value) {
							animationId = requestAnimationFrame(processFrame);
						}
						return;
					}

					outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
					outputCtx.drawImage(canvas, 0, 0);

					animationId = requestAnimationFrame(processFrame);
				}
			};

			// Start processing
			processFrame();

			// Create output stream from canvas
			const outputStream = outputCanvas.captureStream(30); // 30 FPS

			// Replace video track
			const processedVideoTrack = outputStream.getVideoTracks()[0];
			const newStream = new MediaStream([
				processedVideoTrack,
				...inputStream.getAudioTracks(),
			]);

			processedStream.value = newStream;

			// Cleanup function
			const cleanup = (): void => {
				isProcessing.value = false;
				video.srcObject = null;
				if (processedVideoTrack) {
					processedVideoTrack.stop();
				}
				void haltProcessing({ disposeWebGL: true });
			};

			const updateOptions = async (
				updatedOptions: BackgroundEffectOptions = {},
			): Promise<void> => {
				if (!isProcessing.value) {
					return;
				}

				const normalizedOptions: BackgroundEffectOptions = {
					...updatedOptions,
				};
				if (
					"selectedBackgroundImage" in normalizedOptions &&
					normalizedOptions.selectedBackgroundImage === ""
				) {
					normalizedOptions.selectedBackgroundImage = null;
				}

				if (Object.keys(normalizedOptions).length === 0) {
					return;
				}

				Object.assign(settings, normalizedOptions);

				if (
					"backgroundImageEnabled" in normalizedOptions ||
					"selectedBackgroundImage" in normalizedOptions
				) {
					try {
						await ensureBackgroundImage();
					} catch (error) {
						console.error("Failed to update background image:", error);
						toast.error(
							"Failed to update the selected background image. Reverting to original.",
						);
						settings.backgroundImageEnabled = false;
						settings.selectedBackgroundImage = null;
						backgroundImageData = null;
					}
				}
			};

			return { stream: newStream, cleanup, updateOptions };
		} catch (err) {
			console.error("Background effects processing error:", err);
			error.value = err instanceof Error ? err.message : "Unknown error";
			toast.error("Failed to apply background effects. Using original video.");
			await haltProcessing({ disposeWebGL: true });
			await resetSegmentationState();
			return {
				stream: inputStream,
				cleanup: () => {},
				updateOptions: async () => {},
			};
		}
	}

	// Gracefully stop the current processing loop and wait for in-flight operations
	async function haltProcessing(
		options: HaltProcessingOptions = {},
	): Promise<void> {
		const { disposeWebGL = false } = options;
		if (!isProcessing.value && !processedStream.value && !animationId) {
			if (disposeWebGL && webglManager) {
				webglManager.dispose();
				webglManager = null;
			}
			return;
		}

		isProcessing.value = false;
		if (animationId) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}

		if (processedStream.value) {
			for (const track of processedStream.value.getTracks()) {
				track.stop();
			}
			processedStream.value = null;
		}

		if (disposeWebGL && webglManager) {
			webglManager.dispose();
			webglManager = null;
		}

		// Clear cached results so the next run starts fresh
		latestResults = null;
	}

	function stopProcessing(): void {
		void haltProcessing();
	}

	async function resetSegmentationState(): Promise<boolean> {
		if (!selfieSegmentation) {
			return true;
		}

		latestResults = null;
		const resetFn = (
			selfieSegmentation as unknown as {
				reset?: () => void;
			}
		).reset;
		if (typeof resetFn === "function") {
			try {
				resetFn.call(selfieSegmentation);
				return true;
			} catch (err) {
				console.warn("Failed to reset MediaPipe instance:", err);
			}
		}

		return false;
	}

	async function releaseSegmentation(): Promise<void> {
		if (!selfieSegmentation) {
			return;
		}
		try {
			await selfieSegmentation.close();
		} catch (closeError) {
			console.warn("Failed to close MediaPipe instance:", closeError);
		} finally {
			selfieSegmentation = null;
			latestResults = null;
		}
	}

	onUnmounted(() => {
		void (async () => {
			await haltProcessing({ disposeWebGL: true });
			if (!isDisposed) {
				isDisposed = true;
				activeInstanceCount = Math.max(0, activeInstanceCount - 1);
				if (activeInstanceCount === 0) {
					await releaseSegmentation();
				}
			}
		})();
	});

	return {
		isProcessing,
		processedStream,
		error,
		applyBackgroundEffects,
		stopProcessing,
		loadModel,
	};
}
