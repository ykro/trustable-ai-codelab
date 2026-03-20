import { Link } from 'react-router-dom';
import { ArrowRight, Radio, PlayCircle, BarChart3, Zap } from 'lucide-react';

export default function Landing() {
  return (
    <div className="landing">
      {/* Hero */}
      <section className="landing-hero">
        <div className="hero-badge">AI Motorsport Coaching</div>
        <h1 className="hero-title">
          Your corner coach,<br />in your ear.
        </h1>
        <p className="hero-subtitle">
          Koru connects to your GPS telemetry and delivers real-time driving
          advice — braking points, throttle commands, and line corrections —
          powered by Gemini.
        </p>
        <div className="hero-actions">
          <Link to="/dashboard" className="hero-cta">
            Open Dashboard <ArrowRight size={16} />
          </Link>
          <Link to="/live" className="hero-cta-secondary">
            Start Live Session
          </Link>
        </div>
      </section>

      {/* Architecture */}
      <section className="landing-section">
        <h2 className="section-title">Four coaching paths, one system</h2>
        <p className="section-subtitle">
          Every driving error needs a different response speed. Koru routes
          feedback through four paths depending on urgency.
        </p>
        <div className="arch-grid">
          <div className="arch-card">
            <div className="arch-num">01</div>
            <h3>Hot Path</h3>
            <p>
              Heuristic rules fire in under 50ms. Trail-brake reminders,
              throttle commands, and commit calls — no cloud round-trip.
            </p>
          </div>
          <div className="arch-card">
            <div className="arch-num">02</div>
            <h3>Cold Path</h3>
            <p>
              Gemini Flash or Pro analyzes multi-frame telemetry windows.
              Physics-based explanations with weight transfer and friction
              circle context.
            </p>
          </div>
          <div className="arch-card">
            <div className="arch-num">03</div>
            <h3>Feedforward</h3>
            <p>
              Geofence triggers fire 150 meters before each corner. You hear
              the advice before you need it, not after.
            </p>
          </div>
          <div className="arch-card">
            <div className="arch-num">04</div>
            <h3>Predictive</h3>
            <p>
              Mistake zones from previous laps are tracked. An 8-second
              lookahead alerts you before you repeat the same error.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="landing-section">
        <h2 className="section-title">How it works</h2>
        <div className="steps-grid">
          <div className="step-card">
            <Radio size={20} />
            <h4>Connect</h4>
            <p>Point Koru at your GPS telemetry SSE stream or upload a CSV from your datalogger</p>
          </div>
          <div className="step-card">
            <Zap size={20} />
            <h4>Drive</h4>
            <p>Get real-time coaching through 5 AI coach personas — each with a different style</p>
          </div>
          <div className="step-card">
            <PlayCircle size={20} />
            <h4>Replay</h4>
            <p>Scrub through your session frame-by-frame with synchronized telemetry charts</p>
          </div>
          <div className="step-card">
            <BarChart3 size={20} />
            <h4>Compare</h4>
            <p>Upload two laps side by side and let Gemini identify where you lost time</p>
          </div>
        </div>
      </section>

      {/* Coaches */}
      <section className="landing-section">
        <h2 className="section-title">Five coach personas</h2>
        <p className="section-subtitle">
          Switch between coaching styles mid-session. Each persona has a
          different system prompt and communication approach.
        </p>
        <div className="coaches-grid">
          {[
            { name: 'Tony', style: 'Motivational', desc: 'Short, punchy commands. "Commit! Trust the grip!"' },
            { name: 'Rachel', style: 'Technical', desc: 'Physics-focused. References friction circle and weight transfer.' },
            { name: 'AJ', style: 'Direct', desc: 'Blunt telemetry callouts. "Brake 5m later." No fluff.' },
            { name: 'Garmin', style: 'Data', desc: 'Pure numbers. Speed deltas, G readings, distance markers.' },
            { name: 'Super AJ', style: 'Adaptive', desc: 'Switches style per error type — safety, technique, or confidence.' },
          ].map(c => (
            <div key={c.name} className="coach-card">
              <div className="coach-card-name">{c.name}</div>
              <div className="coach-card-style">{c.style}</div>
              <p>{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <span>koru</span>
        <span>Built with Gemini</span>
      </footer>
    </div>
  );
}
