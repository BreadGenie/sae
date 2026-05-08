#!/usr/bin/env python3
"""
FastAPI server wrapping faster-whisper for STT.

Endpoints:
  GET  /health     -> 200 OK
  POST /inference   -> { text: str }
  POST /transcribe-pcm  -> { text: str }  (raw PCM s16le, faster than WAV)

Form fields:
  file        - WAV audio data
  language    - Language code (default: "en")
  prompt      - Rolling context from previous transcriptions

PCM fields:
  audio       - raw int16le PCM bytes at 16kHz mono
  language    - Language code (default: "en")
  prompt      - Rolling context
"""

import asyncio
import io
import os
import time
from contextlib import asynccontextmanager

import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from starlette.requests import Request

MODEL_SIZE = os.getenv("WHISPER_MODEL", "tiny.en")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", "4"))
NUM_WORKERS = int(os.getenv("WHISPER_NUM_WORKERS", "1"))

model = None
transcribe_semaphore = None


def pcm16le_to_float32(audio_bytes: bytes) -> np.ndarray:
	"""Convert raw int16 PCM to float32 normalized to [-1, 1]."""
	audio_i16 = np.frombuffer(audio_bytes, dtype=np.int16)
	return audio_i16.astype(np.float32) / 32768.0


def run_transcription(audio, language: str = "en", prompt: str = ""):
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


@asynccontextmanager
async def lifespan(app: FastAPI):
	global model, transcribe_semaphore
	from faster_whisper import WhisperModel

	print(
		f"[faster-whisper] Loading model={MODEL_SIZE} device={DEVICE} compute_type={COMPUTE_TYPE} threads={CPU_THREADS} workers={NUM_WORKERS} ..."
	)
	t0 = time.time()
	model = WhisperModel(
		MODEL_SIZE,
		device=DEVICE,
		compute_type=COMPUTE_TYPE,
		cpu_threads=CPU_THREADS,
		num_workers=NUM_WORKERS,
	)
	print(f"[faster-whisper] Model loaded in {time.time() - t0:.2f}s")

	# Warmup: transcribe 1s silence to prime CPU caches
	print("[faster-whisper] Warming up model...")
	warmup_audio = np.zeros(16000, dtype=np.float32)
	warmup_start = time.time()
	run_transcription(warmup_audio)
	print(f"[faster-whisper] Warmup completed in {time.time() - warmup_start:.2f}s")

	# Semaphore ensures only one inference at a time on CPU
	transcribe_semaphore = asyncio.Semaphore(1)

	yield
	print("[faster-whisper] Shutting down...")


app = FastAPI(title="faster-whisper STT Server", lifespan=lifespan)


@app.get("/health")
async def health():
	return {"status": "ok"}


@app.post("/inference")
async def inference(
	file: UploadFile = File(...),  # noqa: B008
	language: str = Form("en"),
	prompt: str = Form(""),
):
	if model is None:
		return JSONResponse({"error": "Model not loaded"}, status_code=503)

	audio_bytes = io.BytesIO(await file.read())

	t0 = time.time()
	async with transcribe_semaphore:
		text, duration = await asyncio.to_thread(run_transcription, audio_bytes, language, prompt)
	elapsed = time.time() - t0
	print(f"[faster-whisper] {duration:.1f}s audio in {elapsed:.2f}s -> '{text[:80]}'")
	return {"text": text}


@app.post("/transcribe-pcm")
async def transcribe_pcm(
	language: str = "en",
	prompt: str = "",
	request: Request = None,
):
	"""Raw PCM endpoint — skip WAV encoding overhead."""
	if model is None:
		return JSONResponse({"error": "Model not loaded"}, status_code=503)

	audio_bytes = await request.body()
	audio_np = pcm16le_to_float32(audio_bytes)
	duration_s = len(audio_np) / 16000.0

	t0 = time.time()
	async with transcribe_semaphore:
		text, _ = await asyncio.to_thread(run_transcription, audio_np, language, prompt)
	elapsed = time.time() - t0
	rtf = elapsed / duration_s if duration_s > 0 else 0
	print(f"[faster-whisper] pcm {duration_s:.1f}s in {elapsed:.2f}s (RTF={rtf:.2f}) -> '{text[:80]}'")
	return {"text": text}


if __name__ == "__main__":
	host = os.getenv("WHISPER_HOST", "127.0.0.1")
	port = int(os.getenv("WHISPER_PORT", "8080"))
	uvicorn.run(app, host=host, port=port)
