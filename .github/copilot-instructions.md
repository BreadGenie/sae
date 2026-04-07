---
description: "Frappe Meet - Video conferencing app development standards and best practices"
applyTo: "frontend/**/*.{vue,ts,js}, meet/**/*.py, sfu-server/**/*.{ts,js}"
---

# Project Name: Frappe Meet

Frappe Meet is a video conferencing application built on the Frappe Framework with mediasoup SFU. It provides real-time video/audio communication, screen sharing, chat, and meeting management capabilities.

# Tech Stack

- **Backend**: Frappe Framework (Python)
- **Frontend**: Vue 3 App with Vite dev server
- **SFU Server**: Node.js with mediasoup and Socket.IO
- **Real-time**: Socket.IO for signaling, mediasoup for media routing
- **UI Library**: frappe-ui for consistent components
- **Styling**: Tailwind CSS with semantic design tokens

# Architecture Overview

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

## Key Components

1. **Client (Frontend)**: Vue.js SPA with direct SFU communication
2. **Frappe Server**: Authentication, permissions, meeting management, and API endpoints
3. **SFU Server**: Handles transports, producers/consumers, and media routing via mediasoup

---

# Frontend: VueJS 3 Development Instructions

## Frontend Project Context

- `./frontend/` is the main directory for VueJS frontend code
- Vue 3.x with Composition API as default
- TypeScript for type safety (types defined in `.ts` files)
- Single File Components (`.vue`) with `<script setup>` syntax (TypeScript optional per file)
- Vite as the build tool with frappe-ui plugin
- **No state management libraries** - use composables and reactive state
- frappe-ui for UI components and data fetching utilities
- mediasoup-client for real-time media communication
- Socket.IO for direct client-to-SFU signaling

## Frontend Project Structure

- `./frontend/src/` contains the main source code
- `./frontend/src/components/` for reusable UI components
- `./frontend/src/pages/` for page components (Home, Meeting, Login, etc.)
- `./frontend/src/data/` for data fetching and state management composables
- `./frontend/src/composables/` for reusable logic (meeting logic, layout management)
- `./frontend/src/utils/` for utility functions and helpers (device detection, SFU client, text utils)
- `./frontend/src/assets/` for static assets (fonts, images)
- `./frontend/src/icons/` for custom SVG icon components

## Vite Dev Server

- Assume the Vite dev server is already running on port 8094
- Never ask to run dev server or build commands unless specifically requested
- Vite config includes frappe-ui plugin with proxy enabled
- Frontend builds to `../meet/public/frontend/` for production
- Access via `http://meet.localhost:8094` during development
- Production access via Frappe web route `/meet`

## Development Standards

### Architecture

- Favor the Composition API (`<script setup>` and composables) over the Options API
- Organize components and composables by feature or domain for scalability
- Separate UI-focused components (presentational) from logic-focused components (containers)
- Put page components in `./frontend/src/pages/` directory
- Use a `./frontend/src/components/` directory for shared UI components
- For small components, just put them in one file `pages/Page.vue` or `./frontend/src/components/Component.vue`
- For larger features, split into smaller components and composables in a feature folder

### TypeScript Integration

- Use TypeScript for utility functions and complex logic (`.ts` files)
- Vue components can optionally use `<script setup lang="ts">` when type safety is needed
- Define interfaces and types in `./frontend/src/types.ts` or colocated `.ts` files
- Use `PropType<T>` for typed props when using TypeScript in components
- Define types for mediasoup entities and Socket.IO events

### Component Design

- Adhere to the single responsibility principle for components
- Use PascalCase for component names and file names
- Keep components small and focused on one concern
- Use `<script setup>` syntax for brevity and performance
- Validate props with TypeScript or runtime checks as needed
- Favor slots and scoped slots for flexible composition
- Use `ref()` for accessing DOM elements (e.g., video elements for media streams)

### State Management

- **Do NOT use any state management libraries like Vuex or Pinia**
- For simple local state, use `ref` and `reactive` within `<script setup>`
- Use `computed` for derived state
- Create composables in `./frontend/src/composables/` for shared state and logic:
  - `useMeetingState.js` - Core meeting state (participants, streams, etc.)
  - `useMeetingLogic.js` - Meeting lifecycle and operations
  - `useVideoGridLayout.js` - Video grid layout calculations
  - `useScreenShareSidebar.js` - Screen share sidebar state
