// WebGL shader management for background effects
const SHADERS = {
	vertex: `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `,

	blurFragment: `
	#ifdef GL_FRAGMENT_PRECISION_HIGH
	precision highp float;
	#else
	precision mediump float;
	#endif
    uniform sampler2D u_image;
    uniform sampler2D u_mask;
    uniform vec2 u_resolution;
    uniform vec2 u_direction;
    uniform float u_sigma;
    varying vec2 v_texCoord;

    float gaussian(float x, float sigma) {
      return exp(-(x * x) / (2.0 * sigma * sigma)) / (sigma * sqrt(2.0 * 3.14159));
    }

    void main() {
      vec2 texelSize = 1.0 / u_resolution;

      // Get current pixel's mask value (0 = background, 1 = person)
      float centerMask = texture2D(u_mask, v_texCoord).a;
      vec4 originalColor = texture2D(u_image, v_texCoord);

      // Smooth the mask to reduce blockiness from low-res segmentation
      float smoothMask = smoothstep(0.02, 0.98, centerMask);

      if (smoothMask > 0.99) {
        gl_FragColor = originalColor;
        return;
      }

      vec4 color = vec4(0.0);
      float weightSum = 0.0;

      // Fixed kernel size for WebGL compatibility (covers sigma up to ~8)
      const int MAX_KERNEL_SIZE = 15; // -15 to +15 = 31 total samples

      for (int i = -MAX_KERNEL_SIZE; i <= MAX_KERNEL_SIZE; i++) {
        // Only include samples within 3*sigma range for efficiency
        if (abs(float(i)) <= 3.0 * u_sigma) {
          float weight = gaussian(float(i), u_sigma);
          vec2 offset = vec2(float(i)) * u_direction * texelSize;
          vec2 sampleCoord = v_texCoord + offset;

          // Get mask value at sample position
          float sampleMask = texture2D(u_mask, sampleCoord).a;
          float sampleSmoothMask = smoothstep(0.02, 0.98, sampleMask);

          // Only sample background pixels for background blur
          // This prevents foreground from bleeding into background
          float maskWeight = 1.0 - max(sampleSmoothMask - smoothMask, 0.0);

          vec4 sampleColor = texture2D(u_image, sampleCoord);
          float finalWeight = weight * maskWeight;

          color += sampleColor * finalWeight;
          weightSum += finalWeight;
        }
      }

      // Normalize blurred color
      vec4 blurredColor = weightSum > 0.001 ? color / weightSum : originalColor;

      // Blend: sharp foreground + blurred background
      // Use smoothMask to smoothly transition between blurred and original
      gl_FragColor = mix(blurredColor, originalColor, smoothMask);
    }
  `,

	lightWrapFragment: `
	#ifdef GL_FRAGMENT_PRECISION_HIGH
	precision highp float;
	#else
	precision mediump float;
	#endif
    uniform sampler2D u_image;        // Original video frame
    uniform sampler2D u_mask;         // Segmentation mask
    uniform sampler2D u_background;   // Virtual background image
    uniform vec2 u_resolution;
    varying vec2 v_texCoord;

    void main() {
      vec2 texelSize = 1.0 / u_resolution;

      // Get current pixel's mask value (0 = background, 1 = person)
      float centerMask = texture2D(u_mask, v_texCoord).a;
      vec4 originalColor = texture2D(u_image, v_texCoord);
      vec4 backgroundColor = texture2D(u_background, v_texCoord);

      // Smooth the mask to reduce blockiness from low-res segmentation
      float smoothMask = smoothstep(0.05, 0.95, centerMask);

      // Edge region - apply light wrapping
      // Calculate edge normal by sampling mask gradient
      float maskLeft = texture2D(u_mask, v_texCoord + vec2(-texelSize.x, 0.0)).a;
      float maskRight = texture2D(u_mask, v_texCoord + vec2(texelSize.x, 0.0)).a;
      float maskUp = texture2D(u_mask, v_texCoord + vec2(0.0, -texelSize.y)).a;
      float maskDown = texture2D(u_mask, v_texCoord + vec2(0.0, texelSize.y)).a;

      // Gradient points from background to foreground
      vec2 gradient = vec2(maskRight - maskLeft, maskDown - maskUp);
      float gradientLength = length(gradient);

      // If gradient is too small, just composite normally with smooth mask
      if (gradientLength < 0.01) {
        gl_FragColor = mix(backgroundColor, originalColor, smoothMask);
        return;
      }

      // Normalize gradient to get edge normal (points toward background)
      vec2 edgeNormal = -gradient / gradientLength;

      // Sample background colors at multiple distances in the normal direction
      // These distances are in pixels (scaled by texelSize)
      vec3 sampledColor = vec3(0.0);
      float totalWeight = 0.0;

      // Sample at 5px, 10px, 15px distances with decreasing weights
      vec2 sampleOffsets[3];
      sampleOffsets[0] = edgeNormal * texelSize * 5.0;
      sampleOffsets[1] = edgeNormal * texelSize * 10.0;
      sampleOffsets[2] = edgeNormal * texelSize * 15.0;

      float sampleWeights[3];
      sampleWeights[0] = 0.5;
      sampleWeights[1] = 0.3;
      sampleWeights[2] = 0.2;

      for (int i = 0; i < 3; i++) {
        vec2 sampleCoord = v_texCoord + sampleOffsets[i];

        // Ensure we're sampling within bounds
        if (sampleCoord.x >= 0.0 && sampleCoord.x <= 1.0 &&
            sampleCoord.y >= 0.0 && sampleCoord.y <= 1.0) {

          // Sample background color
          vec4 bgSample = texture2D(u_background, sampleCoord);
          float weight = sampleWeights[i];

          sampledColor += bgSample.rgb * weight;
          totalWeight += weight;
        }
      }

      // Normalize sampled color
      if (totalWeight > 0.0) {
        sampledColor /= totalWeight;
      } else {
        // Fallback to current background pixel if sampling failed
        sampledColor = backgroundColor.rgb;
      }

      // Calculate light wrap strength based on:
      // 1. How close to edge (1 - smoothMask gives more wrap to background pixels)
      // 2. Edge falloff (strongest at edges, fades toward center)
      float edgeStrength = smoothstep(0.3, 0.7, 1.0 - smoothMask);

      // Apply light wrap: blend sampled background color into edge pixels
      vec3 wrappedColor = mix(originalColor.rgb, sampledColor, edgeStrength);

      // Final compositing: blend wrapped foreground with background
      vec3 finalColor = mix(backgroundColor.rgb, wrappedColor, smoothMask);

      gl_FragColor = vec4(finalColor, 1.0);
    }
  `,
};

