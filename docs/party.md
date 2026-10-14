# Party rooms

The party game: every guest plays on their phone, and a TV (optional) shows the room. The server runs the room
whatever the clients are. Every game is played so the result stays a mystery until the show: nobody sees or hears
another player's take before it. Decisions behind it: [ADR 0008](adr/0008-party-rooms-over-the-lan.md) (the room, over
the Wi-Fi) and [ADR 0009](adr/0009-party-server-and-clients-with-capabilities.md) (clients with capabilities, a server
on a domain; deploying: [deployment.md](deployment.md)).

## Clients
The server orchestrates; a client is a screen with capabilities (`hello-*` messages in `protocol.ts`):

| Client | Capabilities | What it sees |
|---|---|---|
| TV (`hello-host`) | host, watch | the whole room (`HostView`), plus the host's setup screens |
| Phone that created the room (`hello-player` + the host key) | host, play, watch | its player view and the public board, with the host's sheet (clip, game, language, start, controls) |
| Phone guest (`hello-player`) | play, watch | its own parts and tasks, and the public board |
| Projector (`hello-screen`) | watch | the public board only (`ScreenView`) |

The **public board** (`boardOf`, `board.ts`) is computed by the server and sent to every client: phase, who is in, the
turn on stage and its clock, progress, the contests in progress (who has written, the votes where everyone may read
them), the cast once revealed, the trailer's state, and the rendered result. It has no secrets: a scene's direction and
a character's card stay off it until they should be seen. A phone shows it as a strip (`BoardStrip`) so no TV is needed.

A phone creates a room with `POST /api/party/rooms` (limited per address), keeps the host key in its storage, and says
hello with it. Over the Wi-Fi the room's address is the one the laptop's server prints; on a server it is the domain.

## The show without a TV
When the last take is in, the server asks a host client that can render (it has the audio engine; the host phone does)
for the mix of the finished round, built with the shared mix graph. The server makes one `result.mp4` from it (the
picture, the mix, subtitles burned in except in blind dubbing) and the room moves to the show with
`result: { file, startAt }`: every client plays the same file from the same server time (`ShowScreen`). Nobody able to
render, or the render failing: the show still happens (the TV plays the project itself), just without the file. On a
party server the show screen offers **Download** and says the room's files are deleted when everyone has left.

## Listening to takes
Transcription (what each player said) feeds the next player's context, the AI's suggestions and the trailer's
captions; all of them work without it. The server can do it itself (`PARTY_TRANSCRIBE=1`); otherwise the TV does it in
its browser (`host/listener.ts`), and stands down when `/api/party/info` says the server does.

## Games
| Game | Each turn, the phone shows | Script |
|---|---|---|
| Dub the scene | the original line (and an optional AI suggestion riffing on what the previous player actually said) | the clip's |
| Bad Lip Reading | a new line written to fit the mouths, about a premise the TV chooses | written when the round starts |
| Telenovela | the line rewritten as melodrama | written when the round starts |
| Genre Swap | the line rewritten as noir, pirate, corporate or 80s action | written when the round starts |
| Trailer Director | the direction of the scene (what the room decided happens in it) over a silent picture; between turns the phone asks you to pitch, direct, vote, review or title | moments of the clip spread start to end (see *Trailer Director*) |
| Blind Dubbing | nothing: a silent stretch to improvise over. A later turn opens on how the previous player ended (the last second of their take, played, and their last words once the TV has transcribed them); *Ready* moves on to the scene | none (silent segments) |

Written games are written by the AI when it is available (cheap model, spend cap) and by the offline generator
otherwise, so a party never waits on the internet; the TV's Start button waits until the script is ready. The
lines the players read become the subtitles of the result. Blind dubbing silences the whole scene (dialogue; the
music stays when the clip is separated) and names each part after its player.

The old one-device party screens (one microphone passed around) were retired. A finished round is a party project:
it opens on a round screen (play it, play another round, open it in the studio), and the test phones page
(`/play/grid.html`) covers playing on one computer.

## Playing
1. **Before the party** prepare clips in the library (dialogue separated, subtitles, characters reviewed). Who says
   each subtitle line comes from the voice passages (the Voices lane), so subtitles made before or after the voices
   both work; a character name typed on a line counts only where no passage covers it. Remove characters you do
   not want at the party (right-click their lane, or the bin in the Voices tab): the original goes silent where
   they spoke. Then add
   some background audio (Library → Background audio): music or noise the waiting phones play in headphones.
2. **On the TV** choose *Play at a party* on a clip in the library (or *Party room* to pick the clip there). The room
   opens at once; its header always shows the address, the 4-letter room code, a small QR and how many have joined,
   so people can join at any step.
3. **Set up in three steps.** *Scene*: pick a clip. *Game*: pick one of the six games, the language you will speak, and the
   game's premise or genre; *How it plays* explains it. *Players*: a big QR and the join steps, with each player's name popping in
   in their colour; the rules (people per round, lines per round, time per line, scene length, AI suggestions) fold away.
