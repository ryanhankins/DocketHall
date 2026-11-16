/*
 * Copyright 2026 Ryan Hankins
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useToast } from './toast.jsx';

export function InlineEditable({
  value,
  placeholder = '',
  required = false,
  multiline = false,
  listId = '',
  title = 'Click to edit',
  className = '',
  as: Tag = 'span',
  style = {},
  onSave,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const inputRef = useRef(null);
  const doneRef = useRef(false);
  const showToast = useToast();

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (!multiline) inputRef.current.select();
    }
  }, [editing, multiline]);

  const startEdit = (e) => {
    e?.stopPropagation?.();
    doneRef.current = false;
    setDraft(value || '');
    setEditing(true);
  };

  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setEditing(false);
  };

  const commit = async () => {
    if (doneRef.current) return;
    const next = draft.trim();
    if (required && !next) { cancel(); return; }
    if (next === (value || '').trim()) { cancel(); return; }
    doneRef.current = true;
    setEditing(false);
    try {
      await onSave(next);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  if (editing) {
    const commonProps = {
      ref: inputRef,
      value: draft,
      onChange: (e) => setDraft(e.target.value),
      onBlur: commit,
      onClick: (e) => e.stopPropagation(),
      onKeyDown: (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        if (!multiline && e.key === 'Enter') { e.preventDefault(); commit(); }
        if (multiline && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      },
      style: { font: 'inherit', width: '100%', minWidth: '220px', padding: '.25rem .45rem' },
    };
    return multiline
      ? <textarea rows={2} {...commonProps} />
      : <input list={listId || undefined} {...commonProps} />;
  }

  const display = (value || '').trim();
  const emptyCls = !display && placeholder ? ' editable-empty' : '';
  return (
    <Tag
      className={`editable${emptyCls}${className ? ` ${className}` : ''}`}
      title={title}
      style={style}
      onClick={startEdit}
    >
      {display || placeholder}
    </Tag>
  );
}