- Use reactive objects from `./frontend/src/data/` for app-level state:
  - `session.js` - Session and authentication state
  - `user.js` - Current user information
  - `mediaPreferences.js` - Media device preferences (persisted to localStorage)

### Composition API Patterns

- Create reusable composables for shared logic
- Use `watch` and `watchEffect` with precise dependency lists
- Cleanup side effects in `onUnmounted` or `watch` cleanup callbacks
- Use `provide`/`inject` sparingly for deep dependency injection
- Always cleanup media tracks, producers, consumers, and transports in `onUnmounted`

### Styling

- Always prefer Tailwind CSS for styling
- Use utility classes for layout and spacing
- Use semantic class names from frappe-ui preset:
  - Background colors: `bg-surface-white`, `bg-surface-gray-1` through `bg-surface-gray-9`, `bg-surface-black`
  - Text colors: `text-ink-white`, `text-ink-gray-1` through `text-ink-gray-9`, `text-ink-black`
  - Fill colors: `fill-ink-*`
  - Placeholder colors: `placeholder-ink-*`
  - Border colors: `border-outline-white`, `border-outline-gray-1` through `border-outline-gray-5`, `border-outline-black`
  - Ring colors: `ring-outline-*`
  - Divide colors: `divide-ink-gray-*`
  - Font sizes: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-3xl`
  - Multiline text: `text-p-xs`, `text-p-sm`, `text-p-base`, `text-p-lg`, `text-p-xl`, `text-p-2xl`
- **Always use gray shades for everything, never use color shades even for primary states**
- Use standard Tailwind CSS classes for everything else
- Avoid `<style scoped>` unless absolutely necessary
- Implement mobile-first, responsive design with CSS Grid and Flexbox
- Ensure styles are accessible (contrast, focus states)
- For video elements, use appropriate sizing classes and object-fit utilities

### Performance Optimization

- Apply `v-once` for static elements
- Apply `v-memo` for expensive renders that rarely change
- Avoid unnecessary watchers; prefer `computed` where possible
- Lazy load components with `defineAsyncComponent` for heavy features
- Tree-shake unused code and leverage Vite's optimization features
- For video grids, use efficient layout calculations and virtualization if needed

### Data Fetching

- Use `createResource`, `createListResource`, `createDocumentResource` from frappe-ui for data fetching
- Look at `./frontend/src/data/` for examples of data fetching patterns

**Creating a resource for API calls:**

```js
import { createResource } from "frappe-ui";

const meetingDetails = createResource({
  url: "meet.api.meeting.get_meeting_details",
  params: { meeting_id: props.meetingId },
  auto: true, // Fetch immediately
  onSuccess(data) {
    // Handle success
  },
  onError(error) {
    // Handle error
  },
});

// Access data
meetingDetails.data; // The response data
meetingDetails.loading; // Boolean loading state
meetingDetails.error; // Error object if any

// Operations
meetingDetails.reload(); // Refetch data
meetingDetails.fetch({ meeting_id: "new-id" }); // Fetch with new params
```

**Creating a document resource:**

```js
import { createDocumentResource } from "frappe-ui";

const meeting = createDocumentResource({
  doctype: "Sae Meeting",
  name: meetingId,
  auto: true,
});

// Access data
meeting.doc; // Document object with all fields