4. **Guests** scan the QR (same Wi-Fi), confirm the certificate warning once, type their name.
5. **Start the round.** Written games show the AI preparing the script first (picking the slice, writing N lines),
   then the cast is revealed one by one (see *The slice* below). Cast phones tap *Headphones on, I am ready* (this asks
   for the microphone once).
6. **Start.** One line at a time, in scene order: the called phone shows the scene, the line (and the lines around it,
   with what the previous player *actually* said), an optional suggested funny line, and *Watch*, *Record*,
   *Listen*, *Record again*, *Send*, *Skip*. Every other phone shows who is recording and plays background audio.
   The TV shows who records as whom, a big countdown, every line as a dot in its player's colour, and *+15 s*,
   *Skip this line*, *Finish now*.
7. **The show.** When the last line is in, the round's project is cut down to the slice and the TV plays it with
   everyone's takes, then offers *Watch again*,
   *Another round* (same clip and game, a new slice may come up), *Change the game*, *Change the scene*, *Open in
   the studio*. Each round is a normal party project in the library.

Testing without phones: the TV's *Test with phones on this computer* opens `/play/grid.html?room=CODE`, four phone
frames side by side, each a separate player (`?seat=n`).

## The slice
A round plays one stretch of the clip, and the result is that stretch and nothing else
(`pickSlice` and `castRoles` in `packages/party/src/director.ts`):
- **Everyone plays the same number of parts.** The players are everyone connected, up to the *people per round*
  rule. The slice is a run of consecutive lines whose number of characters is a multiple of the players (each voices
  1 to `MAX_PARTS_EACH` = 3 characters). When no stretch divides evenly (three characters, four players), the
  slice is planned for one player fewer, and so on; whoever played most sits out.
- **Every line in it is dubbed.** It is at most *scene length* seconds and at most *lines per round* lines, and its
  one second of padding never reaches into a neighbouring line, so no original voice is left in the result.
- **The best of those.** Dense dialogue, a conversation rather than a monologue, filling the time; a stretch one
  line short of a longer valid one is dropped. One of the best few is picked at random so rounds differ. The whole
  clip is a candidate like any other.
- **Casting** deals every character of the slice: most talkative first, in a snake order over the players (who
  played least goes first), so line counts stay close.
- Blind dubbing picks any talky stretch and cuts it into silent segments, a multiple of the players.
- **Turns** (`turnsOf`): one character each. Consecutive lines of the same character are one turn (the phone shows
  them one per row); turns tile the slice without overlapping, each boundary halfway across the gap (or the
  talk-over) between two characters. The slice picker avoids stretches where characters talk over each other when
  it can. A take may start early and end late on the phone, but the result keeps it inside its turn, so no two
  takes ever overlap and the original is silenced exactly over the recorded turns.

## Language
Every game asks which language the players will speak (*We will speak*; a new room starts in the TV's language),
which need not be the clip's. The TV transcribes each take in it (Whisper base, the subtitles' model) to tell the next
player what was said, suggestions are asked in it, and written games write their lines in it.

When the round ends the server cuts the round's media down to the slice (`cutMedia` in `@doblaje/media`:
frame-accurate, the export source re-encoded at high quality, files written aside so the library clip's hard-linked
media is untouched) and `compileRound` moves cues, voices, takes and silenced ranges into the slice's time
(`party.slice` records where it came from). The round is then a short project like any other: the show, the
studio and exports need no notion of a range. If the cut fails the round keeps the whole clip and the show plays
the slice.

## How it fits together
```
TV (apps/web, #/party)  ──ws /party/ws (host key)──┐
                                                   ├── PartyHub (packages/api/src/party) ── reduce() (@doblaje/party)
Phone (apps/play, /play/) ──wss /party/ws (token)──┘        │ derive round project, store takes, compile
        │ GET  /api/party/rooms/:code/project               │
        │ GET  /party/:code/media/<file>?t=token            ▼
        └ POST /api/party/rooms/:code/takes?turn&start   SQLite + data/projects/<round>/takes/
```
* `@doblaje/party`: the room (`Room`), the reducer `reduce(room, action, {now, rng})`, casting and slicing
  (`director.ts`), per-client views (`playerView`), compiling a round into its project (`compileRound`), the clip's
  script (`scriptOf`) and the browser client (`PartyClient`, reconnecting, Svelte store contract). No I/O.
* `PartyHub` keeps rooms in memory, turns TV commands into reducer actions (loads the clip, derives the round project
  with hard-linked media), stores uploaded takes, runs the 1 s clock (turn deadlines), compiles, and asks for
  suggestions.
* The phone records with the studio's `Engine` / `Mic` / `RecordSession` (`apps/play/src/recorder.ts`): the scene
  plays with the line's original voice silenced, the take is trimmed to the line and sent as 16-bit WAV with its
  latency-compensated start.
* The TV transcribes each take with Whisper (`host/listener.ts`) and reports it (`heard`); the hub then asks
  `suggestLine()` (`@doblaje/ai`) for the next line. The prompt tolerates crude takes (players improvise); refusals,
  errors and the spend cap simply mean no suggestion.

