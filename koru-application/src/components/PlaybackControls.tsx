import { Play, Pause, SkipBack, SkipForward, Gauge } from 'lucide-react';

interface PlaybackControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  currentFrame: number;
  totalFrames: number;
  onSeek: (frame: number) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  currentTime?: string;
}

const SPEED_OPTIONS = [0.1, 0.25, 0.5, 1, 2, 5, 10];

export default function PlaybackControls({
  isPlaying,
  onPlayPause,
  currentFrame,
  totalFrames,
  onSeek,
  speed,
  onSpeedChange,
  currentTime,
}: PlaybackControlsProps) {
  return (
    <div className="playback-controls">
      <div className="playback-buttons">
        <button className="icon-btn" onClick={() => onSeek(Math.max(0, currentFrame - 100))}>
          <SkipBack size={16} />
        </button>
        <button className="play-btn" onClick={onPlayPause}>
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button className="icon-btn" onClick={() => onSeek(Math.min(totalFrames - 1, currentFrame + 100))}>
          <SkipForward size={16} />
        </button>
      </div>

      <div className="playback-slider">
        <input
          type="range"
          min={0}
          max={totalFrames - 1}
          value={currentFrame}
          onChange={e => onSeek(parseInt(e.target.value, 10))}
          className="slider"
        />
        <div className="playback-info">
          <span>{currentTime || formatFrame(currentFrame, totalFrames)}</span>
          <span>{currentFrame + 1} / {totalFrames}</span>
        </div>
      </div>

      <div className="speed-selector">
        <Gauge size={14} />
        <select
          value={speed}
          onChange={e => onSpeedChange(parseFloat(e.target.value))}
          className="speed-select"
        >
          {SPEED_OPTIONS.map(s => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function formatFrame(current: number, total: number): string {
  const pct = total > 0 ? ((current / total) * 100).toFixed(1) : '0.0';
  return `${pct}%`;
}
