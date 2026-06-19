# cpr-music

CPR Music — a small Angular app that displays the currently playing track and recent playlist history from Colorado Public Radio (CPR).

Quick start

1. cd music-ui
2. npm install
3. npm start

Open http://localhost:4200 in your browser. The app auto-reloads on source changes.

Build

- cd music-ui
- npm run build

Tests

- cd music-ui
- npm test

Project layout

- music-ui/: Angular 21 UI app (source, tests, config)

Notes

- The frontend polls a CPR playlist JSON endpoint and embeds a live audio stream. The app measures stream lag to improve polling accuracy; see music-ui/README.md for architecture and implementation details.

License: See LICENSE

