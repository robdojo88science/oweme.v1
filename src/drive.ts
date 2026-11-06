import { captureBackup, inspectBackup, type BackupEnvelope } from './backup';
import { dataChanges, db, getChangeVersion, getDatasetGeneration, getSettings, saveSettings } from './db';

export interface DriveState {
  connected: boolean;
  pending: boolean;
  syncing: boolean;
  lastSuccess: string;
  error: string;
  account: string;
}
interface FileMetadata { id: string; name?: string; modifiedTime?: string; version?: string; trashed?: boolean }
interface TokenResponse { access_token?: string; expires_in?: number | string; error?: string; error_description?: string }
interface GoogleIdentity {
  accounts: { oauth2: {
    initTokenClient(config: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback: (error: { type?: string }) => void }): { requestAccessToken(options: { prompt: string }): void };
    revoke(token: string, callback?: () => void): void;
  } };
}
declare global { interface Window { google?: GoogleIdentity } }

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'OweMe-backup.json';
export const driveChanges = new EventTarget();
let accessToken = '';
let expiresAt = 0;
let autoTimer: ReturnType<typeof setTimeout> | undefined;
let scriptLoading: Promise<void> | null = null;
const requests = new Set<AbortController>();
const recoveryPreviews = new Map<string, string>();
const state: DriveState = { connected: false, pending: false, syncing: false, lastSuccess: '', error: '', account: '' };
const online = () => typeof navigator === 'undefined' || navigator.onLine;
const token = () => accessToken && expiresAt > Date.now() + 10_000 ? accessToken : '';
const emit = () => driveChanges.dispatchEvent(new Event('change'));

export function driveStatus(): DriveState {
  return { ...state, connected: Boolean(token()) };
}

export async function refreshDriveStatus() {
  const [settings, version, synced] = await Promise.all([getSettings(), getChangeVersion(), db.meta.get('driveSyncedVersion')]);
  state.pending = version > Number(synced?.value || 0);
  state.lastSuccess = settings.lastBackupAt;
  state.connected = Boolean(token());
  emit();
  return driveStatus();
}

async function loadIdentity() {
  if (window.google?.accounts.oauth2) return;
  if (!online()) throw new Error('Connect to the internet to authorize Google Drive. Your local records are already saved.');
  if (!scriptLoading) scriptLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-oweme-google]');
    const script = existing ?? document.createElement('script');
    const fail = (message: string) => { clearTimeout(timeout); script.remove(); reject(new Error(message)); };
    const timeout = setTimeout(() => fail('Google authorization could not load. Check your connection and try again.'), 15_000);
    script.onload = () => {
      if (!window.google?.accounts.oauth2) { fail('Google authorization did not initialize. Check browser privacy settings and try again.'); return; }
      clearTimeout(timeout); resolve();
    };
    script.onerror = () => fail('Google authorization is unavailable. Export a local backup instead.');
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true;
      script.dataset.owemeGoogle = 'true'; document.head.appendChild(script);
    }
  }).catch(error => { scriptLoading = null; throw error; });
  await scriptLoading;
}

export async function connectDrive(clientId: string): Promise<void> {
  if (!clientId.trim().endsWith('.apps.googleusercontent.com')) throw new Error('Enter your public Google OAuth web client ID in Advanced settings first.');
  await loadIdentity();
  const google = window.google;
  if (!google) throw new Error('Google authorization did not initialize. Try again.');
  await new Promise<void>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(), scope: 'https://www.googleapis.com/auth/drive.file',
      callback: response => {
        if (response.error || !response.access_token) { reject(new Error(response.error_description || 'Google authorization was not granted.')); return; }
        accessToken = response.access_token;
        expiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
        state.connected = true; state.error = ''; state.account = 'Google account connected'; emit(); resolve();
      },
      error_callback: error => reject(new Error(error.type === 'popup_closed' ? 'Google connection was cancelled. Local lending still works.' : 'Google sign-in could not open. Allow its sign-in popup and try again.')),
    });
    // Runs only after an owner’s deliberate Connect action. Tokens remain in memory.
    client.requestAccessToken({ prompt: 'consent' });
  });
  try {
    const about = await request(`${API}/about?fields=user(displayName,emailAddress)`);
    const result = await about.json() as { user?: { displayName?: string; emailAddress?: string } };
    state.account = result.user?.emailAddress || result.user?.displayName || state.account;
  } catch { /* Account label is optional; a failed label request is never reported as a backup. */ }
  await refreshDriveStatus();
  queueDriveBackup();
}

