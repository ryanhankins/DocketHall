import React from 'react';

export function computeImperviousChange(existingVal, proposedVal) {
  const e = parseFloat(String(existingVal || '').replace(/,/g, ''));
  const p = parseFloat(String(proposedVal || '').replace(/,/g, ''));
  if (!Number.isFinite(e) || !Number.isFinite(p)) return '';
  const diff = p - e;
  return Number.isInteger(diff) ? String(diff) : diff.toFixed(1);
}

export default function CustomFieldsRenderer({
  fields = [],
  value = {},
  onChange,
  readOnly = false,
}) {
  if (!Array.isArray(fields) || fields.length === 0) return null;

  const data = value && typeof value === 'object' ? value : {};

  // Group fields by section while preserving field order
  const sections = [];
  const sectionMap = new Map();
  for (const f of fields) {
    const sec = (f.section || 'Additional Application Details').trim();
    if (!sectionMap.has(sec)) {
      const bucket = { title: sec, items: [] };
      sectionMap.set(sec, bucket);
      sections.push(bucket);
    }
    sectionMap.get(sec).items.push(f);
  }

  function updateField(key, nextVal) {
    if (readOnly || !onChange) return;
    onChange({ ...data, [key]: nextVal });
  }

  return (
    <div className="space-y-5">
      {sections.map((sec) => (
        <div
          key={sec.title}
          className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4"
        >
          <div className="text-xs font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200 pb-1.5">
            {sec.title}
          </div>
          {sec.items.map((f) => {
            const key = f.key;
            const ftype = f.type || 'text';
            const fval = data[key];

            if (ftype === 'yes_no_explain') {
              const obj = fval && typeof fval === 'object' ? fval : { answer: '', explanation: '' };
              const answer = obj.answer || '';
              const explanation = obj.explanation || '';
              return (
                <div key={key} className="space-y-2 bg-white rounded-lg border border-slate-200 p-3">
                  <div className="text-sm font-medium text-slate-800">
                    {f.label}
                    {f.required && <span className="text-red-500 ml-1">*</span>}
                  </div>
                  {f.help_text && <p className="text-xs text-slate-500">{f.help_text}</p>}
                  <div className="flex items-center gap-3 pt-1">
                    {['yes', 'no'].map((opt) => (
                      <label
                        key={opt}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold cursor-pointer ${
                          answer === opt
                            ? 'border-civic-600 bg-civic-50 text-civic-800'
                            : 'border-slate-200 bg-white text-slate-600'
                        } ${readOnly ? 'opacity-80 cursor-default' : ''}`}
                      >
                        <input
                          type="radio"
                          name={`cf-${key}`}
                          value={opt}
                          disabled={readOnly}
                          checked={answer === opt}
                          onChange={() => updateField(key, { ...obj, answer: opt })}
                          className="accent-civic-600"
                        />
                        {opt === 'yes' ? 'Yes' : 'No'}
                      </label>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    readOnly={readOnly}
                    value={explanation}
                    onChange={(e) => updateField(key, { ...obj, explanation: e.target.value })}
                    placeholder="Why or why not? Provide details..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-civic-500/30 disabled:bg-slate-50"
                  />
                </div>
              );
            }

            if (ftype === 'impervious_table') {
              const rowLabels = Array.isArray(f.rows) && f.rows.length > 0
                ? f.rows
                : [
                    'Home Footprint',
                    'Garage',
                    'Deck / Porch / Patio',
                    'Driveway / Parking',
                    'Total Impervious Surface (sq ft)',
                  ];
              const tableVal = fval && typeof fval === 'object' ? fval : {};
              const updateCell = (rowName, col, cellVal) => {
                const prevRow = tableVal[rowName] && typeof tableVal[rowName] === 'object' ? tableVal[rowName] : {};
                const nextRow = { ...prevRow, [col]: cellVal };
                if (col === 'existing' || col === 'proposed') {
                  const auto = computeImperviousChange(
                    col === 'existing' ? cellVal : nextRow.existing,
                    col === 'proposed' ? cellVal : nextRow.proposed
                  );
                  if (auto !== '') nextRow.change = auto;
                }
                updateField(key, { ...tableVal, [rowName]: nextRow });
              };

              return (
                <div key={key} className="space-y-2 bg-white rounded-lg border border-slate-200 p-3">
                  <div className="text-sm font-medium text-slate-800">
                    {f.label}
                    {f.required && <span className="text-red-500 ml-1">*</span>}
                  </div>
                  {f.help_text && <p className="text-xs text-slate-500">{f.help_text}</p>}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700">
                          <th className="text-left px-2 py-1.5 border border-slate-200 font-semibold">Surface</th>
                          <th className="text-left px-2 py-1.5 border border-slate-200 font-semibold">Existing (sq ft)</th>
                          <th className="text-left px-2 py-1.5 border border-slate-200 font-semibold">Proposed (sq ft)</th>
                          <th className="text-left px-2 py-1.5 border border-slate-200 font-semibold">Change (sq ft)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowLabels.map((rname) => {
                          const rv = tableVal[rname] && typeof tableVal[rname] === 'object' ? tableVal[rname] : {};
                          return (
                            <tr key={rname} className="hover:bg-slate-50">
                              <td className="px-2 py-1 border border-slate-200 font-medium text-slate-700">
                                {rname}
                              </td>
                              {['existing', 'proposed', 'change'].map((col) => (
                                <td key={col} className="p-1 border border-slate-200">
                                  <input
                                    type="text"
                                    readOnly={readOnly}
                                    value={rv[col] || ''}
                                    onChange={(e) => updateCell(rname, col, e.target.value)}
                                    placeholder="—"
                                    className="w-full px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-civic-500/40"
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }

            if (ftype === 'textarea') {
              return (
                <div key={key} className="space-y-1">
                  <label className="block text-sm font-medium text-slate-800">
                    {f.label}
                    {f.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {f.help_text && <p className="text-xs text-slate-500">{f.help_text}</p>}
                  <textarea
                    rows={3}
                    readOnly={readOnly}
                    value={typeof fval === 'string' ? fval : ''}
                    onChange={(e) => updateField(key, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-civic-500/30"
                  />
                </div>
              );
            }

            return (
              <div key={key} className="space-y-1">
                <label className="block text-sm font-medium text-slate-800">
                  {f.label}
                  {f.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                {f.help_text && <p className="text-xs text-slate-500">{f.help_text}</p>}
                <input
                  type={ftype === 'number' ? 'number' : ftype === 'date' ? 'date' : 'text'}
                  readOnly={readOnly}
                  value={fval !== undefined && fval !== null ? String(fval) : ''}
                  onChange={(e) => updateField(key, e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-civic-500/30"
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
