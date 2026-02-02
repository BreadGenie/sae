# E2E Tests

End-to-end tests using Playwright.

## Setup

1. Install dependencies:

```bash
cd e2e
yarn install
yarn install-browsers
```

2. Generate fake audio file (requires ffmpeg):

```bash
cd resources
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 10 -q:a 9 -acodec pcm_s16le fake-audio.wav
```

3. Create test users in Frappe:

```bash
bench --site meet.localhost execute meet.utils.test_helpers.create_test_users
```

## Running Tests

### Prerequisites

Ensure all services are running:

- Frappe server (`bench start`)
- SFU server (`cd sfu-server && npm run dev`)
- Frontend dev server (`cd frontend && npm run dev`) - or use built frontend

### Run Tests

```bash
# Run all tests
yarn test

# Run with browser visible
yarn test:headed

# Run with debug mode (step through)
yarn test:debug

# Run with Playwright UI
yarn test:ui

# View test report
yarn test:report
```

## Test Structure

```
e2e/
├── fixtures/           # Test fixtures and helpers
│   ├── participants.ts # Multi-browser participant management
│   └── test-users.ts   # Test user credentials
├── helpers/            # API helpers and utilities
│   ├── auth.ts         # Authentication (API login)
│   ├── index.ts
├── page-objects/       # Page Object Model classes
│   ├── LoginPage.ts
│   ├── HomePage.ts
│   ├── MeetingPage.ts
│   ├── MeetingPreviewPage.ts
│   ├── ToolbarControls.ts
│   ├── ChatPanel.ts
│   └── PeoplePanel.ts
│   └── .....
├── specs/
│   ├── meeting/
│   ├── media/
│   └── chat/
├── resources/          # Test resources (fake audio, etc.)
├── playwright.config.ts
└── global-setup.ts
```

## Writing Tests

Use the `Participant` abstraction for multi-browser tests:

```typescript
import { test, expect } from "../../fixtures";

test("two users can chat", async ({ createParticipant }) => {
  const p1 = await createParticipant();
  const meetingId = await p1.loginAndCreateMeeting("user1");

  const p2 = await createParticipant();
  await p2.loginAndJoinMeeting("user2", meetingId);

  await p1.toolbar.openChat();
  await p1.chat.sendMessage("Hello!");

  await p2.toolbar.openChat();
  await p2.chat.waitForMessage("Hello!");
});
```

## Fake Media

Chrome flags are used to provide consistent fake media:

- `--use-fake-ui-for-media-stream` - Auto-grant permissions
- `--use-fake-device-for-media-stream` - Use fake camera/mic
- `--use-file-for-fake-audio-capture=resources/fake-audio.wav` - Custom audio
