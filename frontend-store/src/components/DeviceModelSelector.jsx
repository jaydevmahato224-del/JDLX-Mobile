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
    <div className={compact ? 'mt-3 w-full max-w-md' : 'rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm'}>
      <label className="block text-[11px] font-black uppercase tracking-widest text-slate-500">
        Select Your Device Model {required && <span className="text-red-500">*</span>}
      </label>
      <input
        required={required}
        type="text"
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search or type your device model"
        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
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
  );
}