class WebGLError extends Error {
	constructor(
		message: string,
		public code = "WEBGL_ERROR",
	) {
		super(message);
		this.name = "WebGLError";
	}
}

export class WebGLManager {
	private gl: WebGLRenderingContext;
	private vertexShader: WebGLShader | null = null;
	private fragmentShader: WebGLShader | null = null;
	private program: WebGLProgram | null = null;
	private positionBuffer: WebGLBuffer | null = null;
	private texCoordBuffer: WebGLBuffer | null = null;

	// Cached locations for blur program
	private texCoordLocation = -1;
	private resolutionLocation: WebGLUniformLocation | null = null;
	private directionLocation: WebGLUniformLocation | null = null;
	private sigmaLocation: WebGLUniformLocation | null = null;
	private imageLocation: WebGLUniformLocation | null = null;
	private maskLocation: WebGLUniformLocation | null = null;

	// cache lightwrap program (compiled once, reused every frame)
	private lightWrapProgram: WebGLProgram | null = null;
	private lightWrapTexCoordLocation = -1;
	private lightWrapResolutionLocation: WebGLUniformLocation | null = null;
	private lightWrapImageLocation: WebGLUniformLocation | null = null;
	private lightWrapMaskLocation: WebGLUniformLocation | null = null;
	private lightWrapBackgroundLocation: WebGLUniformLocation | null = null;

	constructor(canvas: HTMLCanvasElement) {
		const gl =
			canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
		if (!gl) {
			throw new WebGLError("WebGL not supported");
		}
		this.gl = gl as WebGLRenderingContext;
	}

