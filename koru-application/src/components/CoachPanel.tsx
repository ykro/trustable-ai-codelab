import { useState } from 'react';
import { COACHES, DEFAULT_COACH } from '../utils/coachingKnowledge';
import { MessageCircle, Volume2, VolumeX } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface CoachMessage {
  id: string;
  path: 'hot' | 'cold' | 'feedforward';
  text: string;
  timestamp: number;
}

interface CoachPanelProps {
  messages: CoachMessage[];
  activeCoach: string;
  onCoachChange: (id: string) => void;
  audioEnabled: boolean;
  onAudioToggle: () => void;
}

export default function CoachPanel({
  messages,
  activeCoach,
  onCoachChange,
  audioEnabled,
  onAudioToggle,
}: CoachPanelProps) {
  const coach = COACHES[activeCoach] || COACHES[DEFAULT_COACH];

  return (
    <div className="coach-panel">
      {/* Coach selector */}
      <div className="coach-header">
        <div className="coach-info">
          <span className="coach-icon">{coach.icon}</span>
          <div>
            <h3 className="coach-name">{coach.name}</h3>
            <span className="coach-style">{coach.style}</span>
          </div>
        </div>

        <div className="coach-actions">
          <button className="icon-btn" onClick={onAudioToggle}>
            {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
        </div>
      </div>

      {/* Coach selector pills */}
      <div className="coach-selector">
        {Object.values(COACHES).map(c => (
          <button
            key={c.id}
            className={`coach-pill ${c.id === activeCoach ? 'active' : ''}`}
            onClick={() => onCoachChange(c.id)}
          >
            {c.icon} {c.name}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="coach-messages">
        {messages.length === 0 ? (
          <div className="coach-empty">
            <MessageCircle size={24} />
            <p>Waiting for telemetry data...</p>
          </div>
        ) : (
          messages.slice(-20).reverse().map(msg => (
            <div key={msg.id} className={`coach-msg coach-msg-${msg.path}`}>
              <div className="coach-msg-badge">{msg.path.toUpperCase()}</div>
              <div className="coach-msg-text">
                <ReactMarkdown>{msg.text}</ReactMarkdown>
              </div>
              <div className="coach-msg-time">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export type { CoachMessage };
