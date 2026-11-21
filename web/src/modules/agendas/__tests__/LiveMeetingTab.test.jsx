import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LiveMeetingTab from '../LiveMeetingTab.jsx';

const mockApi = vi.fn();

vi.mock('../../../core/api.js', () => ({
  api: (...args) => mockApi(...args),
}));

vi.mock('../../../core/toast.jsx', () => ({
  useToast: () => vi.fn(),
}));

describe('LiveMeetingTab', () => {
  const sampleAgenda = {
    id: 42,
    title: 'Regular City Council Meeting',
    items: [
      { id: 1, title: 'Call to Order', item_type: 'procedural', description: '' },
      { id: 2, title: 'Approve Consent Calendar', item_type: 'action', description: 'Routine items' },
    ],
  };

  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue([]);
  });

  it('renders current agenda item and advances to next item', async () => {
    render(<LiveMeetingTab agenda={sampleAgenda} onAgendaUpdated={vi.fn()} onSwitchTab={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Call to Order')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: /^Next Item/i });
    fireEvent.click(nextBtn);

    expect(screen.getByRole('heading', { name: /Approve Consent Calendar/i })).toBeInTheDocument();
  });

  it('renders 3-minute public comment speaker timer controls', async () => {
    render(<LiveMeetingTab agenda={sampleAgenda} onAgendaUpdated={vi.fn()} onSwitchTab={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('03:00')).toBeInTheDocument();
    });
  });
});
