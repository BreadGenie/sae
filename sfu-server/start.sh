#!/bin/bash

# Frappe Meet SFU Server Setup and Start Script
#
# Usage:
#   ./start.sh              Start SFU server only
#   ./start.sh --with-stt   Start SFU + STT (faster-whisper) service
#
# Environment:
#   WHISPER_MODEL       Model name (default: large-v3-turbo)
#   WHISPER_BACKEND     auto | faster-whisper | mlx (default: auto — mlx on Mac, fw on Linux)
#   WHISPER_DEVICE      auto | cuda | cpu (default: auto — cuda if available)
#   WHISPER_COMPUTE_TYPE auto | float16 | int8 (default: auto — float16 on GPU, int8 on CPU)
#   WHISPER_LANGUAGE    Language code (e.g. en, hi, ko) or empty for auto-detect
#   WHISPER_HOST        Host for whisper server (default: 127.0.0.1)
#   WHISPER_PORT        Port for whisper server (default: 8080)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

WITH_STT=false

# Parse arguments
for arg in "$@"; do
	case $arg in
		--with-stt)
			WITH_STT=true
			shift
			;;
		--help|-h)
			echo "Usage: $0 [--with-stt]"
			echo ""
			echo "Options:"
			echo "  --with-stt    Start STT (faster-whisper) service alongside SFU"
			echo ""
			echo "Environment variables:"
			echo "  WHISPER_MODEL           Model name (default: large-v3-turbo)"
			echo "  WHISPER_BACKEND         auto | faster-whisper | mlx (default: auto)"
			echo "  WHISPER_DEVICE          auto | cuda | cpu (default: auto)"
			echo "  WHISPER_COMPUTE_TYPE    auto | float16 | int8 (default: auto)"
			echo "  WHISPER_LANGUAGE        Language code (default: auto-detect)"
			echo "  WHISPER_HOST            Whisper server host (default: 127.0.0.1)"
			echo "  WHISPER_PORT            Whisper server port (default: 8080)"
			echo "  WHISPER_CPU_THREADS     CPU threads (default: 4, only used on CPU)"
			echo "  STT_VAD_THRESHOLD       Speech detection sensitivity (default: 0.012)"
			exit 0
			;;
	esac
done

echo -e "${BLUE}🚀 Frappe Meet SFU Server Setup${NC}"
echo "================================"

if [ "$WITH_STT" = true ]; then
	echo -e "${BLUE}📝 STT mode enabled${NC}"
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js first.${NC}"
    exit 1
fi

# Check Node.js version (mediasoup requires Node.js 22+)
NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="22.0.0"

# Simple version comparison (major version check)
NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)
REQUIRED_MAJOR=22

if [ "$NODE_MAJOR" -lt "$REQUIRED_MAJOR" ]; then
    echo -e "${RED}❌ Node.js version ${NODE_VERSION} is not supported. Please install Node.js 22 or higher.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Node.js version: ${NODE_VERSION}${NC}"

# Check if yarn is installed
if ! command -v yarn &> /dev/null; then
    echo -e "${RED}❌ Yarn is not installed. Please install Yarn first.${NC}"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    yarn install
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "${GREEN}✅ Dependencies already installed${NC}"
fi

# Build TypeScript
echo -e "${BLUE}🔨 Building TypeScript...${NC}"
yarn build
echo -e "${GREEN}✅ TypeScript built successfully${NC}"

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}📝 Creating .env file...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✅ .env file created from .env.example${NC}"
    echo -e "${YELLOW}⚠️  Please edit .env file with your configuration${NC}"
else
    echo -e "${GREEN}✅ .env file exists${NC}"
fi

