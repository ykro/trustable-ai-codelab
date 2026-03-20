import { NavLink } from 'react-router-dom';
import { Gauge, Radio, PlayCircle, BarChart3, Settings } from 'lucide-react';
import { useState } from 'react';

interface NavbarProps {
  apiKey: string | null;
  onApiKeyChange: (key: string) => void;
}

export default function Navbar({ apiKey, onApiKeyChange }: NavbarProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey || '');

  const links = [
    { to: '/dashboard', icon: Gauge, label: 'Dashboard' },
    { to: '/live', icon: Radio, label: 'Live' },
    { to: '/replay', icon: PlayCircle, label: 'Replay' },
    { to: '/analysis', icon: BarChart3, label: 'Analysis' },
  ];

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <span className="navbar-logo">●</span>
        <span className="navbar-title">koru</span>
      </div>

      <div className="navbar-links">
        {links.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) => `navbar-link ${isActive ? 'active' : ''}`}
          >
            <l.icon size={16} />
            <span>{l.label}</span>
          </NavLink>
        ))}
      </div>

      <div className="navbar-actions">
        <div className={`api-status ${apiKey ? 'connected' : 'disconnected'}`}>
          {apiKey ? '● Gemini' : '○ No Key'}
        </div>
        <button className="icon-btn" onClick={() => setShowSettings(!showSettings)}>
          <Settings size={18} />
        </button>

        {showSettings && (
          <div className="settings-dropdown">
            <label>Gemini API Key</label>
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="AIza..."
              className="settings-input"
            />
            <button
              className="settings-btn"
              onClick={() => { onApiKeyChange(keyInput); setShowSettings(false); }}
            >
              Save
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