// Operations
meeting.get(); // Fetch/refresh document
meeting.setValue.submit({ status: "Active" }); // Update field
meeting.save(); // Save changes
meeting.delete.submit(); // Delete document
```

### Icons

- **Always use Lucide icons** - they are auto-imported via the frappe-ui vite plugin
- Icons are available directly in templates without imports:
  ```vue
  <template>
    <lucide-video class="w-5 h-5" />
    <lucide-mic-off class="w-5 h-5 text-red-500" />
    <lucide-phone-off class="w-5 h-5" />
  </template>
  ```
- Common icons for video conferencing:
  - `lucide-video`, `lucide-video-off` - Camera controls
  - `lucide-mic`, `lucide-mic-off` - Microphone controls
  - `lucide-phone-off` - End call
  - `lucide-monitor-up`, `lucide-monitor-pause` - Screen share
  - `lucide-message-square`, `lucide-message-square-dot` - Chat
  - `lucide-settings` - Settings
  - `lucide-users` - Participants
  - `lucide-more-horizontal` - More options menu
- Use consistent sizing: `w-4 h-4`, `w-5 h-5`, or `w-6 h-6`
- All lucide icons follow kebab-case naming: `lucide-icon-name`

### Mediasoup Client Patterns

- Import mediasoup-client types and utilities from `./frontend/src/mediasoup-client.js`
- Use the SFU client abstraction in `./frontend/src/utils/sfu-client.js` for media operations
- Use the SFU meeting manager in `./frontend/src/utils/sfu-meeting-manager.js` for high-level meeting logic
- Handle errors gracefully (device access, connection failures, codec issues)
- Display user-friendly messages for permission denials and connection issues

**Resource Cleanup:**

```js
onUnmounted(() => {
  // Stop all local media tracks
  if (localStream.value) {
    localStream.value.getTracks().forEach((track) => track.stop());
  }

  // Close producers
  producers.value.forEach((producer) => producer.close());

  // Close consumers
  consumers.value.forEach((consumer) => consumer.close());

  // Close transports
  sendTransport.value?.close();
  recvTransport.value?.close();
});
```

### Socket.IO Communication

- Import socket connection from `./frontend/src/socket.js`
- Socket.IO is used for direct client-to-SFU signaling (bypasses Frappe server for media)
- Connections are JWT authenticated (token obtained from Frappe backend)
- Always handle connection, disconnection, and reconnection events

**Connection Pattern:**

```js
import { io } from "socket.io-client";

// Get JWT token from Frappe API
const { token } = await getJWTToken(meetingId);

// Connect to SFU server
const socket = io(SFU_SERVER_URL, {
  auth: { token },
  transports: ["websocket", "polling"],
});

// Connection lifecycle
socket.on("connect", () => {
  console.log("Connected to SFU");
});

socket.on("connect_error", (error) => {
  console.error("Connection failed:", error);
  // Show user-friendly error message
});

socket.on("disconnect", (reason) => {
  console.log("Disconnected:", reason);
  // Handle reconnection or show error
});
```

**Event Handling:**

```js
onMounted(() => {
  // Listen for participant events
  socket.on("participantJoined", handleParticipantJoined);
  socket.on("participantLeft", handleParticipantLeft);

  // Listen for media events
  socket.on("newProducer", handleNewProducer);
  socket.on("producerClosed", handleProducerClosed);

  // Listen for chat events
  socket.on("chatMessage", handleChatMessage);
});

