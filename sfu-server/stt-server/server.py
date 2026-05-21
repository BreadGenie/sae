#!/usr/bin/env python3
"""
FastAPI server for real-time STT.

Backends:
  - faster-whisper / cuda   → NVIDIA GPU (prod Docker)
  - faster-whisper / cpu    → CPU fallback (int8) [default]
  - mlx                     → Apple Silicon GPU (set WHISPER_BACKEND=auto or mlx)

Endpoints:
  GET  /health           -> { status: "ok" }
  POST /transcribe-pcm   -> { text: str }   (raw PCM s16le, 16kHz mono)
"""

import asyncio
import json
import os
import sys
import time
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.requests import Request

MODEL_SIZE = os.getenv("WHISPER_MODEL", "small")
BACKEND = os.getenv("WHISPER_BACKEND", "faster-whisper")  # auto | faster-whisper | mlx
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")  # auto | cuda | cpu
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "auto")  # auto | float16 | int8
CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", "6"))
LANGUAGE = os.getenv("WHISPER_LANGUAGE", "").strip()

model = None
backend_name = None
transcribe_fn = None
transcribe_semaphore = None
ready = False  # set to True after warmup completes


def pcm16le_to_float32(audio_bytes: bytes) -> np.ndarray:
	audio_i16 = np.frombuffer(audio_bytes, dtype=np.int16)
	return audio_i16.astype(np.float32) / 32768.0


MLX_MODEL_MAP = {
	"tiny": "mlx-community/whisper-tiny-mlx",
	"tiny.en": "mlx-community/whisper-tiny.en-mlx",
	"base": "mlx-community/whisper-base-mlx",
	"base.en": "mlx-community/whisper-base.en-mlx",
	"small": "mlx-community/whisper-small-mlx",
	"small.en": "mlx-community/whisper-small.en-mlx",
	"medium": "mlx-community/whisper-medium-mlx",
	"medium.en": "mlx-community/whisper-medium.en-mlx",
	"large": "mlx-community/whisper-large-mlx",
	"large-v3": "mlx-community/whisper-large-v3-mlx",
	"large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
}


def _label(**parts) -> None:
	parts_str = " ".join(f"{k}={v}" for k, v in parts.items())
	print(f"[stt] {parts_str}")


def _resolve_mlx_model(name: str) -> str:
	"""Map model name to mlx-community repo. Pass through full repo IDs unchanged."""
	if "/" in name:
		return name
	repo = MLX_MODEL_MAP.get(name, name)
	hf_home = os.getenv("HF_HOME", os.path.expanduser("~/.cache/huggingface"))
	local_snapshot = Path(os.path.join(hf_home, "hub", f"models--{repo.replace('/', '--')}", "snapshots"))
	# huggingface_hub cache format: models--org--repo/snapshots/<revision>
	if local_snapshot.exists():
		snapshots = sorted(local_snapshot.iterdir(), reverse=True)
		if snapshots:
			return str(snapshots[0])
	return repo


# ── Backend dispatchers ──────────────────────────────────────────────────────


def _load_faster_whisper():
	global model, backend_name
	from faster_whisper import WhisperModel

	resolved_device = DEVICE
	resolved_compute = COMPUTE_TYPE

	if resolved_device == "auto":
		try:
			import torch

			resolved_device = "cuda" if torch.cuda.is_available() else "cpu"
		except ImportError:
			resolved_device = "cpu"

	if resolved_compute == "auto":
		resolved_compute = "float16" if resolved_device == "cuda" else "int8"

	backend_name = f"faster-whisper/{resolved_device}"
	print("╔══════════════════════════════════════════════╗")
	print("║  Loading faster-whisper                      ║")
	print(f"║  Model   : {MODEL_SIZE:<35s}║")
	print(f"║  Device  : {resolved_device:<35s}║")
	print(f"║  Compute : {resolved_compute:<35s}║")
	print(f"║  Threads : {str(CPU_THREADS) if resolved_device == 'cpu' else 'N/A (GPU)':<29s}║")
	print("╚══════════════════════════════════════════════╝")
	t0 = time.time()
	model = WhisperModel(
		MODEL_SIZE,
		device=resolved_device,
		compute_type=resolved_compute,
		cpu_threads=CPU_THREADS if resolved_device == "cpu" else 0,
		num_workers=1,
	)
	_label(backend=backend_name, event="loaded", elapsed=f"{time.time() - t0:.2f}s")

	def transcribe(audio, language: str, prompt: str):
		segments_iter, info = model.transcribe(
			audio=audio,
			language=language if language else None,
			beam_size=1,
			best_of=1,
			initial_prompt=prompt if prompt else None,
			condition_on_previous_text=False,
			without_timestamps=True,
			vad_filter=False,
		)
		segments = list(segments_iter)
		text = " ".join(s.text.strip() for s in segments if s.text).strip()
		return text, info.duration

	return transcribe


