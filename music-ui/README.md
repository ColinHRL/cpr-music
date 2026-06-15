# music-ui

CPR Music UI — Angular 21 application that shows the currently playing track and a small history of recent tracks from Colorado Public Radio (CPR).

Development (Quick start)

1. cd music-ui
2. npm install
3. npm start

The dev server runs at http://localhost:4200 and supports live reload.

Available scripts

- npm start         — start dev server (ng serve)
- npm run build     — production build (dist/)
- npm run watch     — rebuild on changes (development)
- npm test          — run unit tests (Vitest)

Generating code

Use Angular CLI:

- ng generate component <name>
- ng generate service <name>

Architecture overview

- Music Service (music.ts)
  - Fetches playlist JSON from CPR (e.g., https://playlist.cprnetwork.org/won_plus3/KVOQ.json)
  - Maintains reactive state (playlist, currentlyPlaying, streamLagMs)
  - Smart polling: schedules the next fetch to align with track end times and compensates for measured stream lag
  - Retry logic with exponential backoff for transient failures

- App component
  - Subscribes to Music Service using Angular signals and displays current track + history
  - Exposes stream lag for debugging

Stream lag detection

- The app measures audio stream lag by comparing the DOM audio element's currentTime to expected elapsed time after playback begins. Measured lag is displayed in the UI and used to adjust polling.

Testing & tooling

- Unit tests run via npm test (Vitest)
- Prettier config is included in package.json

More

For development workflow, build commands, and CI details see the repository root README.md.


## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
