import { CHART_GROUP_TYPES, chartData, type ChartMeasure, type ChartType } from '@app/shared';
import { lazy, Suspense, useMemo } from 'react';
import { EmptyState, SelectField, Skeleton } from '../../components/ui';
import { useVisibleItems, type ViewProps } from './viewParts';

const ChartCanvas = lazy(() => import('./ChartCanvas'));

export function ChartView(p: ViewProps) {
  const { board, canEdit, config, onConfig, memberName } = p;
  const { visible } = useVisibleItems(p);
  const o = config.options;

  const groupCols = board.columns.filter((c) => CHART_GROUP_TYPES.includes(c.type));
  const valueCols = board.columns.filter((c) => c.type === 'numbers' || c.type === 'formula');
  const group = groupCols.find((c) => c.id === o.groupColumnId) ?? groupCols[0];
  const stack =
    o.chartType === 'stacked' ? (groupCols.find((c) => c.id === o.stackColumnId) ?? null) : null;
  const value = valueCols.find((c) => c.id === o.valueColumnId) ?? null;

  const data = useMemo(
    () =>
      group
        ? chartData({
            items: visible,
            group,
            stack,
            measure: o.measure,
            value,
            memberName,
          })
        : { points: [], stacks: [] },
    [visible, group, stack, o.measure, value, memberName],
  );

  if (!group) {
    return (
      <EmptyState
        title="Charts need a column to group by"
        body="Add a Status, Dropdown, People, Date or Checkbox column to the table, then come back."
      />
    );
  }
  const set = (patch: Partial<typeof o>) => onConfig({ options: { ...o, ...patch } });
  const measureLabel =
    o.measure === 'count' || !value
      ? 'Items'
      : `${o.measure === 'sum' ? 'Total' : 'Average'} ${value.title}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-2 sm:px-6">
        <SelectField
          label="Chart"
          value={o.chartType}
          disabled={!canEdit}
          onChange={(e) => set({ chartType: e.target.value as ChartType })}
        >
          <option value="bar">Bar</option>
          <option value="stacked">Stacked bar</option>
          <option value="pie">Pie</option>
          <option value="line">Line</option>
        </SelectField>
        <SelectField
          label="Group by"
          value={group.id}
          disabled={!canEdit}
          onChange={(e) => set({ groupColumnId: e.target.value })}
        >
          {groupCols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </SelectField>
        {o.chartType === 'stacked' && (
          <SelectField
            label="Stack by"
            value={stack?.id ?? ''}
            disabled={!canEdit}
            onChange={(e) => set({ stackColumnId: e.target.value || null })}
          >
            <option value="">(choose)</option>
            {groupCols
              .filter((c) => c.id !== group.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </SelectField>
        )}
        <SelectField
          label="Measure"
          value={o.measure}
          disabled={!canEdit}
          onChange={(e) => set({ measure: e.target.value as ChartMeasure })}
        >
          <option value="count">Count of items</option>
          <option value="sum" disabled={valueCols.length === 0}>
            Sum
          </option>
          <option value="avg" disabled={valueCols.length === 0}>
            Average
          </option>
        </SelectField>
        {o.measure !== 'count' && (
          <SelectField
            label="Of column"
            value={value?.id ?? ''}
            disabled={!canEdit}
            onChange={(e) => set({ valueColumnId: e.target.value || null })}
          >
            <option value="">(choose)</option>
            {valueCols.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectField>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:px-6">
        {data.points.length === 0 ? (
          <EmptyState title="Nothing to chart yet" body="No items match this view’s filters." />
        ) : (
          <>
            <div
              className="h-80 text-muted"
              role="img"
              aria-label={`${measureLabel} by ${group.title}`}
            >
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <ChartCanvas type={o.chartType} data={data} />
              </Suspense>
            </div>
            <table className="mt-4 w-full max-w-xl border-collapse text-sm">
              <caption className="sr-only">
                {measureLabel} by {group.title}
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="border-b border-border p-2 text-left text-xs font-bold text-muted"
                  >
                    {group.title}
                  </th>
                  <th
                    scope="col"
                    className="border-b border-border p-2 text-right text-xs font-bold text-muted"
                  >
                    {measureLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.points.map((pt) => (
                  <tr key={pt.key}>
                    <th scope="row" className="border-b border-border p-2 text-left font-normal">
                      {pt.key}
                    </th>
                    <td className="border-b border-border p-2 text-right tabular-nums">
                      {pt.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
