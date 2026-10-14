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

## Rooms and libraries
* `POST /api/party/rooms` needs a signed-in person when accounts are on (`401 { code: "login" }` otherwise). The room
  remembers its owner. Guests need nothing.
* A library clip is **private to its owner**. The host's clip list, picking a clip and its poster are limited to their own
  clips plus the **starter pack** (clips nobody owns, available to every host). Other people only get what their host's
  room streams: the low-resolution picture, their takes and the result. Nobody receives the original file.
* Accounts off (`AUTH_PROVIDER` unset, a laptop): rooms are anonymous and every clip is open, as before.

## Configuration
| Variable | Meaning |
|---|---|
| `AUTH_PROVIDER` | `workos` for real sign-in; `dev` signs anyone in by name (tests and local work only); unset: accounts off |
| `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` | from the WorkOS dashboard (staging while developing, production on the VPS) |
| `WORKOS_COOKIE_PASSWORD` | 32+ characters that seal the session cookie: `openssl rand -base64 32` |
| `WORKOS_REDIRECT_URI` | default `PARTY_URL/auth/callback`; register it, and the sign-out redirect `PARTY_URL/play/`, in WorkOS |

Set up in WorkOS: a staging environment with AuthKit on (sign-in methods of your choice); redirect URI
`http://localhost:5177/auth/callback` for local work and `https://<your domain>/auth/callback` for the server; sign-out
redirect `…/play/` (for this project: `https://bokau.askn.us/auth/callback` and `https://bokau.askn.us/play/`). Production keys are
separate from staging ones: the staging environment is for local work and trying the real domain; the live server should use
the production environment's API key and client id, with the same redirects registered there.

## Giving clips an owner
Clips are prepared in the studio and moved to the server as a bundle (`pnpm library export` / `import`, docs/deployment.md, *Clips*);
until uploads exist, give them to an owner with their WorkOS user id (shown in the WorkOS dashboard, or in the `users` table after their
first sign-in): `pnpm library assign <clipId> <userId>`, `pnpm library release <clipId>` (back to the starter pack),
`pnpm library list`.

## Encryption at rest
A clip can be **sealed**: every file of its library folder is stored encrypted (AES-256-GCM in 1 MiB chunks, so a long
video streams) with a random data key of its own, wrapped by a **master key** the operator keeps outside the data folder
(`LIBRARY_KEY`, base64 of 32 random bytes, or `LIBRARY_KEY_FILE`; generate with `openssl rand -base64 32`). A leaked disk,
backup or copy of the data folder is then only ciphertext. Sealing verifies each sealed copy (it decrypts and compares a
hash) before the plain file is deleted, and is safe to repeat.
* `pnpm library assign <clipId> <userId>` gives a clip an owner and seals it (when a key is set); `seal`/`unseal` do just that.
* When a host starts a round, the server decrypts a **working copy** into the round's own project folder (never a hard link
  to the library), and the room's files are deleted when the room empties (docs/deployment.md, *Media policy*). Posters are
  decrypted on the way out.
* A sealed clip on a server with no key (or the wrong one) is refused with an error, never served broken.
* Honest limits: a running server must read the media to run rooms, so a compromised running server can read what its rooms
  are using; the clips' transcripts live in the SQLite database unencrypted (use an encrypted VPS volume or disk for that,
  and for the working copies of open rooms). **Back up the master key apart from the data**: lose it and sealed clips are gone.
