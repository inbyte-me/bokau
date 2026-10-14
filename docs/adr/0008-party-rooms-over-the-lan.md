# 0008: Party rooms: one server, phones over HTTPS on the local network

**Context.** At a party every guest has a phone and headphones. The game needs each phone to show the scene, record
a line privately and send it, while the laptop on the TV runs the show. Phones only allow the microphone in a secure
context (HTTPS or localhost), and the studio API must stay local (it controls files and a paid AI key).

**Decision.**
* **One server process.** `createApp()` listens twice: the local listener (studio + TV, localhost only, everything)
  and a party listener (HTTPS, all interfaces, `PARTY_PORT`, default 5178) that serves only the phone app, the player
  routes, the round's media and background sounds. The TV is a client like the phones: it connects to the server.
* **Self-signed certificate**, generated on first start into the data folder and reissued when the machine gets a new
  address; each guest confirms it once. A tunnel or real domain can replace it later (`PARTY_URL`).
* **The server owns the game.** A pure reducer in `@doblaje/party` (lobby → casting → turns → compiling → show) driven
  by the TV's commands, the phones' actions, uploads and a 1-second clock. Every client gets a *view*: the TV sees
  the room, a phone sees its own parts and only its own lines. WebSocket per client (`/party/ws`), JSON messages,
  reconnect with a per-phone token.
* **Takes are recorded on the phone** with the studio's own engine and session (same latency handling), trimmed to the
  line and uploaded as WAV for the current turn; the server places them on the round's project (one track per part)
  and silences the original voice exactly where a line was dubbed (`Project.dubbed`). The TV plays the result with
  the shared mix graph.
* **AI is a hint, never a gate.** Casting and the scene slice are deterministic code (seeded). Suggested lines come
  from a cheap model riffing on what the previous player actually said (transcribed on the TV); failures, refusals
  and the spend cap just mean no suggestion.

**Consequences.** Works offline on a home Wi-Fi with no accounts. Rooms live in memory (a server restart ends the
party; the TV opens a new room by itself). The whole game is testable without devices: a reducer test, a protocol test
with WebSocket clients, and a browser test with a TV page and phone contexts.
