<div align="center">

<a href="https://github.com/frappe/meet">
    <img src="https://frappe.io/files/meet_logo.png" height="80" alt="Frappe Meet Logo">
</a>

<h1>Frappe Meet</h1>

**Simple, High Quality Video Conferencing**

</div>

> [!WARNING]  
> Frappe Meet is an alpha product and is not yet ready for production!

## Frappe Meet

Frappe Meet is a video conferencing app built with simplicity, quality, and reliability in mind.

### Key Features

- **High-quality meetings:** Low-latency, scalable multi-party video with adaptive streaming.
- **Meeting Management:** Create meetings and control meeting access for guests, participants, or hosts.
- **Multimedia features:** Features like background effects, noise suppression, and push-to-talk elevate the meeting experience. 

### Under the Hood

- [Mediasoup](https://github.com/versatica/mediasoup): Cutting Edge WebRTC Video Conferencing.
- [Frappe Framework](https://github.com/frappe/frappe): A full-stack web application framework.
- [Frappe UI](https://github.com/frappe/frappe-ui): A Vue-based UI library, to provide a modern user interface.

### Local Development

#### Prerequisites

- Frappe-bench set up locally ([installation guide](https://docs.frappe.io/framework/user/en/installation))
- Node.js and yarn

#### Step 1: Set up the Backend

1. In your frappe-bench directory, run the following commands in separate terminal sessions:

   ```sh
   # Terminal 1 - Start the Frappe server
   cd frappe-bench
   bench start
   ```

2. Open a new terminal session for the remaining setup:
   ```sh
   cd frappe-bench
   bench new-site meet.localhost
   bench get-app meet
   bench --site meet.localhost install-app meet
   bench --site meet.localhost add-to-hosts
   bench --site meet.localhost browse --user Administrator
   ```

#### Step 2: Set up the Frontend

1. Open a new terminal session and navigate to the meet app:

   ```sh
   cd frappe-bench/apps/meet
   ```

2. Install frontend dependencies and start the dev server:
   ```sh
   cd frontend
   yarn install
   yarn dev
   ```

#### Step 3: Set up the SFU Server

1. Open a new terminal session and navigate to the SFU server:

   ```sh
   cd frappe-bench/apps/meet/sfu-server
   ```

2. Copy the example environment file and configure it:

   ```sh
   cp .env.example .env
   ```

   Edit `.env` and set:
   - `JWT_SECRET` — must match `sfu_secret` in your Frappe site config

3. Set the matching secret in Frappe site config:

   ```sh
   cd frappe-bench
   bench --site meet.localhost set-config sfu_secret "your_secret"
   ```

4. Install dependencies and start the SFU server:
   ```sh
   cd frappe-bench/apps/meet/sfu-server
   yarn install
   yarn dev
   ```

### License

AGPL-3.0

<br>
<br>
<div align="center">
	<a href="https://frappe.io" target="_blank">
		<picture>
			<source media="(prefers-color-scheme: dark)" srcset="https://frappe.io/files/Frappe-white.png">
			<img src="https://frappe.io/files/Frappe-black.png" alt="Frappe Technologies" height="28"/>
		</picture>
	</a>
</div>
