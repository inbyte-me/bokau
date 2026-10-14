# 0009: Party server with capability-based clients

**Context.** Party rooms started as a living-room game: a laptop on the TV runs the show, phones on the same Wi-Fi play.
We want the same game to run on a server with a domain: friends in different places, one of them creating the room from
a phone and playing in it, with or without a TV. So the TV cannot be special: it was the host, the screen, the clip
picker, the transcriber and the show player at once.

**Decision.**
* **The backend is the orchestrator and the media center, always.** It owns the game (the pure reducer), the clock, the
  clips, the takes, the transcription and the final render. Clients draw what the server sends and send what the player
  does; none of them runs the game.
* **Connections have capabilities, not types.** `host` may send commands, `play` gets tasks and turns, `watch` sees the
  public board. A TV is host + watch, a phone host is host + play + watch, a guest is play + watch, a projector is watch.
  The host key adds `host` to any connection (`hello-player` with `hostKey`); `hello-screen` only watches.
* **A public board** (`boardOf`, `@doblaje/party`) is built by the server from the room and sent to every client:
  what the room is doing, with no secrets (scene directions stay off it, character cards stay off it until the cast is
  revealed). A phone with no TV to look at draws the same facts the TV does.
* **Media jobs belong to the server**, delegated only where a browser is unavoidable: transcription runs on the
  server (`PARTY_TRANSCRIBE`, optional); the final render needs the shared mix graph (one graph, never forked), so the
  server asks a host client that can (`job: render`), takes its mix, and makes one `result.mp4` that every client plays
  from the same server time. No client that can render: the room still works, without the file.
* **Two server modes from one codebase.** `studio` is the local app (studio + TV on localhost, a self-signed HTTPS
  listener for phones on the Wi-Fi). `party` has one listener, only the phones' routes, plain HTTP behind a proxy that
  terminates TLS or HTTPS with a certificate, limits per address, CORS for configured origins, and a media policy: the
  files of a room are deleted when everyone has left.
* **Shared pieces** for every client live in `@doblaje/party-ui` (game list, languages, the host's buttons) and
  `@doblaje/ui`; components there take plain props, never a host context or an API.

**Consequences.** The TV keeps working unchanged as a client. A room can be played with phones only, on the Wi-Fi or
across the internet. Deploying needs only ffmpeg, a data folder with prepared clips and a proxy with HTTPS. Because
rooms are ephemeral and media-heavy, a party server holds a room's files only while people are in it; people download
the result on the spot. Not done yet: the TV's own boards still read the full room instead of the public board, and
clip preparation still happens in the desktop studio.
