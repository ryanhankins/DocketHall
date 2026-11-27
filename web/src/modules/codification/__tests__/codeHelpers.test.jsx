import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StructuredCodeBody, parseStructuredCodeBody } from '../codeHelpers.jsx';

describe('StructuredCodeBody table rendering', () => {
  const sample = [
    '2. MINIMUM SETBACK REQUIREMENTS:',
    '',
    '| Lot Line or Land Boundary | Fences and Landscaping Barriers | Driveways & Walkways | All Other Structures |',
    '| --- | --- | --- | --- |',
    '| Municipal Street and County Road Front, Back, and Side Lot Line | 10 ft. | 0 | 30 ft. |',
    '| All Other Lot Lines | 0 ft. | 1 ft. | 10 ft. |',
  ].join('\n');

  it('parses markdown pipe tables into table blocks', () => {
    const blocks = parseStructuredCodeBody(sample);
    const tableBlock = blocks.find((b) => b.type === 'table');
    expect(tableBlock).toBeTruthy();
    expect(tableBlock.headers).toHaveLength(4);
    expect(tableBlock.rows).toHaveLength(2);
    expect(tableBlock.rows[0][3]).toBe('30 ft.');
  });

  it('renders an HTML table with headers and cells', () => {
    render(<StructuredCodeBody text={sample} sectionMap={new Map()} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Fences and Landscaping Barriers')).toBeInTheDocument();
    expect(screen.getByText('30 ft.')).toBeInTheDocument();
  });
});
