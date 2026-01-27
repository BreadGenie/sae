# E2E Test Resources

This directory contains resources used for E2E testing.

## fake-audio.wav

A silent or simple tone WAV file used with Chrome's `--use-file-for-fake-audio-capture` flag.

To generate a 10-second silent WAV file:

```bash
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 10 -q:a 9 -acodec pcm_s16le fake-audio.wav
```

Or a simple 440Hz tone:

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=10" -acodec pcm_s16le fake-audio.wav
```

## fake-video.y4m (optional)

A Y4M video file for consistent video testing. Generate with:

```bash
ffmpeg -f lavfi -i testsrc=duration=10:size=640x480:rate=30 -pix_fmt yuv420p fake-video.y4m
```
