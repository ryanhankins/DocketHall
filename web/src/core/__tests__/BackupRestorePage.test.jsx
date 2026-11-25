import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BackupRestorePage from '../BackupRestorePage.jsx';

const mockApi = vi.fn();
const mockShowToast = vi.fn();
const mockDownloadOffsiteSnapshot = vi.fn();

vi.mock('../api.js', () => ({
  api: (...args) => mockApi(...args),
  downloadBackupArchive: vi.fn(),
  downloadOffsiteSnapshot: (...args) => mockDownloadOffsiteSnapshot(...args),
}));

vi.mock('../toast.jsx', () => ({
  useToast: () => mockShowToast,
}));

describe('BackupRestorePage', () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockShowToast.mockReset();
    mockDownloadOffsiteSnapshot.mockReset();
  });

  it('loads City Launch Readiness Checklist cleanly on Launch & Demo Setup tab', async () => {
    mockApi.mockImplementation(async (path) => {
      if (path === '/api/backup/readiness') {
        return {
          ready_count: 2,
          total_count: 2,
          checks: [
            { id: 'admin_pw', label: 'Admin password changed', done: true, route: '/app/my-account' },
            { id: 'smtp', label: 'Email configured', done: true, route: '/app/integrations' },
          ],
        };
      }
      if (path === '/api/backup/policy') {
        return { enabled: false, retention_days: 30, prefix: 'backups/' };
      }
      return {};
    });

    render(<BackupRestorePage reminderDays={0} onRefreshBackupBanner={vi.fn()} onRestored={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Backup & Restore' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Launch & Demo Setup' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'City Launch Readiness Checklist' })).toBeInTheDocument();
      expect(screen.getByText('Admin password changed')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading readiness checks…')).not.toBeInTheDocument();
  });

  it('shows error feedback if readiness endpoint fails', async () => {
    mockApi.mockImplementation(async (path) => {
      if (path === '/api/backup/readiness') throw new Error('Database timeout');
      return {};
    });

    render(<BackupRestorePage reminderDays={0} onRefreshBackupBanner={vi.fn()} onRestored={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Launch & Demo Setup' }));

    await waitFor(() => {
      expect(screen.getByText(/Database timeout/i)).toBeInTheDocument();
    });
  });

  it('renders a Download button for each offsite snapshot', async () => {
    mockDownloadOffsiteSnapshot.mockResolvedValueOnce();
    mockApi.mockImplementation(async (path) => {
      if (path === '/api/backup/policy') {
        return {
          policy: { enabled: true, s3_prefix: 'backups/' },
          snapshots: [
            {
              object_key: 'backups/default/dockethall_backup_20261120_215018.zip',
              size_bytes: 2048,
              last_modified: '2026-11-20T21:50:18+00:00',
            },
          ],
        };
      }
      return {};
    });

    render(<BackupRestorePage reminderDays={0} onRefreshBackupBanner={vi.fn()} onRestored={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled Offsite (S3)' }));

    await waitFor(() => {
      expect(screen.getByText('backups/default/dockethall_backup_20261120_215018.zip')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => {
      expect(mockDownloadOffsiteSnapshot).toHaveBeenCalledWith(
        'backups/default/dockethall_backup_20261120_215018.zip',
        mockShowToast,
      );
    });
  });
});