onUnmounted(() => {
  // Clean up all listeners
  socket.off("participantJoined", handleParticipantJoined);
  socket.off("participantLeft", handleParticipantLeft);
  socket.off("newProducer", handleNewProducer);
  socket.off("producerClosed", handleProducerClosed);
  socket.off("chatMessage", handleChatMessage);

  // Disconnect from SFU
  socket.disconnect();
});
```

**Common Socket Events:**

- **Client → SFU**: `joinMeeting`, `createTransport`, `connectTransport`, `produce`, `consume`, `sendMessage`
- **SFU → Client**: `participantJoined`, `participantLeft`, `newProducer`, `producerClosed`, `chatMessage`, `error`

**Error Handling:**

```js
socket.on("error", ({ code, message }) => {
  switch (code) {
    case "INVALID_TOKEN":
      // Redirect to login or refresh token
      break;
    case "MEETING_NOT_FOUND":
      // Show meeting not found error
      break;
    case "PERMISSION_DENIED":
      // Show access denied error
      break;
    default:
      // Show generic error
      console.error("Socket error:", message);
  }
});
```

**Best Practices:**

- Emit events with acknowledgments for critical operations: `socket.emit('produce', data, (response) => {})`
- Implement exponential backoff for reconnection attempts
- Handle socket disconnection gracefully (pause streams, show reconnecting UI)
- Use socket rooms for efficient meeting-level broadcasting
- Always validate socket event data before processing

### Device Management

- Use utilities from `./frontend/src/utils/device.ts` for device enumeration
- Store device preferences in `./frontend/src/data/mediaPreferences.js`
- Persist device selections to localStorage
- Handle device changes (plugging/unplugging) gracefully
- Request permissions appropriately and handle denials

### Error Handling

- Use global error handler for uncaught errors
- Wrap risky logic in `try/catch`; provide user-friendly messages
- Display error notifications using frappe-ui's toast/notification system
- For media errors, provide specific guidance (check permissions, refresh page, etc.)
- Use `errorCaptured` hook in components for local error boundaries

### Forms and Validation

- Build forms with controlled `v-model` bindings
- Use frappe-ui form components (Input, Button, FormControl, etc.)
- Validate on blur or input with debouncing for performance
- Ensure accessible labeling, error announcements, and focus management

### Routing

- Vue Router 4 with routes defined in `./frontend/src/router.js`
- Main routes:
  - `/` - Home page (meeting list/creation)
  - `/meet/:id` - Meeting room
  - `/login` - Login page
  - `/sfu-dashboard` - SFU dashboard (admin)
- Use `useRoute` and `useRouter` in `<script setup>` for programmatic navigation
- Protect routes with navigation guards for authentication

### Security

- Avoid using `v-html`; sanitize any HTML inputs rigorously
- Validate and escape data in templates and directives
- Never expose sensitive tokens in client-side code
- Use JWT tokens for SFU authentication (obtained from backend)

### Accessibility

- Use semantic HTML elements and ARIA attributes
- Manage focus for modals and dynamic content
- Provide keyboard navigation for interactive components
- Add meaningful `alt` text for images and icons
- Ensure color contrast meets WCAG AA standards
- Add captions/transcription support where applicable
- Announce participant join/leave events for screen readers

## Utilities and Composables

- Create custom composables for common patterns
- Reuse existing composables from `./frontend/src/composables/`

## Implementation Process

1. Plan component and composable architecture
2. Create core UI components and layout
3. Implement data fetching and state logic
4. Integrate mediasoup functionality for media handling
5. Add real-time Socket.IO event handling
6. Ensure accessibility compliance
7. Test on multiple browsers and devices

## Additional Guidelines

- Follow Vue's official style guide (vuejs.org/style-guide)
- Use Biome for linting and formatting (configured in `biome.json`)
- Write meaningful commit messages and maintain clean git history
- Keep dependencies up to date and audit for vulnerabilities
- Document complex mediasoup logic with comments
- Use Vue DevTools for debugging and profiling

## Common Patterns

- Renderless components and scoped slots for flexible UI
- Compound components using provide/inject (e.g., video grid with tiles)
- Custom composables for media lifecycle management
- Reactive refs for media streams and device states

---

# Backend: Frappe Framework Development Instructions

## Backend Project Context

- Frappe Framework is a full-stack web application framework
- Provides background workers using Redis, real-time updates using sockets, database using MariaDB
- Bench is the official command-line tool for managing Frappe applications

## Backend Project Structure

- `./meet/` is the main directory for backend code
- `./meet/meet/` contains the main application code
- `./meet/meet/doctype/` contains individual doctype definitions
- `./meet/api/` contains whitelisted API endpoints
- `./meet/utils/` contains utility functions and helpers
- `./meet/fixtures/` contains initial data fixtures (e.g., roles)
- `./meet/www/` contains web pages and routes

## Backend Development Guidelines

### API Endpoints

- Create whitelisted functions in `./meet/api/` directory
- Always use `@frappe.whitelist()` decorator for public endpoints
- Use `@frappe.whitelist(allow_guest=True)` for guest-accessible endpoints
- Apply rate limiting for security-sensitive endpoints:

  ```python
  from frappe.rate_limiter import rate_limit

  @frappe.whitelist()
  @rate_limit(limit=10, seconds=60 * 60)
  def create_meeting():
      pass
  ```

- Return structured responses with success/error states
- Handle exceptions gracefully and return user-friendly error messages

### DocTypes

- Main doctype: `Sae Meeting` in `./meet/meet/doctype/sae_meeting/`
- Implement custom methods in doctype controller classes
- Override `has_permission` for custom permission logic
- Use proper field types and validations in JSON definitions
- Leverage DocType hooks for lifecycle events

### SFU Configuration

- SFU config utilities in `./meet/utils/sfu_config.py`
- SFU manager utilities in `./meet/utils/sfu_manager.py`
- Store SFU settings in site_config.json:
  - `sfu_secret` - JWT secret for SFU authentication
  - `sfu_server_url` - SFU server URL
- Generate JWT tokens for client-to-SFU authentication using the shared secret

### User Management

- User utilities in `./meet/utils/user.py`
- Fetch user details (full name, avatar) for meeting participants
- Respect Frappe's permission system for user access

## Bench Commands

- Always run bench commands from the `frappe-bench` directory
- Use `meet.localhost` as the site name for local development
- Run site commands with `bench --site meet.localhost <command>`
- Common commands:
  - `bench --site meet.localhost migrate` - Run database migrations
  - `bench --site meet.localhost clear-cache` - Clear cache
  - `bench --site meet.localhost console` - Python console
  - `bench --site meet.localhost execute <module.function>` - Execute Python function
  - `bench --site meet.localhost set-config sfu_secret "your_secret"` - Set SFU secret
  - `bench --site meet.localhost set-config sfu_server_url "http://localhost:3000"` - Set SFU URL

## Security Best Practices

- Validate all user inputs
- Use Frappe's permission system appropriately
- **NEVER use `ignore_permissions=True` on `@frappe.whitelist(allow_guest=True)` endpoints** - this bypasses all security for unauthenticated users
- Apply rate limiting to prevent abuse
- Validate meeting access before returning sensitive data
- Never expose internal implementation details in error messages

## Testing

- Write unit tests for critical business logic
- Test permission checks thoroughly
- Test API endpoints with different user roles
- Test edge cases (missing data, invalid inputs, etc.)

---

# SFU Server: Node.js & Mediasoup Development

## SFU Server Project Context

- `./sfu-server/` contains the Node.js SFU server
- Built with TypeScript, Express, Socket.IO, and mediasoup
- Handles media routing and signaling
- JWT authentication for client connections

## SFU Server Structure

- `./sfu-server/src/` contains TypeScript source code
- `./sfu-server/src/server.ts` - Main server entry point
- `./sfu-server/src/mediasoup/` - Mediasoup worker and router management
- `./sfu-server/src/server/` - Socket.IO event handlers and logic
- `./sfu-server/src/types/` - TypeScript type definitions
- `./sfu-server/src/utils/` - Utility functions
- `./sfu-server/scripts/` - Utility scripts (e.g., fake user spawning)
- `./sfu-server/logs/` - Log files

## Development Standards

### TypeScript

- Use strict TypeScript settings
- Define types for all Socket.IO events and payloads
- Use interfaces for complex objects
- Leverage mediasoup types from the package

### Socket.IO Patterns

- Authenticate connections using JWT tokens (shared secret with Frappe server)
- Store connection state per socket (meeting ID, user ID, participant info)
- Handle disconnections and cleanup resources (close transports, notify other participants)
- Emit events for participant join/leave, media state changes
- Use Socket.IO rooms for efficient meeting-level broadcasting
- Implement event acknowledgments for critical operations
- Handle socket namespace separation if supporting multiple meeting types

**JWT Authentication Pattern:**

```ts
import jwt from "jsonwebtoken";

