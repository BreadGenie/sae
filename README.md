# Frappe Meet

A video conferencing app built with Frappe.

## Architecture

```
┌─────────────┐    HTTP/WS     ┌─────────────────────┐
│   Client    │ ◄─────────────► │ Frappe Server      │
│ (Frontend)  │                │ (Auth, Perms etc)   │
│             │                └─────────────────────┘
│             │
│             │    Socket.IO (JWT Auth)
│             │ ◄────────────────────────────────┐
└─────────────┘                                  │
                                                 ▼
                                       ┌─────────────┐
                                       │ SFU Server  │
                                       │ (mediasoup) │
                                       └─────────────┘
```

### Components

1. **Client (Frontend)**: Vue.js application with WebRTC capabilities and direct SFU communication
2. **Frappe Server**: Handles authentication, permissions, and meeting management
3. **SFU Server (mediasoup)**: Handles transports, producers/consumers and media routing.

### Prerequisites

- Frappe Framework (v15+)
- Node.js 18+ (recommended for mediasoup)
- Python 3.10+
- System deps for mediasoup (libc++, libsrtp, etc.)

### 1. Install the Frappe App

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch develop
bench install-app meet
```

### 2. Setup SFU Server

```bash
# Navigate to SFU server directory
cd apps/meet/sfu-server

# Install dependencies (including new JWT support)
npm install

cp .env.example .env
# Minimum required settings in .env:
# JWT_SECRET=your_jwt_secret_here
# PORT=3000
# HOST=0.0.0.0
# WEBRTC_ANNOUNCED_IP=<public_ip_or_domain>

# Start SFU server
npm start
```

### 3. Configure Frappe Site

Add to your site config:

Add to `site_config.json` (values must match SFU):

```jsonc
{
  "sfu_secret": "your_jwt_secret_here",
  "sfu_server_url": "https://your-domain.example"
}
```

### 4. Build Frontend

```bash
cd apps/meet/frontend
yarn install
yarn build
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/meet
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### CI

This app can use GitHub Actions for CI. The following workflows are configured:

- CI: Installs this app and runs unit tests on every push to `develop` branch.
- Linters: Runs [Frappe Semgrep Rules](https://github.com/frappe/semgrep-rules) and [pip-audit](https://pypi.org/project/pip-audit/) on every pull request.

### License

AGPL-3.0
