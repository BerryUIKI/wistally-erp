import type { ItemView } from '@wistally/contracts';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';
const labelClass = 'text-xs font-medium uppercase tracking-wide text-slate-500';

let nextKey = 1;

export interface StockLineDraft {
  readonly key: number;
  readonly itemId: string;
  readonly value: string;
}

export function newStockLine(): StockLineDraft {
  nextKey += 1;
  return { key: nextKey, itemId: '', value: '' };
}

export interface StockLinesEditorProps {
  readonly lines: readonly StockLineDraft[];
  readonly items: readonly ItemView[];
  readonly valueLabel: string;
  readonly valuePlaceholder: string;
  readonly onChange: (lines: StockLineDraft[]) => void;
}

export function StockLinesEditor({
  lines,
  items,
  valueLabel,
  valuePlaceholder,
  onChange,
}: StockLinesEditorProps) {
  const update = (index: number, changes: Partial<StockLineDraft>) => {
    onChange(lines.map((line, position) => (position === index ? { ...line, ...changes } : line)));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={labelClass}>Lines</span>
        <button
          type="button"
          onClick={() => onChange([...lines, newStockLine()])}
          className="text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Add line
        </button>
      </div>

      {lines.map((line, index) => (
        <div key={line.key} className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1 space-y-1">
            <span className={labelClass}>Item</span>
            <select
              aria-label={`Item ${index + 1}`}
              value={line.itemId}
              onChange={(event) => update(index, { itemId: event.target.value })}
              className={inputClass}
            >
              <option value="">Select an item</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="w-36 space-y-1">
            <span className={labelClass}>{valueLabel}</span>
            <input
              aria-label={`${valueLabel} ${index + 1}`}
              value={line.value}
              onChange={(event) => update(index, { value: event.target.value })}
              inputMode="decimal"
              placeholder={valuePlaceholder}
              className={`${inputClass} font-mono`}
            />
          </label>
          <button
            type="button"
            onClick={() => onChange(lines.filter((_, position) => position !== index))}
            disabled={lines.length === 1}
            className="pb-2 text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
