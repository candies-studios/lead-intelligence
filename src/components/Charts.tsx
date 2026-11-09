import { Bar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export const PALETTE = ['#1f2f58', '#4262aa', '#6482c1', '#97acd8', '#0ea5e9', '#14b8a6', '#f59e0b', '#94a3b8'];
export type KV = { k: string; v: number };

export function HBar({ data, height = 260, labels }: { data: KV[]; height?: number; labels?: Record<string, string> }) {
  if (!data?.length) return <div className="h-[180px] flex items-center justify-center text-xs text-ink-faint">No data yet</div>;
  const rows = data.map(d => ({ name: labels?.[d.k] ?? d.k, value: d.v }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(height, rows.length * 30)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="#eef2f7" />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#f2f5fb' }} contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
        <Bar dataKey="value" fill="#293e74" radius={[0, 4, 4, 0]} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, labels }: { data: KV[]; labels?: Record<string, string> }) {
  if (!data?.length) return <div className="h-[180px] flex items-center justify-center text-xs text-ink-faint">No data yet</div>;
  const rows = data.map(d => ({ name: labels?.[d.k] ?? d.k, value: d.v }));
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="55%" height={190}>
        <PieChart><Pie data={rows} dataKey="value" innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none">
          {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie><Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} /></PieChart>
      </ResponsiveContainer>
      <ul className="space-y-1.5 text-xs flex-1">
        {rows.map((r, i) => <li key={r.name} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="text-ink-soft flex-1 truncate">{r.name}</span><span className="tabular-nums font-medium">{r.value}</span></li>)}
      </ul>
    </div>
  );
}

export function PipelineFunnel({ data }: { data: { name: string; value: number }[] }) {
  const rows = data.filter(d => d.value > 0);
  if (!rows.length) return <div className="h-[180px] flex items-center justify-center text-xs text-ink-faint">No pipeline yet</div>;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <FunnelChart><Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        <Funnel dataKey="value" data={rows.map((r, i) => ({ ...r, fill: PALETTE[i % PALETTE.length] }))} isAnimationActive={false}>
          <LabelList position="right" fill="#475569" stroke="none" dataKey="name" fontSize={11} />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}
