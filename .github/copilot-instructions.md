# Copilot Instructions for cpr-music

## Project Overview
CPR Music is an Angular 21 web application that displays currently playing music from Colorado Public Radio (CPR) and a history of recently played tracks. The app fetches playlist data from a CPR API endpoint and displays the current track with an embedded audio stream.

## Build, Test, and Lint Commands

Navigate to the `music-ui` directory first:

```bash
cd music-ui
```

### Development
- **Start dev server**: `npm start` (serves on http://localhost:4200)
- **Build for production**: `npm run build` (outputs to `dist/`)
- **Watch mode**: `npm run watch` (rebuilds on file changes)

### Testing & Quality
- **Run tests**: `npm test` (Vitest test runner)
- **Run e2e tests**: `ng e2e` (requires e2e framework setup)

### Code Scaffolding
Generate new components using Angular CLI:
```bash
ng generate component component-name
ng generate directive|pipe|service|class|interface|enum|module
```

## Architecture

### Data Flow
1. **Music Service** (`music.ts`): Injectable singleton that manages data fetching and state
   - Fetches playlist from `https://playlist.cprnetwork.org/won_plus3/KVOQ.json`
   - Maintains three BehaviorSubjects: `playlist`, `currentlyPlaying`, and `streamLagMs`
   - Polls the API on a smart schedule (waits until current track ends before next fetch)
   - Implements retry logic with exponential delay (5s intervals, max 5 retries)
   - Measures audio stream lag by comparing DOM audio element playback time against elapsed time
   - Automatically adjusts polling timer to account for stream lag

2. **App Component** (`app.ts`): Root component that subscribes to Music Service
   - Uses Angular signals for reactive state management
   - Feeds data to template for display

3. **Template** (`app.html`): Displays current track and list of recently played tracks
   - Uses new Angular control flow syntax (`@if`, `@for`)
   - Includes embedded audio player streaming from CPR

### Data Model
- **Playlist Interface** (`playlist.ts`): Represents a single track with extensive metadata
  - Key fields: `title`, `artist`, `album`, `schedule_id`
  - Timing: `date` (YYYY-MM-DD), `time` (HH:MM:SS), `runtime` (HH:MM:SS)
  - Additional fields for classical music: `conductor`, `composer`, `orchestra`, `soloists`

## Key Conventions

### Signal-Based State Management
- Use Angular signals for component state (modern reactive primitive)
- App component exposes state as signals: `tracklist()`, `currentlyPlaying()`
- Signals are read in templates as function calls

### Track Filtering Logic
The Music Service filters out:
- Interludes (tracks without `title` or `artist`)
- The currently playing track (not included in playlist history)
- Duplicate tracks (checked by `schedule_id`)

New tracks are only added to the playlist when a new "currently playing" track is detected.

### API Integration
- Uses Angular's `HttpClient` for requests
- Endpoints must return JSON array of Playlist objects
- Smart polling: timer is set to resume at track end time, not at fixed intervals
- Fallback retry delay: 5 seconds if track data is unavailable

### Component Organization
- Standalone components (modern Angular pattern, no NgModules)
- Use `CommonModule` for template directives like `*ngIf`, `*ngFor`
- New Angular control flow (`@if`, `@for`) preferred over `*ngIf`, `*ngFor`

### TypeScript Configuration
- Strict mode enabled with Angular compiler safety flags
- `strictTemplates` enabled for type-safe templates
- Target: ES2022, Module: preserve

### Stream Lag Detection
The Music Service automatically measures how far behind the audio stream is from the stated playlist timestamps:
- Attaches to the DOM `<audio>` element after page load
- Listens for `play` and `timeupdate` events to track playback progress
- Calculates lag as: `elapsed time since play event - actual audio element currentTime`
- Starts measuring after 5 seconds of playback for stability
- Exposes lag via `streamLagMs` BehaviorSubject, available as `app.streamLag` in templates
- Automatically applies lag compensation when scheduling next playlist poll (delays the fetch)
- Logs lag measurements to browser console for debugging

The lag is displayed in the navbar (e.g., "Stream lag: 45.2s") and helps optimize polling to avoid excessive API calls while stream catches up.

### Code Style
- Prettier configured with 100-char line width and single quotes
- Angular parser for HTML files
- Package manager: npm 11.8.0+