io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.data.user = decoded.user;
    socket.data.meetingId = decoded.meetingId;
    next();
  } catch (err) {
    next(new Error("Authentication failed"));
  }
});
```

**Room Management:**

```ts
socket.on("joinMeeting", async ({ meetingId }) => {
  // Join room
  await socket.join(meetingId);

  // Notify other participants
  socket.to(meetingId).emit("participantJoined", {
    userId: socket.data.user.id,
    name: socket.data.user.name,
  });

  // Send existing participants to new joiner
  const existingParticipants = getParticipantsInRoom(meetingId);
  socket.emit("existingParticipants", existingParticipants);
});
```

**Cleanup on Disconnect:**

```ts
socket.on("disconnect", () => {
  const { meetingId, user } = socket.data;

  // Close all transports for this socket
  const transports = getSocketTransports(socket.id);
  transports.forEach((transport) => transport.close());

  // Remove from room
  socket.leave(meetingId);

  // Notify other participants
  socket.to(meetingId).emit("participantLeft", { userId: user.id });

  // Cleanup resources
  cleanupSocketResources(socket.id);
});
```

### Mediasoup Best Practices

- Initialize workers based on CPU cores (typically one worker per CPU core)
- Use one router per meeting room (routers handle media routing within a meeting)
- Create separate transports for send/receive per participant
- Clean up producers, consumers, and transports on disconnect to prevent memory leaks
- Handle errors and edge cases (network issues, codec mismatches, worker crashes)

**Worker Pool Management:**

```ts
import { Worker } from "mediasoup/node/lib/Worker";
import { Router } from "mediasoup/node/lib/Router";

const workers: Worker[] = [];
let nextWorkerIndex = 0;