	initializeShaders(): void {
		this.vertexShader = this.createShader(
			this.gl.VERTEX_SHADER,
			SHADERS.vertex,
		);
		this.fragmentShader = this.createShader(
			this.gl.FRAGMENT_SHADER,
			SHADERS.blurFragment,
		);

		if (!this.vertexShader || !this.fragmentShader) {
			throw new WebGLError("Failed to create shaders");
		}

		this.program = this.createProgram(this.vertexShader, this.fragmentShader);
		if (!this.program) {
			throw new WebGLError("Failed to create shader program");
		}

		// Cache locations
		this.texCoordLocation = this.gl.getAttribLocation(
			this.program,
			"a_texCoord",
		);
		this.resolutionLocation = this.gl.getUniformLocation(
			this.program,
			"u_resolution",
		);
		this.directionLocation = this.gl.getUniformLocation(
			this.program,
			"u_direction",
		);
		this.sigmaLocation = this.gl.getUniformLocation(this.program, "u_sigma");
		this.imageLocation = this.gl.getUniformLocation(this.program, "u_image");
		this.maskLocation = this.gl.getUniformLocation(this.program, "u_mask");

		// reusable buffers for perf
		this.positionBuffer = this.gl.createBuffer();
		this.texCoordBuffer = this.gl.createBuffer();

		// Setup position buffer with quad vertices
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
		this.gl.bufferData(
			this.gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
			this.gl.STATIC_DRAW,
		);

		// Setup texture coordinate buffer
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
		this.gl.bufferData(
			this.gl.ARRAY_BUFFER,
			new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]),
			this.gl.STATIC_DRAW,
		);

		this.initLightWrapProgram();
	}

	private initLightWrapProgram(): void {
		const vertexShader = this.createShader(
			this.gl.VERTEX_SHADER,
			SHADERS.vertex,
		);
		const fragmentShader = this.createShader(
			this.gl.FRAGMENT_SHADER,
			SHADERS.lightWrapFragment,
		);

		if (!vertexShader || !fragmentShader) {
			if (vertexShader) this.gl.deleteShader(vertexShader);
			if (fragmentShader) this.gl.deleteShader(fragmentShader);
			throw new WebGLError("Failed to create light wrap shaders");
		}

		try {
			this.lightWrapProgram = this.createProgram(vertexShader, fragmentShader);
			if (!this.lightWrapProgram) {
				throw new WebGLError("Failed to create light wrap shader program");
			}
		} finally {
			this.gl.deleteShader(vertexShader);
			this.gl.deleteShader(fragmentShader);
		}

		this.lightWrapTexCoordLocation = this.gl.getAttribLocation(
			this.lightWrapProgram,
			"a_texCoord",
		);
		this.lightWrapResolutionLocation = this.gl.getUniformLocation(
			this.lightWrapProgram,
			"u_resolution",
		);
		this.lightWrapImageLocation = this.gl.getUniformLocation(
			this.lightWrapProgram,
			"u_image",
		);
		this.lightWrapMaskLocation = this.gl.getUniformLocation(
			this.lightWrapProgram,
			"u_mask",
		);
		this.lightWrapBackgroundLocation = this.gl.getUniformLocation(
			this.lightWrapProgram,
			"u_background",
		);
	}

	private createShader(type: number, source: string): WebGLShader | null {
		const shader = this.gl.createShader(type);
		if (!shader) return null;

		this.gl.shaderSource(shader, source);
		this.gl.compileShader(shader);

		return shader;
	}

	private createProgram(
		vertexShader: WebGLShader,
		fragmentShader: WebGLShader,
	): WebGLProgram | null {
		const program = this.gl.createProgram();
		if (!program) return null;

		this.gl.attachShader(program, vertexShader);
		this.gl.attachShader(program, fragmentShader);

		// Explicitly bind position attribute to location 0 to avoid WebGL warnings
		this.gl.bindAttribLocation(program, 0, "a_position");

		this.gl.linkProgram(program);

		if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
			const error = this.gl.getProgramInfoLog(program);
			this.gl.deleteProgram(program);
			throw new WebGLError(`Program linking failed: ${error}`);
		}

		return program;
	}

	createTexture(imageData: ImageData): WebGLTexture | null {
		const texture = this.gl.createTexture();
		if (!texture) return null;

		this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_WRAP_S,
			this.gl.CLAMP_TO_EDGE,
		);
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_WRAP_T,
			this.gl.CLAMP_TO_EDGE,
		);
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_MIN_FILTER,
			this.gl.LINEAR,
		);
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_MAG_FILTER,
			this.gl.LINEAR,
		);

		this.gl.texImage2D(
			this.gl.TEXTURE_2D,
			0,
			this.gl.RGBA,
			imageData.width,
			imageData.height,
			0,
			this.gl.RGBA,
			this.gl.UNSIGNED_BYTE,
			imageData.data,
		);

		return texture;
	}

	createTextureFromSource(
		source: ImageData | HTMLCanvasElement | ImageBitmap,
	): WebGLTexture | null {
		const texture = this.gl.createTexture();
		if (!texture) return null;

		this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_WRAP_S,
			this.gl.CLAMP_TO_EDGE,
		);
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_WRAP_T,
			this.gl.CLAMP_TO_EDGE,
		);
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_MIN_FILTER,
			this.gl.LINEAR,
		);
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_MAG_FILTER,
			this.gl.LINEAR,
		);

		if (source instanceof ImageData) {
			this.gl.texImage2D(
				this.gl.TEXTURE_2D,
				0,
				this.gl.RGBA,
				source.width,
				source.height,
				0,
				this.gl.RGBA,
				this.gl.UNSIGNED_BYTE,
				source.data,
			);
		} else {
			this.gl.texImage2D(
				this.gl.TEXTURE_2D,
				0,
				this.gl.RGBA,
				this.gl.RGBA,
				this.gl.UNSIGNED_BYTE,
				source,
			);
		}

		return texture;
	}

	renderBlur(
		texture: WebGLTexture,
		maskTexture: WebGLTexture,
		width: number,
		height: number,
		sigma: number,
		direction: number[],
	): HTMLCanvasElement {
		const canvas = this.gl.canvas as HTMLCanvasElement;
		canvas.width = width;
		canvas.height = height;

		this.gl.viewport(0, 0, width, height);
		this.gl.clearColor(0, 0, 0, 0);
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);

		if (!this.program) {
			throw new WebGLError("Shader program not initialized");
		}

		this.gl.useProgram(this.program);

		// Set up attributes
		// Position attribute is bound to location 0
		const positionLocation = 0; // a_position is bound to location 0
		this.gl.enableVertexAttribArray(positionLocation);
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
		this.gl.vertexAttribPointer(
			positionLocation,
			2,
			this.gl.FLOAT,
			false,
			0,
			0,
		);

		this.gl.enableVertexAttribArray(this.texCoordLocation);
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
		this.gl.vertexAttribPointer(
			this.texCoordLocation,
			2,
			this.gl.FLOAT,
			false,
			0,
			0,
		);

		// Set uniforms
		this.gl.uniform2f(this.resolutionLocation, width, height);
		this.gl.uniform2f(this.directionLocation, direction[0], direction[1]);
		this.gl.uniform1f(this.sigmaLocation, sigma);

		// Bind image texture to unit 0
		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
		this.gl.uniform1i(this.imageLocation, 0);

		// Bind mask texture to unit 1
		this.gl.activeTexture(this.gl.TEXTURE1);
		this.gl.bindTexture(this.gl.TEXTURE_2D, maskTexture);
		this.gl.uniform1i(this.maskLocation, 1);

		this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

		return canvas;
	}

	applyBlur(
		source: HTMLCanvasElement,
		mask: ImageBitmap,
		width: number,
		height: number,
		sigma: number,
	): HTMLCanvasElement {
		// Create texture from source
		const texture = this.createTextureFromSource(source);
		if (!texture) {
			throw new WebGLError("Failed to create texture");
		}

		const maskTexture = this.createTextureFromSource(mask);
		if (!maskTexture) {
			throw new WebGLError("Failed to create mask texture");
		}

		let horizontalTexture: WebGLTexture | null = null;

		try {
			// First pass: horizontal blur
			const horizontalResult = this.renderBlur(
				texture,
				maskTexture,
				width,
				height,
				sigma,
				[1, 0],
			);

			// Second pass: vertical blur
			horizontalTexture = this.createTextureFromSource(horizontalResult);
			if (!horizontalTexture) {
				throw new WebGLError("Failed to create horizontal texture");
			}

			const finalResult = this.renderBlur(
				horizontalTexture,
				maskTexture,
				width,
				height,
				sigma,
				[0, 1],
			);

			return finalResult;
		} finally {
			// Clean up textures
			this.gl.deleteTexture(texture);
			this.gl.deleteTexture(maskTexture);
			if (horizontalTexture) {
				this.gl.deleteTexture(horizontalTexture);
			}
		}
	}

	// used to apply the light wrap effect on the source image using the mask and background image
	applyLightWrap(
		source: HTMLCanvasElement,
		mask: ImageBitmap,
		backgroundImageData: ImageData,
		width: number,
		height: number,
	): HTMLCanvasElement {
		if (!this.lightWrapProgram) {
			throw new WebGLError("Light wrap program not initialized");
		}

		const imageTexture = this.createTextureFromSource(source);
		if (!imageTexture) {
			throw new WebGLError("Failed to create image texture");
		}

		const maskTexture = this.createTextureFromSource(mask);
		if (!maskTexture) {
			throw new WebGLError("Failed to create mask texture");
		}

		const backgroundTexture = this.createTextureFromSource(backgroundImageData);
		if (!backgroundTexture) {
			throw new WebGLError("Failed to create background texture");
		}

		try {
			const canvas = this.gl.canvas as HTMLCanvasElement;
			canvas.width = width;
			canvas.height = height;

			this.gl.viewport(0, 0, width, height);
			this.gl.clearColor(0, 0, 0, 0);
			this.gl.clear(this.gl.COLOR_BUFFER_BIT);

			this.gl.useProgram(this.lightWrapProgram);

			const positionLocation = 0; // a_position is bound to location 0
			this.gl.enableVertexAttribArray(positionLocation);
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
			this.gl.vertexAttribPointer(
				positionLocation,
				2,
				this.gl.FLOAT,
				false,
				0,
				0,
			);

			this.gl.enableVertexAttribArray(this.lightWrapTexCoordLocation);
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
			this.gl.vertexAttribPointer(
				this.lightWrapTexCoordLocation,
				2,
				this.gl.FLOAT,
				false,
				0,
				0,
			);

			this.gl.uniform2f(this.lightWrapResolutionLocation, width, height);

			// Image texture to unit 0
			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_2D, imageTexture);
			this.gl.uniform1i(this.lightWrapImageLocation, 0);

			// Mask texture to unit 1
			this.gl.activeTexture(this.gl.TEXTURE1);
			this.gl.bindTexture(this.gl.TEXTURE_2D, maskTexture);
			this.gl.uniform1i(this.lightWrapMaskLocation, 1);

			// Background texture to unit 2
			this.gl.activeTexture(this.gl.TEXTURE2);
			this.gl.bindTexture(this.gl.TEXTURE_2D, backgroundTexture);
			this.gl.uniform1i(this.lightWrapBackgroundLocation, 2);

			this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

			return canvas;
		} finally {
			this.gl.deleteTexture(imageTexture);
			this.gl.deleteTexture(maskTexture);
			this.gl.deleteTexture(backgroundTexture);
		}
	}

	dispose(): void {
		if (this.program) {
			this.gl.deleteProgram(this.program);
			this.program = null;
		}
		if (this.vertexShader) {
			this.gl.deleteShader(this.vertexShader);
			this.vertexShader = null;
		}
		if (this.fragmentShader) {
			this.gl.deleteShader(this.fragmentShader);
			this.fragmentShader = null;
		}
		if (this.positionBuffer) {
			this.gl.deleteBuffer(this.positionBuffer);
			this.positionBuffer = null;
		}
		if (this.texCoordBuffer) {
			this.gl.deleteBuffer(this.texCoordBuffer);
			this.texCoordBuffer = null;
		}
		if (this.lightWrapProgram) {
			this.gl.deleteProgram(this.lightWrapProgram);
			this.lightWrapProgram = null;
		}
	}
}
