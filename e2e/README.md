# E2E Tests

Fresh Playwright coverage for Frappe Meet with parallelism, simplicity, and speed as first-order constraints.

## Design

- Each test creates its own meeting and can run independently.
- The host uses API login and API meeting creation to avoid slow UI setup.
- Secondary participants join as guests to avoid account contention across workers.
- Media capture and screen sharing are stubbed in the browser context, so no ffmpeg assets are required.
- Toolbar auto-hide is disabled through localStorage during test setup.

## Run

```bash
yarn test:e2e
yarn test:e2e:headed
```

Or directly:

```bash
cd e2e
yarn install
yarn test
```