// Create workers based on CPU cores
async function createWorkers() {
  const numWorkers = os.cpus().length;

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: "warn",
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
    });

    worker.on("died", () => {
      console.error("Worker died, exiting...");
      process.exit(1);
    });

    workers.push(worker);
  }
}

// Round-robin worker selection
function getNextWorker(): Worker {
  const worker = workers[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return worker;
}
```

**Router and Transport Management:**

```ts
// Create router for meeting
async function createMeetingRouter(meetingId: string): Promise<Router> {
  const worker = getNextWorker();

  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {
          "x-google-start-bitrate": 1000,
        },
      },
    ],
  });

  return router;
}

// Create transport for participant
async function createTransport(router: Router, direction: "send" | "recv") {
  const transport = await router.createWebRtcTransport({
    listenIps: [
      {
        ip: "0.0.0.0",
        announcedIp: ANNOUNCED_IP, // Public IP or domain
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}
```

**Producer and Consumer Lifecycle:**

```ts
// Create producer (participant sends media)
socket.on("produce", async ({ transportId, kind, rtpParameters }, callback) => {
  const transport = getTransport(transportId);

  const producer = await transport.produce({ kind, rtpParameters });

  // Notify other participants about new producer
  socket.to(meetingId).emit("newProducer", {
    producerId: producer.id,
    userId: socket.data.user.id,
    kind,
  });

  callback({ id: producer.id });
});

// Create consumer (participant receives media)
socket.on(
  "consume",
  async ({ transportId, producerId, rtpCapabilities }, callback) => {
    const transport = getTransport(transportId);
    const router = getRouter(meetingId);

    // Check if router can consume
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      return callback({ error: "Cannot consume" });
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // Start paused, resume after setup
    });

    callback({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  }
);
```

**Resource Cleanup:**

```ts
function cleanupParticipant(socketId: string, meetingId: string) {
  const participant = participants.get(socketId);
  if (!participant) return;

  // Close all producers
  participant.producers.forEach((producer) => {
    producer.close();
    // Notify consumers
    io.to(meetingId).emit("producerClosed", { producerId: producer.id });
  });

  // Close all consumers
  participant.consumers.forEach((consumer) => consumer.close());

  // Close transports
  participant.sendTransport?.close();
  participant.recvTransport?.close();

  // Remove from participants map
  participants.delete(socketId);
}
```

### Configuration

- Store config in `.env` file (use `.env.example` as template)
- Key settings:
  - `JWT_SECRET` - Must match Frappe site config `sfu_secret` (critical for authentication)
  - `PORT` - SFU server port (default 3000)
  - `HOST` - Bind address (0.0.0.0 for production, 127.0.0.1 for local)
  - `ANNOUNCED_IP` - Public IP or domain (clients need to reach this)
  - `RTC_MIN_PORT`, `RTC_MAX_PORT` - Port range for media connections (default 10000-10100)
- Ensure JWT_SECRET is the same in both Frappe `site_config.json` and SFU `.env`
- For local development, set `ANNOUNCED_IP` to your local IP (not 127.0.0.1)
- For production, use your server's public IP or domain name

### Running the Server

- Development: `yarn dev` or `yarn dev:watch` (with nodemon)
- Production: `yarn build && yarn start`
- Assume SFU server is already running during development

### Logging

- Use structured logging for debugging
- Log important events (connections, disconnections, errors)
- Store logs in `./sfu-server/logs/` directory

### Error Handling

- Handle mediasoup worker crashes and restart workers
- Handle Socket.IO connection errors
- Emit error events to clients with meaningful messages
- Log all errors for debugging

---

# Miscellaneous

## Code Comments

- Only add comments that explain **why** something is done, not what is done
- Use JSDoc for documenting complex functions and APIs
- Use TSDoc for TypeScript functions
- Don't add unnecessary comments for simple, self-explanatory code
- Use inline comments sparingly

## Code Quality

- Use Biome for linting and formatting (both frontend and SFU server)
- Run `yarn lint` to check code
- Run `yarn format` to fix formatting
- Ignore newline errors in all files
- Write clean, readable code that follows project conventions

## Git Workflow

- Use pre-commit hooks (configured with pre-commit framework)
- Write meaningful commit messages
- Keep commits focused and atomic
- Use feature branches for new features

## Documentation

- Update README.md when adding new features
- Document API endpoints and their parameters
- Document environment variables and configuration options
- Add inline documentation for complex logic

---

**For updates, merge new conventions here. If anything is unclear or missing, ask for clarification.**
