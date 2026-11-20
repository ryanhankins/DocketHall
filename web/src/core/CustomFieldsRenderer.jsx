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
    const sec = (f.section || 'Form Details').trim();
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {sections.map((sec) => (
        <div
          key={sec.title}
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            background: '#f8fafc',
            padding: '.85rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '.75rem',
          }}
        >
          <div style={{ fontSize: '.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#475569', borderBottom: '1px solid #e2e8f0', paddingBottom: '.35rem' }}>
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
                <div key={key} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.65rem', display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                  <div style={{ fontSize: '.9rem', fontWeight: 600 }}>
                    {f.label}
                    {f.required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
                  </div>
                  {f.help_text && <div className="muted" style={{ fontSize: '.8rem' }}>{f.help_text}</div>}
                  <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
                    {['yes', 'no'].map((opt) => (
                      <label key={opt} style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.86rem', cursor: readOnly ? 'default' : 'pointer' }}>
                        <input
                          type="radio"
                          style={{ width: 'auto', flexShrink: 0 }}
                          name={`cf-${key}`}
                          value={opt}
                          disabled={readOnly}
                          checked={answer === opt}
                          onChange={() => updateField(key, { ...obj, answer: opt })}
                        />
                        <span>{opt === 'yes' ? 'Yes' : 'No'}</span>
                      </label>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    readOnly={readOnly}
                    value={explanation}
                    onChange={(e) => updateField(key, { ...obj, explanation: e.target.value })}
                    placeholder="Why or why not? Provide details..."
                  />
                </div>
              );
            }

            if (ftype === 'radio') {
              const opts = Array.isArray(f.options) ? f.options : [];
              return (
                <div key={key} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.65rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                  <div style={{ fontSize: '.9rem', fontWeight: 600 }}>
                    {f.label}
                    {f.required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
                  </div>
                  {f.help_text && <div className="muted" style={{ fontSize: '.8rem' }}>{f.help_text}</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', marginTop: '.2rem' }}>
                    {opts.map((opt) => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '.45rem', fontSize: '.9rem', cursor: readOnly ? 'default' : 'pointer' }}>
                        <input
                          type="radio"
                          style={{ width: 'auto', flexShrink: 0 }}
                          name={`cf-${key}`}
                          value={opt}
                          disabled={readOnly}
                          checked={fval === opt}
                          onChange={() => updateField(key, opt)}
                        />
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            }

            if (ftype === 'select') {
              const opts = Array.isArray(f.options) ? f.options : [];
              return (
                <div key={key} className="field">
                  <label>
                    {f.label}
                    {f.required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
                  </label>
                  {f.help_text && <div className="muted" style={{ fontSize: '.8rem', marginBottom: 3 }}>{f.help_text}</div>}
                  <select
                    disabled={readOnly}
                    value={typeof fval === 'string' ? fval : ''}
                    onChange={(e) => updateField(key, e.target.value)}
                  >
                    <option value="">Select an option…</option>
                    {opts.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
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
                <div key={key} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.65rem' }}>
                  <div style={{ fontSize: '.9rem', fontWeight: 600, marginBottom: '.25rem' }}>
                    {f.label}
                    {f.required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
                  </div>
                  {f.help_text && <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.4rem' }}>{f.help_text}</div>}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ fontSize: '.82rem' }}>
                      <thead>
                        <tr>
                          <th>Surface</th>
                          <th>Existing (sq ft)</th>
                          <th>Proposed (sq ft)</th>
                          <th>Change (sq ft)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowLabels.map((rname) => {
                          const rv = tableVal[rname] && typeof tableVal[rname] === 'object' ? tableVal[rname] : {};
                          return (
                            <tr key={rname}>
                              <td><strong>{rname}</strong></td>
                              {['existing', 'proposed', 'change'].map((col) => (
                                <td key={col}>
                                  <input
                                    type="text"
                                    readOnly={readOnly}
                                    value={rv[col] || ''}
                                    onChange={(e) => updateCell(rname, col, e.target.value)}
                                    placeholder="—"
                                    style={{ fontSize: '.8rem', padding: '3px 6px' }}
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
                <div key={key} className="field">
                  <label>
                    {f.label}
                    {f.required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
                  </label>
                  {f.help_text && <div className="muted" style={{ fontSize: '.8rem', marginBottom: 3 }}>{f.help_text}</div>}
                  <textarea
                    rows={3}
                    readOnly={readOnly}
                    value={typeof fval === 'string' ? fval : ''}
                    onChange={(e) => updateField(key, e.target.value)}
                  />
                </div>
              );
            }

            return (
              <div key={key} className="field">
                <label>
                  {f.label}
                  {f.required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
                </label>
                {f.help_text && <div className="muted" style={{ fontSize: '.8rem', marginBottom: 3 }}>{f.help_text}</div>}
                <input
                  type={ftype === 'number' ? 'number' : ftype === 'date' ? 'date' : 'text'}
                  readOnly={readOnly}
                  value={fval !== undefined && fval !== null ? String(fval) : ''}
                  onChange={(e) => updateField(key, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