# Load .env variables into the shell environment so child processes can see them.
# We only export lines that look like KEY=VALUE, ignoring comments and blanks.
if [ -f ".env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        # Skip empty lines and lines starting with # or //
        case "$line" in
            ''|\#*|//*) continue ;;
        esac
        # Only export if it looks like KEY=VALUE
        if echo "$line" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*='; then
            key=$(echo "$line" | cut -d'=' -f1)
            val=$(echo "$line" | cut -d'=' -f2-)
            export "$key=$val"
        fi
    done < .env
fi

# ── STT Service Setup ──────────────────────────────────────────────────────────

WHISPER_PIDS=()

if [ "$WITH_STT" = true ]; then
	echo -e "${BLUE}🎙️  Setting up STT service...${NC}"

	WHISPER_MODEL=${WHISPER_MODEL:-small}
	WHISPER_HOST=${WHISPER_HOST:-127.0.0.1}
	WHISPER_PORT=${WHISPER_PORT:-8080}

	# Ensure logs directory exists
	mkdir -p logs

	# Check if port is available
	if lsof -Pi :$WHISPER_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
		echo -e "${RED}❌ Whisper port $WHISPER_PORT is already in use.${NC}"
		exit 1
	fi

	# Check python3
	if ! command -v python3 &> /dev/null; then
		echo -e "${RED}❌ python3 is required for STT. Please install Python 3.9+.${NC}"
		exit 1
	fi

	PYTHON_VENV="./.venv"
	if [ ! -d "$PYTHON_VENV" ]; then
		echo -e "${YELLOW}📦 Creating Python virtual environment...${NC}"
		python3 -m venv "$PYTHON_VENV"
	fi

	source "$PYTHON_VENV/bin/activate"

	if ! python3 -c "import faster_whisper" 2>/dev/null; then
		echo -e "${YELLOW}📦 Installing faster-whisper dependencies...${NC}"
		pip install -q -r stt-server/requirements.txt
	fi

	: "${WHISPER_DEVICE:=auto}"
	: "${WHISPER_BACKEND:=auto}"
	: "${WHISPER_COMPUTE_TYPE:=auto}"
	: "${WHISPER_CPU_THREADS:=4}"
	: "${WHISPER_LANGUAGE:=}"

	echo -e "${GREEN}✅ Starting STT server on ${WHISPER_HOST}:${WHISPER_PORT} (model=${WHISPER_MODEL})${NC}"
	echo -e "${GREEN}   Backend auto-detects: Apple Silicon → mlx (GPU), NVIDIA → CUDA, else CPU${NC}"
	echo -e "${YELLOW}   Model will download on first start (~809MB). Set HF_TOKEN for faster downloads.${NC}"
	WHISPER_MODEL="$WHISPER_MODEL" \
	WHISPER_HOST="$WHISPER_HOST" \
	WHISPER_PORT="$WHISPER_PORT" \
	WHISPER_DEVICE="$WHISPER_DEVICE" \
	WHISPER_BACKEND="$WHISPER_BACKEND" \
	WHISPER_COMPUTE_TYPE="$WHISPER_COMPUTE_TYPE" \
	WHISPER_CPU_THREADS="$WHISPER_CPU_THREADS" \
	WHISPER_LANGUAGE="$WHISPER_LANGUAGE" \
	HF_HOME="${HF_HOME:-./.cache}" \
	HF_TOKEN="${HF_TOKEN:-}" \
		python3 stt-server/server.py > "logs/faster-whisper-server.log" 2>&1 &
	WHISPER_PIDS+=("$!")

	# Wait for whisper server to be ready (can take a while on first start — model download)
	echo -e "${YELLOW}⏳ Waiting for whisper server to be ready (this may take a few minutes on first start)...${NC}"
	READY=false
	for i in {1..300}; do
		if curl -fsS "http://${WHISPER_HOST}:${WHISPER_PORT}/health" >/dev/null 2>&1; then
			echo -e "${GREEN}✅ Whisper server is ready${NC}"
			READY=true
			break
		fi
		# Print progress every 30s
		if [ $((i % 30)) -eq 0 ]; then
			MODEL_CACHE=$(find "${HF_HOME:-./.cache}/hub" -name "*.incomplete" 2>/dev/null | head -1)
			if [ -n "$MODEL_CACHE" ]; then
				SIZE=$(du -sh "$MODEL_CACHE" 2>/dev/null | cut -f1)
				echo -e "${YELLOW}   Still waiting... model download in progress ($SIZE downloaded)${NC}"
			else
				echo -e "${YELLOW}   Still waiting... (${i}s elapsed)${NC}"
			fi
		fi
		sleep 1
	done
	if [ "$READY" = false ]; then
		echo -e "${RED}❌ Whisper server failed to start. Check logs/faster-whisper-server.log${NC}"
		for pid in "${WHISPER_PIDS[@]}"; do
			kill $pid 2>/dev/null || true
		done
		exit 1
	fi

	export WHISPER_SERVER_URL="http://${WHISPER_HOST}:${WHISPER_PORT}"
	echo -e "${GREEN}✅ STT backend ready: ${WHISPER_SERVER_URL}${NC}"
fi

# Check if port is available
PORT=${PORT:-3000}
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${RED}❌ Port $PORT is already in use. Please change the PORT in .env file.${NC}"
    for pid in "${WHISPER_PIDS[@]}"; do
		kill $pid 2>/dev/null || true
	done
    exit 1
fi

echo -e "${GREEN}✅ Port $PORT is available${NC}"

# ── Cleanup trap ───────────────────────────────────────────────────────────────

cleanup() {
	if [ ${#WHISPER_PIDS[@]} -gt 0 ]; then
		echo -e "${YELLOW}🛑 Stopping ${#WHISPER_PIDS[@]} whisper worker(s)...${NC}"
		for pid in "${WHISPER_PIDS[@]}"; do
			kill $pid 2>/dev/null || true
			wait $pid 2>/dev/null || true
		done
		echo -e "${GREEN}✅ Whisper worker(s) stopped${NC}"
	fi
}
trap cleanup EXIT INT TERM

# Start the server
echo -e "${BLUE}🎬 Starting SFU Server...${NC}"
echo "================================"

if [ "$NODE_ENV" = "development" ]; then
    echo -e "${BLUE}🚀 Starting server in development mode with hot reload...${NC}"
    echo -e "${YELLOW}📁 Watching: src/**/*.{ts,js,json}${NC}"
    echo -e "${YELLOW}🔄 Hot reload enabled - server will restart on file changes${NC}"
    yarn dev:watch
else
    # Production mode
    node dist/sfu-server/src/server.js
fi
