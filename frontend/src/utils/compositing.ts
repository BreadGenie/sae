// Compositing utilities for background effects
import type { WebGLManager } from "./webglShaders";

export class CompositingError extends Error {
	constructor(
		message: string,
		public code = "COMPOSITING_ERROR",
	) {
		super(message);
		this.name = "CompositingError";
	}
}

interface CompositingOptions {
	blurIntensity?: number;
	segmentationThreshold?: number;
	webglManager?: WebGLManager;
}

/**
 * Apply background blur effect using person segmentation mask
 */
export function applyBlurEffect(
	imageData: ImageData,
	maskData: Float32Array,
	width: number,
	height: number,
	options: CompositingOptions = {},
): ImageData {
	const { blurIntensity = 4, webglManager } = options;

	if (!webglManager) {
		throw new CompositingError(
			"WebGL is required for blur effects but is not available",
			"WEBGL_UNAVAILABLE",
		);
	}

	try {
		return webglManager.applyBlur(
			imageData,
			maskData,
			width,
			height,
			blurIntensity / 2,
		);
	} catch (_error) {
		throw new CompositingError("WebGL blur failed", "WEBGL_BLUR_FAILED");
	}
}

/**
 * Apply virtual background effect using person segmentation mask with light wrapping
 */
export function applyVirtualBackground(
	imageData: ImageData,
	maskData: Float32Array,
	backgroundImageData: ImageData,
	options: CompositingOptions = {},
): ImageData {
	const { webglManager } = options;

	// Try if WebGL is available
	if (webglManager) {
		try {
			return webglManager.applyLightWrap(
				imageData,
				maskData,
				backgroundImageData,
				imageData.width,
				imageData.height,
			);
		} catch (error) {
			console.warn(
				"Light wrap failed, falling back to standard compositing:",
				error,
			);
		}
	}

	// fallback
	const outputData = new ImageData(imageData.width, imageData.height);
	const originalData = imageData.data;
	const backgroundData = backgroundImageData.data;

	for (let i = 0; i < maskData.length; i++) {
		const personConfidence = maskData[i];
		const pixelIndex = i * 4;

		const alpha = personConfidence;

		// Blend between person (original) and background image based on confidence
		outputData.data[pixelIndex] =
			originalData[pixelIndex] * alpha +
			backgroundData[pixelIndex] * (1 - alpha);
		outputData.data[pixelIndex + 1] =
			originalData[pixelIndex + 1] * alpha +
			backgroundData[pixelIndex + 1] * (1 - alpha);
		outputData.data[pixelIndex + 2] =
			originalData[pixelIndex + 2] * alpha +
			backgroundData[pixelIndex + 2] * (1 - alpha);
		outputData.data[pixelIndex + 3] = originalData[pixelIndex + 3]; // Keep original alpha
	}

	return outputData;
}

/**
 * Get background image data with proper orientation
 */
export function getBackgroundImageData(
	backgroundImg: HTMLImageElement,
	width: number,
	height: number,
): ImageData {
	const tempCanvas = document.createElement("canvas");
	const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });

	if (!tempCtx) {
		throw new CompositingError(
			"Failed to get canvas context for background image",
		);
	}

	tempCanvas.width = width;
	tempCanvas.height = height;

	// Flip the background image horizontally to compensate for flipped video frames
	tempCtx.scale(-1, 1);
	tempCtx.drawImage(backgroundImg, -width, 0, width, height);

	return tempCtx.getImageData(0, 0, width, height);
}
