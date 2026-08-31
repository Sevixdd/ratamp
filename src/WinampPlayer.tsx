import { useEffect, useState, type CSSProperties } from "react";
import { getSpotifyPlayer } from "./spotify/player";
import type { GenreTheme } from "./spotify/genre";
import type { SpotifyTrack } from "./spotify/types";
import { formatArtists } from "./spotify/api";

type Props = {
  theme: GenreTheme;
  track: SpotifyTrack | null;
  paused: boolean;
  position: number;
  duration: number;
  volume: number;
  onVolume: (value: number) => void;
  onDisconnect: () => void;
};

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function WinampPlayer({
  theme,
  track,
  paused,
  position,
  duration,
  volume,
  onVolume,
  onDisconnect,
}: Props) {
  const [seeking, setSeeking] = useState(position);
  const player = getSpotifyPlayer();

  useEffect(() => {
    setSeeking(position);
  }, [position]);

  const progress = duration > 0 ? Math.min(100, (seeking / duration) * 100) : 0;
  const title = track?.name ?? "No track";
  const artist = track ? formatArtists(track.artists) : "Pick a song";
  const genreText =
    theme.genres.slice(0, 2).join(" · ") || theme.label.toLowerCase();

  return (
    <div className="player-col">
      <div className="winamp-lcd">
        <div className="winamp-lcd-title">{title}</div>
        <div className="winamp-lcd-artist">{artist}</div>
        <div className="winamp-lcd-genre">{genreText}</div>
        <div className="winamp-time">
          {formatTime(seeking)} / {formatTime(duration)}
        </div>
      </div>

      <input
        className="winamp-seek"
        type="range"
        min={0}
        max={duration || 1}
        value={seeking}
        disabled={!duration}
        onChange={(event) => setSeeking(Number(event.target.value))}
        onMouseUp={() => player?.seek(seeking)}
        style={{ "--progress": `${progress}%` } as CSSProperties}
      />

      <div className="winamp-controls">
        <button
          type="button"
          title="Previous"
          onClick={() => player?.previousTrack()}
        >
          ⏮
        </button>
        <button
          type="button"
          className="winamp-play"
          title={paused ? "Play" : "Pause"}
          onClick={() => (paused ? player?.resume() : player?.pause())}
        >
          {paused ? "▶" : "❚❚"}
        </button>
        <button type="button" title="Next" onClick={() => player?.nextTrack()}>
          ⏭
        </button>
      </div>

      <label className="winamp-volume">
        <span>VOL</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => onVolume(Number(event.target.value))}
        />
      </label>

      <button className="winamp-disconnect" type="button" onClick={onDisconnect}>
        Disconnect
      </button>
    </div>
  );
}
