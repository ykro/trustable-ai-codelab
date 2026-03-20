import { Activity, Radio, PlayCircle, BarChart3, Zap, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { THUNDERHILL_EAST } from '../data/trackData';
import TrackMap from '../components/TrackMap';

export default function Dashboard() {
  const track = THUNDERHILL_EAST;

  return (
    <div className="page dashboard">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p className="page-subtitle">AI-powered motorsport coaching</p>
      </header>

      <div className="dashboard-grid">
        {/* Quick Actions */}
        <div className="card card-wide">
          <h2 className="card-title"><Zap size={14} /> Quick Start</h2>
          <div className="quick-actions">
            <Link to="/live" className="action-card action-live">
              <Radio size={24} />
              <h3>Live Session</h3>
              <p>Connect GPS and get real-time coaching</p>
            </Link>
            <Link to="/replay" className="action-card action-replay">
              <PlayCircle size={24} />
              <h3>Replay</h3>
              <p>Upload CSV telemetry for post-session analysis</p>
            </Link>
            <Link to="/analysis" className="action-card action-analysis">
              <BarChart3 size={24} />
              <h3>Analysis</h3>
              <p>Compare laps and find time with AI insights</p>
            </Link>
          </div>
        </div>

        {/* Track Info */}
        <div className="card">
          <h2 className="card-title"><Activity size={14} /> Current Track</h2>
          <div className="track-info">
            <div className="track-stat">
              <span className="stat-label">Track</span>
              <span className="stat-value">{track.name}</span>
            </div>
            <div className="track-stat">
              <span className="stat-label">Length</span>
              <span className="stat-value">{(track.length / 1609.34).toFixed(2)} mi</span>
            </div>
            <div className="track-stat">
              <span className="stat-label">Corners</span>
              <span className="stat-value">{track.corners.length}</span>
            </div>
            <div className="track-stat">
              <span className="stat-label">Sectors</span>
              <span className="stat-value">{track.sectors.length}</span>
            </div>
            <div className="track-stat">
              <span className="stat-label"><Trophy size={12} /> Record</span>
              <span className="stat-value">{formatLapTime(track.recordLap)}</span>
            </div>
          </div>
        </div>

        {/* Track Map */}
        <div className="card">
          <TrackMap track={track} />
        </div>

        {/* Features */}
        <div className="card card-wide">
          <h2 className="card-title">AI Coaching Architecture</h2>
          <div className="features-grid">
            <div className="feature">
              <span className="feature-icon">01</span>
              <h4>Hot Path</h4>
              <p>Heuristic rules for instant coaching commands under 50ms latency</p>
            </div>
            <div className="feature">
              <span className="feature-icon">02</span>
              <h4>Cold Path</h4>
              <p>Gemini Cloud analysis with physics-based explanations and detailed feedback</p>
            </div>
            <div className="feature">
              <span className="feature-icon">03</span>
              <h4>Feedforward</h4>
              <p>Geofence-triggered corner advice delivered as you approach each turn</p>
            </div>
            <div className="feature">
              <span className="feature-icon">04</span>
              <h4>Predictive</h4>
              <p>Mistake zone detection with 8-second lookahead alerts before problem areas</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatLapTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = (seconds % 60).toFixed(1);
  return `${min}:${sec.padStart(4, '0')}`;
}