export function disconnectDrive() {
  const oldToken = accessToken;
  accessToken = ''; expiresAt = 0; state.connected = false; state.account = ''; state.error = '';
  if (autoTimer) clearTimeout(autoTimer);
  recoveryPreviews.clear();
  for (const controller of requests) controller.abort();
  if (oldToken && typeof window !== 'undefined' && window.google) window.google.accounts.oauth2.revoke(oldToken);
  emit();
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  if (!online()) throw new Error('Offline — changes are saved here. Drive backup will wait until this app is open and online.');
  const current = token();
  if (!current) { state.connected = false; throw new Error('Reconnect Google Drive to authorize this backup. Google access has expired.'); }
  const controller = new AbortController();
  requests.add(controller);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), Authorization: `Bearer ${current}` } });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Google backup was cancelled. Current local records were not marked as backed up.');
    throw error;
  } finally { requests.delete(controller); }
  if (response.status === 401) { accessToken = ''; expiresAt = 0; state.connected = false; throw new Error('Google authorization expired. Reconnect Drive; your local records are safe.'); }
  if (response.status === 412) throw new Error('Drive backup changed on another device. Download and review that copy before overwriting anything.');
  if (!response.ok) throw new Error(`Google Drive returned ${response.status}. No backup success was recorded. Try again or export locally.`);
  return response;
}

const revisionOf = (file: FileMetadata) => `${file.version || ''}|${file.modifiedTime || ''}`;
async function metadata(fileId: string) {
  const response = await request(`${API}/files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime,version,trashed`);
  const file = await response.json() as FileMetadata;
  if (file.trashed) throw new Error('Your Drive backup is in the trash. Recover it in Drive or choose a different recovery file.');
  if (!file.id || !file.version || !file.modifiedTime) throw new Error('Google did not provide a file revision. Backup was stopped to protect the existing copy.');
  return { file, etag: response.headers.get('ETag') || '' };
}

