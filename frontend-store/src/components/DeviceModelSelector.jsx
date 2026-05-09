import { useEffect, useId, useState } from 'react';
import { API_BASE_URL } from '../config';

export default function DeviceModelSelector({ value, onChange, required = false, compact = false }) {
  const listId = useId();
  const [models, setModels] = useState([]);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE_URL}/device-models`)
      .then((response) => response.ok ? response.json() : { data: [] })
      .then((result) => {
        if (!active) return;
        setModels(Array.isArray(result) ? result : (result.data || []));
      })
      .catch(() => {
        if (active) setModels([]);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className={compact ? 'w-full' : 'rounded-3xl border border-[var(--color-surface-high)] bg-[var(--color-surface-white)] p-5 shadow-lg backdrop-blur-md'}>
      <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-on-surface)]/70 mb-2">
        Select Your Device Model {required && <span className="text-red-500 font-bold">*</span>}
      </label>
      <div className="relative group">
        <input
          required={required}
          type="text"
          list={listId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search or type your device model"
          className="w-full rounded-2xl border border-[var(--color-surface-high)] bg-[var(--color-surface-white)] px-5 py-4 text-[14px] font-bold text-[var(--color-on-surface)] outline-none transition-all duration-300 focus:border-primary focus:ring-4 focus:ring-primary/5 placeholder:text-[var(--color-on-surface-variant)]/40 shadow-sm"
        />
        <datalist id={listId}>
          {models.map((model) => (
            <option
              key={model.id}
              value={model.name}
              label={[model.brand, model.type].filter(Boolean).join(' • ')}
            />
          ))}
        </datalist>
      </div>
    </div>
  );
}
