import type { ChartData, ChartType } from '@app/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Distinct, colour-blind-friendly series colours (same in light and dark).
const COLORS = [
  '#5b4be1',
  '#e8833a',
  '#1f9d8b',
  '#d6457a',
  '#3d8bd9',
  '#b8a21f',
  '#8a5cc2',
  '#6a7a8c',
];
const color = (i: number) => COLORS[i % COLORS.length] as string;

/** Recharts lives here so the rest of the app doesn't pay for it (this file is lazy-loaded). */
export default function ChartCanvas({ type, data }: { type: ChartType; data: ChartData }) {
  const rows = data.points.map((p) => ({ name: p.key, total: p.total, ...p.parts }));
  const axis = { stroke: 'currentColor', fontSize: 12 };
  const tip = {
    contentStyle: {
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      color: 'var(--color-fg)',
    },
  };
  return (
    <ResponsiveContainer width="100%" height="100%">
      {type === 'pie' ? (
        <PieChart>
          <Pie data={rows} dataKey="total" nameKey="name" outerRadius="80%" label>
            {rows.map((_, i) => (
              <Cell key={i} fill={color(i)} />
            ))}
          </Pie>
          <Tooltip {...tip} />
          <Legend />
        </PieChart>
      ) : type === 'line' ? (
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="name" {...axis} />
          <YAxis allowDecimals {...axis} />
          <Tooltip {...tip} />
          <Line type="monotone" dataKey="total" stroke={color(0)} strokeWidth={2} dot />
        </LineChart>
      ) : (
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="name" {...axis} />
          <YAxis allowDecimals {...axis} />
          <Tooltip {...tip} />
          {type === 'stacked' && data.stacks.length > 0 ? (
            <>
              <Legend />
              {data.stacks.map((s, i) => (
                <Bar key={s} dataKey={s} stackId="a" fill={color(i)} />
              ))}
            </>
          ) : (
            <Bar dataKey="total" fill={color(0)} radius={[6, 6, 0, 0]} />
          )}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