export async function uploadDriveBackup(): Promise<{ fileId: string; backedUpAt: string }> {
  if (state.syncing) throw new Error('A Drive backup is already in progress.');
  const leaseId = crypto.randomUUID();
  let leaseAcquired = false;
  let uploadedSuccessfully = false;
  state.syncing = true; state.error = ''; emit();
  try {
    if (!online()) throw new Error('Offline — saved locally. Keep OweMe open when online to finish backup.');
    if (!token()) throw new Error('Connect Google Drive before backing up. Your records are saved on this device.');
    await db.transaction('rw', db.meta, async () => {
      const current = (await db.meta.get('driveUploadLease'))?.value as { owner: string; expires: number } | undefined;
      if (current && current.expires > Date.now()) throw new Error('A backup is running in another OweMe window. Keep that window open and try again when it finishes.');
      await db.meta.put({ key: 'driveUploadLease', value: { owner: leaseId, expires: Date.now() + 600_000 } });
      leaseAcquired = true;
    });
    const settings = await getSettings();
    const capture = await captureBackup();
    const backup = capture.text;
    let file: FileMetadata;
    if (settings.driveFileId) {
      const remote = await metadata(settings.driveFileId);
      if (!settings.driveRevision || revisionOf(remote.file) !== settings.driveRevision) throw new Error('Drive contains a newer or unrecognized backup. Download and inspect it before replacing any local data.');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (remote.etag) headers['If-Match'] = remote.etag;
      const response = await request(`${UPLOAD}/files/${encodeURIComponent(settings.driveFileId)}?uploadType=media&fields=id,name,modifiedTime,version`, {
        method: 'PATCH', headers, body: backup,
      });
      file = await response.json() as FileMetadata;
      if (file.id !== settings.driveFileId) throw new Error('Google returned a different file. Backup status was not accepted.');
    } else {
      // Find an existing app-created backup before creating a file on a new device.
      const existing = await listDriveBackups();
      if (existing.length) throw new Error('An OweMe backup already exists in this Google account. Use Recover from Drive to inspect and select it before creating another backup.');
      const boundary = `oweme_${crypto.randomUUID()}`;
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: FILE_NAME, mimeType: 'application/json', appProperties: { app: 'oweme', schema: '1' } })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${backup}\r\n--${boundary}--`;
      const response = await request(`${UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime,version`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      });
      file = await response.json() as FileMetadata;
    }
    if (!file.id) throw new Error('Google did not return a backup file ID. No success was recorded.');
    // Fetch an authoritative revision if an upload response omitted revision fields.
    if (!file.version || !file.modifiedTime) file = (await metadata(file.id)).file;
    const backedUpAt = new Date().toISOString();
    await db.transaction('rw', [db.borrowers, db.loans, db.entries, db.attachments, db.audits, db.drafts, db.settings, db.meta], async () => {
      const lease = (await db.meta.get('driveUploadLease'))?.value as { owner: string } | undefined;
      if (capture.generation !== await getDatasetGeneration() || lease?.owner !== leaseId) throw new Error('The notebook changed through reset or restore during upload. Current local records were not marked as backed up.');
      await saveSettings({ driveFileId: file.id, driveRevision: revisionOf(file), lastBackupAt: backedUpAt }, { quiet: true });
      await db.meta.put({ key: 'driveSyncedVersion', value: capture.version });
    });
    state.lastSuccess = backedUpAt;
    await refreshDriveStatus();
    uploadedSuccessfully = true;
    return { fileId: file.id, backedUpAt };
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'Drive backup failed. Export locally and try again.';
    state.pending = true;
    throw error;
  } finally {
    if (leaseAcquired) await db.transaction('rw', db.meta, async () => {
      const lease = (await db.meta.get('driveUploadLease'))?.value as { owner: string } | undefined;
      if (lease?.owner === leaseId) await db.meta.delete('driveUploadLease');
    }).catch(() => { /* An expired lease can be recovered after a device-storage interruption. */ });
    state.syncing = false; emit();
    if (uploadedSuccessfully && state.pending) queueDriveBackup();
  }
}

export async function listDriveBackups(): Promise<FileMetadata[]> {
  const q = encodeURIComponent("trashed = false and (appProperties has { key='app' and value='oweme' } or name = 'OweMe-backup.json')");
  const response = await request(`${API}/files?q=${q}&fields=files(id,name,modifiedTime,version)&orderBy=modifiedTime%20desc&pageSize=100`);
  const result = await response.json() as { files?: FileMetadata[] };
  return result.files || [];
}

/** Downloads and validates a recovery copy. Does not alter local financial data. */
export async function downloadDriveBackup(fileId?: string): Promise<BackupEnvelope> {
  const chosen = fileId || (await getSettings()).driveFileId;
  if (!chosen) throw new Error('Choose a recovery file from your connected Drive account.');
  const before = await metadata(chosen);
  const response = await request(`${API}/files/${encodeURIComponent(chosen)}?alt=media`);
  const preview = await inspectBackup(await response.text());
  const after = await metadata(chosen);
  if (revisionOf(before.file) !== revisionOf(after.file)) throw new Error('The Drive file changed while downloading. Download the latest recovery copy again before restoring.');
  recoveryPreviews.set(chosen, revisionOf(after.file));
  return preview;
}

export const restoreDriveBackup = downloadDriveBackup;

/** Select only after preview/confirmation. Financial restore remains a separate confirmed operation. */
export async function adoptDriveFile(fileId: string) {
  const reviewedRevision = recoveryPreviews.get(fileId);
  if (!reviewedRevision) throw new Error('Download and review this Drive recovery copy before selecting it for future backups.');
  const remote = await metadata(fileId);
  if (revisionOf(remote.file) !== reviewedRevision) throw new Error('Local records were restored, but the Drive file changed after your preview. Download and review the latest Drive copy before backing up; the newer copy was not overwritten.');
  await saveSettings({ driveFileId: fileId, driveRevision: revisionOf(remote.file) }, { quiet: true });
  await refreshDriveStatus();
}

export function queueDriveBackup() {
  void refreshDriveStatus().catch(error => { state.error = error instanceof Error ? error.message : 'Local storage could not be read.'; emit(); });
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    if (state.pending && token() && online() && (typeof document === 'undefined' || document.visibilityState === 'visible')) void uploadDriveBackup().catch(() => { /* Status carries the actionable error. */ });
  }, 2500);
}

dataChanges.addEventListener('change', queueDriveBackup);
dataChanges.addEventListener('reset', disconnectDrive);
if (typeof window !== 'undefined') {
  window.addEventListener('online', queueDriveBackup);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') queueDriveBackup(); });
}

/** Explicit dependency boundary for deterministic tests; never persists authorization. */
export const driveTestSession = { set(tokenValue: string, expiresInSeconds = 3600) { accessToken = tokenValue; expiresAt = Date.now() + expiresInSeconds * 1000; } };
