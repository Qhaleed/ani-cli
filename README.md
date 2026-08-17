# ani-cli desktop

An unofficial, open-source desktop companion for
[ani-cli](https://github.com/pystardust/ani-cli). This project is independent
from, and is not endorsed by, the ani-cli maintainers.
It brings search, title selection, episode selection, embedded HLS playback,
and downloads into one macOS- and Windows-friendly window without requiring a
terminal UI.

> Early-stage project: upstream providers and endpoints can change, so a
> stream may occasionally be unavailable even when the application itself is
> working.

## Features

- Search anime from the desktop window.
- Choose a title and episode without `fzf`.
- Select subtitle/dub mode and video quality.
- Play HLS streams in the embedded player.
- Download episodes through an in-app save dialog using `ffmpeg` or `yt-dlp`.
- Use Electron's Chromium network session for AniDB requests, including a
  client-side title-database fallback when the browse page is challenged.
- No Terminal, Windows Terminal, Git Bash, mpv, VLC, or `fzf` is needed for
  the GUI workflow.

## Run from source

Requirements:

- Node.js 20 or newer.
- An internet connection.
- `ffmpeg` or `yt-dlp` only if you want the download feature.

```sh
git clone <your-repository-url>
cd ani-cli-client
npm install
npm start
```

To inspect the local project without opening the window:

```sh
npm run diagnostics
npm run check
```

## Development

The app is a small Electron project with a secure preload bridge. The renderer
does not have Node.js access; network and filesystem operations stay in the
main process.

```text
main.js                 Electron main process and AniDB browser adapter
preload.js              Narrow renderer-to-main IPC bridge
renderer/index.html     Desktop UI structure
renderer/styles.css     UI theme and responsive layout
renderer/app.js         Search, episode, playback, and download state
ani-cli/                Bundled upstream ani-cli source and license
scripts/diagnostics.js  Local runtime diagnostics
```

Useful commands:

```sh
npm start       # Run the desktop app
npm run check   # Syntax-check application JavaScript
npm run diagnostics
```

## Architecture

The GUI calls the upstream AniDB-compatible flow from Electron's Chromium
session. Search results and episode lists are rendered in the app; stream
URLs are resolved in the main process and passed to the local HLS player.
Downloads are started as child processes from the main process and never open
a terminal window.

The original upstream shell program remains in `ani-cli/` for attribution and
reference. The GUI does not invoke its interactive terminal menu.

## Licensing and attribution

This project is licensed under the GNU General Public License v3.0-only. The
source repository contains the source needed to study and modify the project;
packaged releases should be distributed with the applicable license and notice
files. See [`LICENSE`](LICENSE).

The upstream `ani-cli` source bundled in `ani-cli/` retains its original
license and attribution at [`ani-cli/LICENSE`](ani-cli/LICENSE). The GUI is a
separate desktop interface and does not replace or invoke ani-cli's interactive
terminal menu.

Third-party notices are collected in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). In particular, the
embedded player uses `hls.js`, licensed under Apache-2.0.

The app includes an **About & licenses** panel with the same attribution
summary and links to the full local license files.

## Contributing

1. Fork the repository and create a focused branch.
2. Make the smallest change that addresses the issue.
3. Run `npm run check` and `npm run diagnostics`.
4. Test the affected GUI workflow on macOS or Windows when possible.
5. Open a pull request describing the user-visible change and any provider
   limitations you encountered.

Please avoid committing `node_modules`, downloaded media, credentials, or
provider cookies.

## Disclaimer

This project is a user interface and does not host video content. AniDB,
stream providers, and upstream ani-cli may have their own terms and regional
restrictions. No anime video content is bundled with this project. You are
responsible for using the software lawfully and for respecting copyright and
service terms in your location.
