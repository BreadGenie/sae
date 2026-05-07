#!/usr/bin/env python3
"""
FastAPI server wrapping faster-whisper for STT.

Endpoints:
  GET  /health     -> 200 OK
  POST /inference   -> { text: str }

Form fields:
  file        - WAV audio data
  language    - Language code (default: "en")
  prompt      - Rolling context from previous transcriptions
"""

import asyncio
import io
import os
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

MODEL_SIZE = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", "4"))

model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
	global model
	from faster_whisper import WhisperModel

	print(f"[faster-whisper] Loading model={MODEL_SIZE} device={DEVICE} compute_type={COMPUTE_TYPE} ...")
	t0 = time.time()
	model = WhisperModel(
		MODEL_SIZE,
		device=DEVICE,
		compute_type=COMPUTE_TYPE,
		cpu_threads=CPU_THREADS,
	)
	print(f"[faster-whisper] Model loaded in {time.time() - t0:.2f}s")
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

	transcribe_kwargs = dict(
		audio=audio_bytes,
		language=language if language else None,
		beam_size=1,
		initial_prompt=prompt if prompt else None,
		condition_on_previous_text=False,
		without_timestamps=True,
		vad_filter=False,
	)

	segments_iter, info = await asyncio.to_thread(model.transcribe, **transcribe_kwargs)

	segments = list(segments_iter)
	text = " ".join(s.text.strip() for s in segments if s.text).strip()

	elapsed = time.time() - t0
	print(f"[faster-whisper] {info.duration:.1f}s audio in {elapsed:.2f}s -> '{text[:80]}'")

	return {"text": text}


if __name__ == "__main__":
	host = os.getenv("WHISPER_HOST", "127.0.0.1")
	port = int(os.getenv("WHISPER_PORT", "8080"))
	uvicorn.run(app, host=host, port=port)
