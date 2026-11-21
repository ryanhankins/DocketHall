import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FieldInspectorPage from '../FieldInspectorPage.jsx';

const mockApi = vi.fn();

vi.mock('../../../core/api.js', () => ({
  api: (...args) => mockApi(...args),
  todayIso: () => '2026-11-21',
}));

vi.mock('../../../core/toast.jsx', () => ({
  useToast: () => vi.fn(),
}));

describe('FieldInspectorPage', () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi.mockReset();
  });

  it('caches fetched inspections and renders offline queue status cleanly', async () => {
    mockApi.mockImplementation(async (path) => {
      if (path.includes('/permits/inspections/queue')) {
        return [
          {
            id: 101,
            permit_id: 55,
            permit_number: 'PRM-2026-0055',
            address: '123 Maple St',
            parcel_id: 'P-100',
            inspection_type: 'Framing',
            scheduled_date: '2026-11-21',
            result: 'scheduled',
          },
        ];
      }
      if (path.includes('/permits/parcels/map')) {
        return [];
      }
      return [];
    });

    render(<FieldInspectorPage />);

    await waitFor(() => {
      expect(screen.getByText(/Framing — PRM-2026-0055/i)).toBeInTheDocument();
    });
    expect(localStorage.getItem('dockethall_inspector_queue_cache_v1')).toBeTruthy();
  });
});