## Security
* The party listener answers only `/play/…`, the player routes, `/party/<code>/media/…`, `/party/<code>/clips/…/poster.jpg`
  and `/sounds/…`, all behind a room token; no studio API, no `/media`, no AI (on the Wi-Fi listener; a party server serves the studio only to signed-in people, from their own workspace: [accounts.md](accounts.md)). A phone may open a room (limited per
  address, `PARTY_CREATES_PER_HOUR`). The host's routes (the clip list, the mix upload) also need the room's host key, or
  the token of the phone that showed it. In a party server (`DOBLAJE_MODE=party`) this is the only listener.
* Host commands need the room's host key (constant-time compare); phone actions only touch the phone's own turn.
* Takes are size-limited, must be WAV, are stored under generated names, and only the current turn's player can
  submit one.

## Network notes
* `PARTY_PORT` (default 5178, `off` to disable), `PARTY_HOST` (default all interfaces), `PARTY_URL` (address put in
  the QR code instead of `https://<lan-ip>:<port>`, e.g. a tunnel).
* Some routers isolate Wi-Fi clients ("guest network", "AP isolation"): phones then cannot reach the laptop. Use the
  main network, or the laptop's hotspot.
* `pnpm doctor` prints the address phones should open.

## Trailer Director
The room makes a movie out of the clip and the result is its trailer (`packages/party/src/trailer.ts`, `contest.ts`,
`montage.ts`). It needs two players; with fewer than three the AI writes the scene directions nobody is free to write.
1. **Cast.** `trailerMoments` picks short stretches of one character spread over the whole clip (*Scenes*, six by
   default), preferring a spread that shows as many different characters as there are players. The clip's own
   characters are dealt to the players like in any round, and a scene is performed by whoever plays its character:
   a character keeps one voice through the trailer. A player may perform two scenes in a row (then nobody is
   the critic for that gap); with more players than characters the extras only pitch, direct and vote.
2. **Character cards** (see below; always on in the trailer).
3. **Pitch** (phase `pitch`): the clip loops silently on the TV and every phone; everyone writes one line about what
   it is about, then votes (never for their own). The winner is the *logline* and the first scene's direction.
4. **Scenes** (phase `playing`): a performer records a scene over the silent picture, told only its direction. While
   they record, the others write the direction of the next scene and vote; the next performer, who is the *critic*,
   writes a quote about a movie they have not seen. Directors are shown who speaks in the scene and their card. A scene is called only once its direction exists, and after the
   last scene the others title the movie. The TV hides directions (the performer is watching it too).
5. **Result.** The server asks the AI (or the offline copy) for the opening card, a narrator line per gap, a made-up
   newspaper per critic and a tagline, then `assembleMedia` joins the scenes with black gaps and `compileTrailer`
   lays the takes on that timeline. Cards (opening, narrator, critic quotes, the title) are subtitles of the result and
   are drawn big on the TV (`TrailerCards`); `party.trailer` records them.

### One toolkit, modes decide
Every game is built from the same tools; a mode decides who does what.
* **Screens on a phone:** *write* a text, *vote* in a poll, *record* over a clip fragment with a prompt
  (`TaskCard` / `WriteTask` / `VoteTask`, `MyTurn`, `SceneLoop`). The TV shows the matching board (`ContestBoard`,
  `TurnNow`, `LineDots`, `HostControls`).
* **A contest** (`contest.ts`) is the unit of writing and voting: who may write, a deadline, the entries, the votes,
  a winner. Pitches, directions and titles are contests; any game can open one.
* **A mode owns** how the clip is chopped (`pickSlice`, `turnsOf`, `blindScript`, `trailerMoments`), who holds which
  role at each step, and which screen each role gets.
* **The AI stands in** for a role nobody can play: a contest nobody answers is written by the AI (`composeText`) and, if
  it stays silent, falls back to the pitch or the clip's name, so a game never stalls. Making any role replaceable
  (a performer too) is the next step: modes declare their roles and the room fills the empty ones.

### Character cards
A cast step for every game except blind dubbing (a setting, *Describe the characters first*; the trailer always does it).
Right after the round is cast (phase `cards`), each character of the round is described by one player: voice and
personality, a line of text, written blind. The writers are dealt round the players at random (`assignWriters`), and
nobody is told who will play whom: phones and TV hide the cast until every card is in (or the minute is up; a card
nobody writes is simply missing). Then the cast is revealed with each character's card (`PartyCharacter.card`).
* **The card belongs to the character**, not to the player who wrote it or the one who plays them, and it follows the
  character through the whole round (and through the trailer's scenes, whoever performs them).
* The performer sees it above the line or direction (`LineView.card`); a direction writer sees it with the character
  in the scene; AI suggestions, directions and cards the AI has to write keep the character in character
  (`SuggestInput.card`, `ComposeInput.character`).
* Cards are `card` contests with one writer (`contest.ts`), settled by the same clock as every other contest.