def _load_mlx():
	global model, backend_name
	import mlx_whisper

	backend_name = f"mlx/{MODEL_SIZE}"
	mlx_model = _resolve_mlx_model(MODEL_SIZE)
	print("╔══════════════════════════════════════════════╗")
	print("║  Loading mlx-whisper (Apple GPU)             ║")
	print(f"║  Model   : {MODEL_SIZE:<35s}║")
	print(f"║  HF Repo : {mlx_model:<35s}║")
	print("║  Device  : Apple Silicon GPU                 ║")
	print("╚══════════════════════════════════════════════╝")
	# mlx-whisper doesn't pre-load a model object; it loads on each transcribe call.
	# We store model path so we can use it later.
	model = mlx_model
	_label(backend=backend_name, event="ready")

	def transcribe(audio, language: str, prompt: str):
		result = mlx_whisper.transcribe(
			audio,
			path_or_hf_repo=model,
			language=language if language else None,
			initial_prompt=prompt if prompt else None,
			word_timestamps=False,
		)
		# mlx-whisper returns dict with "text" key
		text = result.get("text", "").strip()
		# Estimate audio duration from array
		duration = len(audio) / 16000.0 if isinstance(audio, np.ndarray) else 0
		return text, duration

	return transcribe


# ── Warmup ───────────────────────────────────────────────────────────────────


def run_warmup(fn):
	warmup_audio = np.zeros(16000, dtype=np.float32)
	t0 = time.time()
	fn(warmup_audio, LANGUAGE, "")
	_label(event="warmup", elapsed=f"{time.time() - t0:.2f}s")


# ── Lifespan ──────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
	global transcribe_fn, transcribe_semaphore

	resolved_backend = BACKEND

	if resolved_backend == "auto":
		if sys.platform == "darwin":
			try:
				import mlx_whisper

				resolved_backend = "mlx"
			except ImportError:
				resolved_backend = "faster-whisper"
		else:
			resolved_backend = "faster-whisper"

	if resolved_backend == "mlx":
		transcribe_fn = _load_mlx()
	else:
		transcribe_fn = _load_faster_whisper()

	_label(event="startup", backend=backend_name, model=MODEL_SIZE, language=LANGUAGE or "auto")
	print("╔══════════════════════════════════════════════╗")
	print("║  STT Server Ready                           ║")
	print(f"║  Backend : {backend_name:<35s}║")
	print(f"║  Model   : {MODEL_SIZE:<35s}║")
	print(f"║  Lang    : {(LANGUAGE or 'auto'):<35s}║")
	print("╚══════════════════════════════════════════════╝")

	transcribe_semaphore = asyncio.Semaphore(1)

	# Warmup in background so server starts immediately.
	# mlx downloads the model on first transcribe call, which can take time.
	print("[stt] Warming up model in background...")
	loop = asyncio.get_event_loop()

	def _warmup_and_mark_ready():
		global ready
		try:
			run_warmup(transcribe_fn)
			ready = True
			print("[stt] Model ready, accepting requests")
		except Exception as e:
			print(f"[stt] Warmup failed (model will load on first request): {e}")
			ready = True  # still mark ready so first request triggers download

	loop.run_in_executor(None, _warmup_and_mark_ready)

	yield
	print("[stt] Shutting down...")


app = FastAPI(title="STT Server", lifespan=lifespan)


@app.get("/health")
async def health():
	if not ready:
		return JSONResponse(
			{"status": "loading", "backend": backend_name or "loading", "model": MODEL_SIZE}, status_code=503
		)
	return {"status": "ok", "backend": backend_name, "model": MODEL_SIZE}


@app.post("/transcribe-pcm")
async def transcribe_pcm(request: Request):
	"""Raw PCM endpoint — skip WAV encoding overhead."""
	if not ready or model is None or transcribe_fn is None:
		return JSONResponse({"error": "Model not loaded"}, status_code=503)

	audio_bytes = await request.body()
	if not audio_bytes:
		return JSONResponse({"error": "No audio data"}, status_code=400)

	audio_np = pcm16le_to_float32(audio_bytes)
	duration_s = len(audio_np) / 16000.0

	async def event_stream() -> AsyncGenerator[str, None]:
		t0 = time.time()

		async with transcribe_semaphore:
			# Use backend-specific transcription function (faster-whisper or mlx)
			def transcribe_all():
				text, _duration = transcribe_fn(audio_np, LANGUAGE, "")
				segments = [text] if text else []
				return segments

			segments = await asyncio.to_thread(transcribe_all)

			# Yield each segment as an SSE event
			for text in segments:
				yield f"data: {json.dumps({'text': text, 'isFinal': True})}\n\n"

		elapsed = time.time() - t0
		rtf = elapsed / duration_s if duration_s > 0 else 0
		print(f"[stt] {duration_s:.1f}s in {elapsed:.2f}s (RTF={rtf:.2f}) -> {len(segments)} segments")

	return StreamingResponse(event_stream(), media_type="text/event-stream")


if __name__ == "__main__":
	host = os.getenv("WHISPER_HOST", "127.0.0.1")
	port = int(os.getenv("WHISPER_PORT", "8080"))
	uvicorn.run(app, host=host, port=port)
