import { Component, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { RouterOutlet } from "@angular/router";
import { Music } from "./music";
import { AudioPlayerComponent } from "./audio-player.component";
import { AppTrackListComponent } from "./app-track-list.component";

@Component({
  selector: "app-root",
  imports: [RouterOutlet, AudioPlayerComponent, AppTrackListComponent],
  templateUrl: "./app.html",
  styleUrls: ["./app.css"],
})
export class App {
  private musicService = inject(Music);
  currentlyPlaying = toSignal(this.musicService.currentlyPlaying, { requireSync: true });
}
