import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import type { TelemetryFrame } from '../types';

interface TelemetryChartsProps {
  frames: TelemetryFrame[];
  maxPoints?: number;
}

export default function TelemetryCharts({ frames, maxPoints = 200 }: TelemetryChartsProps) {
  const data = frames.slice(-maxPoints).map((f, i) => ({
    i,
    speed: Math.round(f.speed),
    throttle: Math.round(f.throttle),
    brake: Math.round(f.brake),
    gLat: Number(f.gLat.toFixed(2)),
    gLong: Number(f.gLong.toFixed(2)),
    gear: f.gear || 0,
  }));

  if (data.length === 0) {
    return <div className="chart-empty">No telemetry data</div>;
  }

  return (
    <div className="telemetry-charts">
      {/* Speed */}
      <div className="chart-card">
        <h4 className="chart-title">Speed (mph)</h4>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="i" hide />
            <YAxis domain={[0, 'auto']} width={35} tick={{ fill: '#64748b', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#1e1b4b', border: 'none', borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="speed" stroke="#6366f1" fill="url(#speedGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Throttle / Brake */}
      <div className="chart-card">
        <h4 className="chart-title">Throttle / Brake (%)</h4>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="throttleGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="brakeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="i" hide />
            <YAxis domain={[0, 100]} width={35} tick={{ fill: '#64748b', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#1e1b4b', border: 'none', borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="throttle" stroke="#22c55e" fill="url(#throttleGrad)" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="brake" stroke="#ef4444" fill="url(#brakeGrad)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* G-Forces */}
      <div className="chart-card">
        <h4 className="chart-title">G-Forces</h4>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data}>
            <XAxis dataKey="i" hide />
            <YAxis domain={[-2, 2]} width={35} tick={{ fill: '#64748b', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#1e1b4b', border: 'none', borderRadius: 8, fontSize: 12 }} />
            <Line type="monotone" dataKey="gLat" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Lateral" />
            <Line type="monotone" dataKey="gLong" stroke="#06b6d4" strokeWidth={1.5} dot={false} name="Longitudinal" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
