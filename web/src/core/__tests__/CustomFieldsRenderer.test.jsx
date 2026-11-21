import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CustomFieldsRenderer, { computeImperviousChange } from '../CustomFieldsRenderer.jsx';

describe('CustomFieldsRenderer', () => {
  it('computes impervious surface change cleanly', () => {
    expect(computeImperviousChange('1,000', '1,250')).toBe('250');
    expect(computeImperviousChange('10.5', '12.0')).toBe('1.5');
    expect(computeImperviousChange('', '100')).toBe('');
  });

  it('renders sections/fields and emits updated values unless readOnly', () => {
    const onChange = vi.fn();
    const fields = [
      { key: 'lot_size', label: 'Lot Size (sq ft)', type: 'text', section: 'Site Info' },
    ];

    const { rerender } = render(
      <CustomFieldsRenderer fields={fields} value={{ lot_size: '5000' }} onChange={onChange} />,
    );
    expect(screen.getByText('Site Info')).toBeInTheDocument();
    const input = screen.getByDisplayValue('5000');
    fireEvent.change(input, { target: { value: '6000' } });
    expect(onChange).toHaveBeenCalledWith({ lot_size: '6000' });

    onChange.mockReset();
    rerender(
      <CustomFieldsRenderer fields={fields} value={{ lot_size: '6000' }} onChange={onChange} readOnly />,
    );
    fireEvent.change(screen.getByDisplayValue('6000'), { target: { value: '7000' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
