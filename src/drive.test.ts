import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addBorrower, clearData, db, getChangeVersion, getSettings, saveSettings } from './db';
import { adoptDriveFile, disconnectDrive, downloadDriveBackup, driveStatus, driveTestSession, listDriveBackups, refreshDriveStatus, uploadDriveBackup } from './drive';
import { exportBackup } from './backup';

const json = (value: unknown, options: ResponseInit = {}) => new Response(JSON.stringify(value), { status: 200, ...options });

beforeEach(async () => {
  disconnectDrive();
  await clearData();
  vi.stubGlobal('navigator', { onLine: true });
  driveTestSession.set('test-memory-token');
  await refreshDriveStatus();
});
afterEach(() => { disconnectDrive(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('real Drive backup protocol with mocked network', () => {
  it('creates one named file then PATCHes that exact file ID', async () => {
    await addBorrower({ name: 'Private borrower' });
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ id: 'same-file', name: 'OweMe-backup.json', version: '1', modifiedTime: '2026-01-01T00:00:00Z' }))
      .mockResolvedValueOnce(json({ id: 'same-file', version: '1', modifiedTime: '2026-01-01T00:00:00Z' }, { headers: { ETag: 'remote-1' } }))
      .mockResolvedValueOnce(json({ id: 'same-file', version: '2', modifiedTime: '2026-01-02T00:00:00Z' }));
    vi.stubGlobal('fetch', mockFetch);
    const created = await uploadDriveBackup();
    expect(created.fileId).toBe('same-file');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
    expect(mockFetch.mock.calls[1][1].body).toContain('OweMe-backup.json');
    expect((await getSettings()).driveFileId).toBe('same-file');
    expect(driveStatus().pending).toBe(false);
    await addBorrower({ name: 'Next change' });
    await uploadDriveBackup();
    expect(mockFetch.mock.calls[3][0]).toContain('/files/same-file?uploadType=media');
    expect(mockFetch.mock.calls[3][1].method).toBe('PATCH');
    expect(new Headers(mockFetch.mock.calls[3][1].headers).get('If-Match')).toBe('remote-1');
    expect(new Headers(mockFetch.mock.calls[3][1].headers).get('Authorization')).toBe('Bearer test-memory-token');
    expect((await getSettings()).driveRevision).toBe('2|2026-01-02T00:00:00Z');
  });

  it('keeps offline changes pending and never reports a successful upload', async () => {
    await addBorrower({ name: 'Offline change' });
    vi.stubGlobal('navigator', { onLine: false });
    const mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch);
    await expect(uploadDriveBackup()).rejects.toThrow(/Offline/);
    expect(mockFetch).not.toHaveBeenCalled(); expect(driveStatus().pending).toBe(true);
    expect((await getSettings()).lastBackupAt).toBe('');
  });

  it('requires reconnect after expiry and 401, with no false success', async () => {
    driveTestSession.set('expired', -1);
    const mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch);
    await expect(uploadDriveBackup()).rejects.toThrow(/Connect Google Drive/);
    expect(mockFetch).not.toHaveBeenCalled();
    driveTestSession.set('will-expire');
    mockFetch.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(uploadDriveBackup()).rejects.toThrow(/expired/);
    expect(driveStatus().connected).toBe(false);
    expect((await getSettings()).lastBackupAt).toBe('');
  });

  it('stops before PATCH when a newer remote version exists', async () => {
    await saveSettings({ driveFileId: 'existing', driveRevision: '1|2026-01-01T00:00:00Z' }, { quiet: true });
    const mockFetch = vi.fn().mockResolvedValueOnce(json({ id: 'existing', version: '2', modifiedTime: '2026-01-02T00:00:00Z' }));
    vi.stubGlobal('fetch', mockFetch);
    await expect(uploadDriveBackup()).rejects.toThrow(/newer or unrecognized/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect((await getSettings()).lastBackupAt).toBe('');
  });

  it('reports a conditional-write conflict instead of success', async () => {
    await saveSettings({ driveFileId: 'existing', driveRevision: '1|2026-01-01T00:00:00Z' }, { quiet: true });
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(json({ id: 'existing', version: '1', modifiedTime: '2026-01-01T00:00:00Z' }, { headers: { ETag: 'old' } }))
      .mockResolvedValueOnce(new Response('', { status: 412 }));
    vi.stubGlobal('fetch', mockFetch);
    await expect(uploadDriveBackup()).rejects.toThrow(/another device/);
    expect((await getSettings()).lastBackupAt).toBe('');
  });

  it('offers existing app backups for recovery and never duplicates them on a new device', async () => {
    const files = [{ id: 'previous', name: 'OweMe-backup.json', version: '3', modifiedTime: '2026-01-01T00:00:00Z' }];
    const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(json({ files }))); vi.stubGlobal('fetch', mockFetch);
    expect(await listDriveBackups()).toEqual(files);
    await expect(uploadDriveBackup()).rejects.toThrow(/already exists/);
    expect(mockFetch.mock.calls.every(call => !call[1]?.method)).toBe(true);
    expect((await getSettings()).driveFileId).toBe('');
  });

  it('downloads a verified recovery preview without changing records, then explicitly adopts the chosen file', async () => {
    await addBorrower({ name: 'Recovery borrower' });
    const backup = await exportBackup();
    await clearData();
    expect(driveStatus().connected).toBe(false);
    // A local reset deliberately revokes the old in-memory authorization.
    driveTestSession.set('reauthorized-for-recovery');
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(json({ id: 'recover', version: '3', modifiedTime: '2026-01-01T00:00:00Z' }))
      .mockResolvedValueOnce(new Response(backup, { status: 200 }))
      .mockResolvedValueOnce(json({ id: 'recover', version: '3', modifiedTime: '2026-01-01T00:00:00Z' }))
      .mockResolvedValueOnce(json({ id: 'recover', version: '3', modifiedTime: '2026-01-01T00:00:00Z' }));
    vi.stubGlobal('fetch', mockFetch);
    const preview = await downloadDriveBackup('recover');
    expect(preview.data.borrowers[0].name).toBe('Recovery borrower');
    expect((await getSettings()).driveFileId).toBe('');
    await adoptDriveFile('recover');
    expect((await getSettings()).driveFileId).toBe('recover');
  });

  it('refuses to adopt a newer remote file that changed after the recovery preview', async () => {
    const backup = await exportBackup();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(json({ id: 'recover', version: '3', modifiedTime: '2026-01-01T00:00:00Z' }))
      .mockResolvedValueOnce(new Response(backup, { status: 200 }))
      .mockResolvedValueOnce(json({ id: 'recover', version: '3', modifiedTime: '2026-01-01T00:00:00Z' }))
      .mockResolvedValueOnce(json({ id: 'recover', version: '4', modifiedTime: '2026-01-02T00:00:00Z' }));
    vi.stubGlobal('fetch', mockFetch);
    await downloadDriveBackup('recover');
    await expect(adoptDriveFile('recover')).rejects.toThrow(/changed after your preview/);
    expect((await getSettings()).driveFileId).toBe('');
    expect((await getSettings()).driveRevision).toBe('');
  });

  it('keeps a change made during upload pending against the exact captured version', async () => {
    await addBorrower({ name: 'Before upload' });
    const capturedVersion = await getChangeVersion();
    let finishUpload!: (response: Response) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(json({ files: [] }))
      .mockImplementationOnce(() => { signalStarted(); return new Promise<Response>(resolve => { finishUpload = resolve; }); });
    vi.stubGlobal('fetch', mockFetch);
    const upload = uploadDriveBackup();
    await started;
    await addBorrower({ name: 'Change during upload' });
    finishUpload(json({ id: 'versioned', version: '1', modifiedTime: '2026-01-01T00:00:00Z' }));
    await upload;
    expect((await db.meta.get('driveSyncedVersion'))?.value).toBe(capturedVersion);
    expect(await getChangeVersion()).toBeGreaterThan(capturedVersion);
    expect(driveStatus().pending).toBe(true);
    expect(mockFetch.mock.calls[1][1].body).not.toContain('Change during upload');
  });

  it('blocks a reset while any window owns an upload lease and disconnects after a completed reset', async () => {
    await addBorrower({ name: 'Preserve this record' });
    await db.meta.put({ key: 'driveUploadLease', value: { owner: 'other-window', expires: Date.now() + 60000 } });
    await expect(clearData(await getChangeVersion())).rejects.toThrow(/another window/);
    expect(await db.borrowers.count()).toBe(1);
    expect(driveStatus().connected).toBe(true);
    await db.meta.delete('driveUploadLease');
    await clearData(await getChangeVersion());
    expect(driveStatus().connected).toBe(false);
    expect((await getSettings()).lastBackupAt).toBe('');
  });

  it('never marks a replaced dataset as backed up by an earlier in-flight snapshot', async () => {
    await addBorrower({ name: 'Old dataset' });
    let finishUpload!: (response: Response) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(json({ files: [] }))
      .mockImplementationOnce(() => { signalStarted(); return new Promise<Response>(resolve => { finishUpload = resolve; }); });
    vi.stubGlobal('fetch', mockFetch);
    const upload = uploadDriveBackup();
    await started;
    await db.meta.put({ key: 'datasetGeneration', value: 'different-dataset' });
    finishUpload(json({ id: 'old-backup', version: '1', modifiedTime: '2026-01-01T00:00:00Z' }));
    await expect(upload).rejects.toThrow(/reset or restore/);
    expect((await getSettings()).lastBackupAt).toBe('');
    expect(await db.meta.get('driveSyncedVersion')).toBeUndefined();
  });
});
