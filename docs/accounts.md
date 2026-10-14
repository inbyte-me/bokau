# Accounts and private libraries

On a party server (or any server started with accounts on) only the people who **host** sign in; guests join a room by
its link with no account. Decisions: [ADR 0009](adr/0009-party-server-and-clients-with-capabilities.md).

## What an account is
* The identity provider (**WorkOS AuthKit**: email, Google…) holds the passwords and the emails. This server keeps a
  user id, a display name and which library clips are theirs (`users`, `clip_owners` in SQLite).
* Signing in sets a sealed, HttpOnly, SameSite=Lax session cookie (`Secure` over HTTPS); the SDK opens and renews it. The
  phone app and the API share one origin, so the cookie just works (a single origin by design).
* `GET /auth/login?return=/play/` → provider → `GET /auth/callback` → back to `return` (only a path on this site: no open
  redirect); `GET /auth/logout`; `GET /api/me` says who you are and whether hosting needs a login.

## A studio and a library of your own
A signed-in person has the **whole studio** at `https://<domain>/studio/` (the same app as the desktop one: library, timeline, voices,
subtitles, AI, exports) working on a **workspace of their own**: `<data>/users/<id>/` holds their SQLite database (`doblaje.db`),
`projects/` and `sounds/`. Nothing is shared between people, so there is no permission to forget: a request is answered from the
workspace of the person who made it, and no route can name another person's. Signed out, `/studio/`, `/api` (the studio's), `/media`,
`/hf` and `/vendor` answer 401 or send you to sign in. On the phone app a signed-in host has **Open my library** and **Create a room**.

* **Rooms:** `POST /api/party/rooms` needs a signed-in person (`401 { code: "login" }` otherwise); the room remembers its owner and plays
  from **their** library (their clips, their sounds, their rounds). Guests need nothing and only get what the room streams: the
  low-resolution picture, their takes and the result. Nobody receives the original file.
* **Building a library:** in the studio, create a clip (a project marked as a library clip), upload the video, separate the voices, make
  subtitles, name the characters; then host a room from the phone and pick it. A prepared clip can also be moved in as a bundle
  (`pnpm library import`, docs/deployment.md, *Clips*).
* **Limits, per person:** `USER_QUOTA_MB` of files (checked before each POST; reading and deleting always work), `USER_UPLOAD_MB` per
  upload, one heavy job at a time, and the server runs `MAX_JOBS` at once across everyone; no `from-path`. Neural separation
  (Demucs) is not installed in the image, so voices are separated by the lighter methods.
* **The AI key is shared and never leaves the server.** Every person's studio calls OpenRouter through the server with the one key
  set in the environment; browsers never receive it (no endpoint returns it, an error from the provider is scrubbed of it before it
  travels, and a test asserts it). Each person has their own budget (`USER_AI_CAP_USD`, in their own ledger), so one person cannot
  spend what is meant for everyone.
* Accounts off (`AUTH_PROVIDER` unset, a laptop): rooms are anonymous and one shared library serves them; a party server in that state
  serves no studio at all.

## Configuration
| Variable | Meaning |
|---|---|
| `AUTH_PROVIDER` | `workos` for real sign-in; `dev` signs anyone in by name (tests and local work only); unset: accounts off |
| `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` | from the WorkOS dashboard (staging while developing, production on the VPS) |
| `WORKOS_COOKIE_PASSWORD` | 32+ characters that seal the session cookie: `openssl rand -base64 32` |
| `USER_QUOTA_MB`, `USER_UPLOAD_MB`, `USER_AI_CAP_USD`, `MAX_JOBS` | per-person limits (defaults 3000, 500, 0.1) and heavy jobs at once (2) |
| `WORKOS_REDIRECT_URI` | default `PARTY_URL/auth/callback`; register it, and the sign-out redirect `PARTY_URL/play/`, in WorkOS |

Set up in WorkOS: a staging environment with AuthKit on (sign-in methods of your choice); redirect URI
`http://localhost:5177/auth/callback` for local work and `https://<your domain>/auth/callback` for the server; sign-out
redirect `…/play/` (for this project: `https://bokau.askn.us/auth/callback` and `https://bokau.askn.us/play/`). Production keys are
separate from staging ones: the staging environment is for local work and trying the real domain; the live server should use
the production environment's API key and client id, with the same redirects registered there.

## Encryption at rest
A clip can be **sealed** (`pnpm library seal <clipId> --user <id>`, or on `import`): every file of its library folder is stored encrypted (AES-256-GCM in 1 MiB chunks, so a long
video streams) with a random data key of its own, wrapped by a **master key** the operator keeps outside the data folder
(`LIBRARY_KEY`, base64 of 32 random bytes, or `LIBRARY_KEY_FILE`; generate with `openssl rand -base64 32`). A leaked disk,
backup or copy of the data folder is then only ciphertext. Sealing verifies each sealed copy (it decrypts and compares a
hash) before the plain file is deleted, and is safe to repeat.
* A sealed clip is for **playing**: its media is not served in the clear, so the studio cannot edit it until it is unsealed
  (`pnpm library unseal <clipId> --user <id>`). Clips in a library being edited are stored in the clear on the volume: encrypt the
  VPS disk for those (below).
* When a host starts a round, the server decrypts a **working copy** into the round's own project folder (never a hard link
  to the library), and the room's files are deleted when the room empties (docs/deployment.md, *Media policy*). Posters are
  decrypted on the way out.
* A sealed clip on a server with no key (or the wrong one) is refused with an error, never served broken.
* Honest limits: a running server must read the media to run rooms, so a compromised running server can read what its rooms
  are using; the clips' transcripts live in the SQLite database unencrypted (use an encrypted VPS volume or disk for that,
  and for the working copies of open rooms). **Back up the master key apart from the data**: lose it and sealed clips are gone.
