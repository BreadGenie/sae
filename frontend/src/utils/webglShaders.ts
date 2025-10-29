// WebGL shader management for background effects
export const SHADERS = {
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
    precision mediump float;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform vec2 u_direction;
    uniform float u_sigma;
    varying vec2 v_texCoord;

    float gaussian(float x, float sigma) {
      return exp(-(x * x) / (2.0 * sigma * sigma)) / (sigma * sqrt(2.0 * 3.14159));
    }

    void main() {
      vec2 texelSize = 1.0 / u_resolution;
      vec4 color = vec4(0.0);
      float weightSum = 0.0;

      // Fixed kernel size for WebGL compatibility (covers sigma up to ~8)
      const int MAX_KERNEL_SIZE = 15; // -15 to +15 = 31 total samples

      for (int i = -MAX_KERNEL_SIZE; i <= MAX_KERNEL_SIZE; i++) {
        // Only include samples within 3*sigma range for efficiency
        if (abs(float(i)) <= 3.0 * u_sigma) {
          float weight = gaussian(float(i), u_sigma);
          vec2 offset = vec2(float(i)) * u_direction * texelSize;
          color += texture2D(u_image, v_texCoord + offset) * weight;
          weightSum += weight;
        }
      }

      gl_FragColor = color / weightSum;
    }
  `,
};

export class WebGLError extends Error {
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
	private outputCanvas: HTMLCanvasElement | null = null;

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

		// reusable buffers and canvas for perf
		this.positionBuffer = this.gl.createBuffer();
		this.texCoordBuffer = this.gl.createBuffer();
		this.outputCanvas = document.createElement("canvas");
		this.outputCanvas.getContext("2d", { willReadFrequently: true }); // for perf as well

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
	}

	private createShader(type: number, source: string): WebGLShader | null {
		const shader = this.gl.createShader(type);
		if (!shader) return null;

		this.gl.shaderSource(shader, source);
		this.gl.compileShader(shader);

		if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
			const error = this.gl.getShaderInfoLog(shader);
			this.gl.deleteShader(shader);
			throw new WebGLError(`Shader compilation failed: ${error}`);
		}

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

	createTextureFromCanvas(canvas: HTMLCanvasElement): WebGLTexture | null {
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
			this.gl.RGBA,
			this.gl.UNSIGNED_BYTE,
			canvas,
		);

		return texture;
	}

	renderBlur(
		texture: WebGLTexture,
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

		const texCoordLocation = this.gl.getAttribLocation(
			this.program,
			"a_texCoord",
		);
		this.gl.enableVertexAttribArray(texCoordLocation);
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
		this.gl.vertexAttribPointer(
			texCoordLocation,
			2,
			this.gl.FLOAT,
			false,
			0,
			0,
		);

		// Set uniforms
		this.gl.uniform2f(
			this.gl.getUniformLocation(this.program, "u_resolution"),
			width,
			height,
		);
		this.gl.uniform2f(
			this.gl.getUniformLocation(this.program, "u_direction"),
			direction[0],
			direction[1],
		);
		this.gl.uniform1f(
			this.gl.getUniformLocation(this.program, "u_sigma"),
			sigma,
		);

		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
		this.gl.uniform1i(this.gl.getUniformLocation(this.program, "u_image"), 0);

		this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

		return canvas;
	}

	applyBlur(
		imageData: ImageData,
		width: number,
		height: number,
		sigma: number,
	): ImageData {
		// Create texture from image data
		const texture = this.createTexture(imageData);
		if (!texture) {
			throw new WebGLError("Failed to create texture");
		}

		let verticalTexture: WebGLTexture | null = null;

		try {
			// First pass: horizontal blur
			const horizontalResult = this.renderBlur(
				texture,
				width,
				height,
				sigma,
				[1, 0],
			);

			// Second pass: vertical blur
			verticalTexture = this.createTextureFromCanvas(horizontalResult);
			if (!verticalTexture) {
				throw new WebGLError("Failed to create vertical texture");
			}

			const finalResult = this.renderBlur(
				verticalTexture,
				width,
				height,
				sigma,
				[0, 1],
			);

			if (!this.outputCanvas) {
				throw new WebGLError("Output canvas not initialized");
			}

			this.outputCanvas.width = width;
			this.outputCanvas.height = height;
			const outputCtx = this.outputCanvas.getContext("2d", {
				willReadFrequently: true,
			});

			if (!outputCtx) {
				throw new WebGLError("Failed to create output canvas context");
			}

			// Below snippet is a hack to avoid the y-axis flip while reading pixels
			// from WebGL canvas. We use drawImage to copy the result to a 2D canvas,
			// which automatically handles the coordinate system conversion.
			outputCtx.drawImage(finalResult, 0, 0);
			return outputCtx.getImageData(0, 0, width, height);
		} finally {
			// Clean up textures
			this.gl.deleteTexture(texture);
			if (verticalTexture) {
				this.gl.deleteTexture(verticalTexture);
			}
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
		this.outputCanvas = null;
	}
}
