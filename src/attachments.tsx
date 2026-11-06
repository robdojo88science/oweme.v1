import { useEffect, useRef, useState } from 'react';
import { Camera, Crop, Download, FileText, ImagePlus, RotateCw, ScanLine } from 'lucide-react';
import type { Attachment } from './domain';
import { addAttachment } from './db';
import { DateText, ErrorMessage, Field, Modal, message, useData } from './ui';

const bytesFromUrl = (data: string) => Math.floor((data.length - data.indexOf(',') - 1) * 0.75);
const sizeLabel = (bytes: number) => bytes < 1_000_000 ? `${Math.ceil(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
const readFile = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('This file could not be read. Please choose it again.'));
  reader.readAsDataURL(file);
});

/** Ordinary in-browser image editing, with no network or third-party upload. */
async function prepareImage(data: string, rotation: number, crop: boolean): Promise<string> {
  const source = new Image();
  source.src = data;
  try { await source.decode(); } catch { throw new Error('This image format cannot be opened here. Try a JPEG or PNG photo, or upload a PDF scan.'); }
  const width = crop ? Math.min(source.naturalWidth, source.naturalHeight) : source.naturalWidth;
  const height = crop ? width : source.naturalHeight;
  if (!width || !height) throw new Error('The image is empty or damaged. Choose another scan.');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const swap = rotation % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((swap ? height : width) * scale));
  canvas.height = Math.max(1, Math.round((swap ? width : height) * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image processing is not available. Upload a PDF instead.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2); context.rotate(rotation * Math.PI / 180);
  context.drawImage(source, (source.naturalWidth - width) / 2, (source.naturalHeight - height) / 2, width, height, -width * scale / 2, -height * scale / 2, width * scale, height * scale);
  return canvas.toDataURL('image/jpeg', 0.84);
}

export function AttachmentGallery({ borrowerId, loanId }: { borrowerId: string; loanId?: string }) {
  const data = useData();
  const loans = data.loans.filter(loan => loan.borrowerId === borrowerId);
  const items = data.attachments.filter(file => file.borrowerId === borrowerId && (!loanId || file.loanId === loanId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const upload = useRef<HTMLInputElement>(null); const camera = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [selectedLoan, setSelectedLoan] = useState(loanId || (loans.length === 1 ? loans[0].id : ''));
  const [fileName, setFileName] = useState(''); const [source, setSource] = useState(''); const [processed, setProcessed] = useState('');
  const [type, setType] = useState(''); const [rotation, setRotation] = useState(0); const [crop, setCrop] = useState(false);
  const [category, setCategory] = useState<NonNullable<Attachment['category']> | ''>('');
  const [revisionOf, setRevisionOf] = useState(''); const [preview, setPreview] = useState<Attachment | null>(null);
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false); const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => { navigator.storage?.estimate?.().then(result => setStorage({ usage: result.usage || 0, quota: result.quota || 0 })).catch(() => {}); }, [items.length]);
  useEffect(() => {
    if (!source) { setProcessed(''); return; }
    if (type === 'application/pdf') { setProcessed(source); setProcessing(false); return; }
    let cancelled = false; setProcessing(true); setProcessed('');
    prepareImage(source, rotation, crop).then(result => { if (!cancelled) setProcessed(result); }).catch(reason => { if (!cancelled) setError(message(reason)); }).finally(() => { if (!cancelled) setProcessing(false); });
    return () => { cancelled = true; };
  }, [source, type, rotation, crop]);

  const reset = () => { if (busyRef.current) return; setSource(''); setProcessed(''); setRevisionOf(''); setCategory(''); setRotation(0); setCrop(false); setError(''); setProcessing(false); };
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(''); setSuccess('');
    try {
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') throw new Error('Choose a photo or PDF scan. Other file types cannot be attached.');
      if (file.size > 20_000_000) throw new Error('This file is larger than 20 MB. Choose a smaller scan. Photos are compressed after opening.');
      setFileName(file.type === 'application/pdf' ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg');
      setType(file.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg');
      setRotation(0); setCrop(false); setSource(await readFile(file));
    } catch (reason) { setError(message(reason)); }
    finally { if (upload.current) upload.current.value = ''; if (camera.current) camera.current.value = ''; }
  };
  const save = async () => {
    if (busyRef.current) return;
    setError('');
    if (!selectedLoan || !loans.some(loan => loan.id === selectedLoan)) { setError('Choose the exact loan this document belongs to.'); return; }
    if (!fileName.trim()) { setError('Give this document a name.'); return; }
    if (!category) { setError('Choose whether this is a signed agreement, payment proof or another document.'); return; }
    if (!processed) { setError('Wait for the document preview to finish.'); return; }
    if (storage?.quota && storage.quota - storage.usage < bytesFromUrl(processed) * 1.5) { setError('There may not be enough browser storage. Export a backup and choose a smaller scan.'); return; }
    busyRef.current = true; setSaving(true);
    try {
      await addAttachment({ borrowerId, loanId: selectedLoan, name: fileName.trim(), type, data: processed, category, ...(revisionOf ? { revisionOf } : {}) });
      busyRef.current = false; reset(); setSuccess('Document saved on this device. Include it in your next backup.');
    } catch (reason) {
      const text = message(reason); setError(/quota|disk|storage/i.test(text) ? 'The device could not save this document. Export a backup and free storage, or try a smaller scan.' : text);
    } finally { busyRef.current = false; setSaving(false); }
  };

  if (!loans.length) return <div className="card"><FileText size={24} aria-hidden="true"/><h3>No loan documents yet</h3><p className="muted">Create a loan first, then attach its signed agreement, payment proof or scanned pages here.</p></div>;

  return <section aria-label="Loan documents">
    <div className="card">
      <h3>Signed papers &amp; proof</h3><p className="muted">Keep the signed paper. Add a private photo or PDF to its exact loan.</p>
      {!loanId && <Field label="Document belongs to"><select aria-label="Document belongs to loan" value={selectedLoan} onChange={event => setSelectedLoan(event.target.value)}><option value="">Choose a loan</option>{loans.map(loan => <option key={loan.id} value={loan.id}>{loan.ref} · {loan.issuedOn}</option>)}</select></Field>}
      <div className="button-row">
        <button type="button" className="button secondary" onClick={() => { setRevisionOf(''); setCategory(''); camera.current?.click(); }}><Camera size={17}/> Take photo</button>
        <button type="button" className="button secondary" onClick={() => { setRevisionOf(''); setCategory(''); upload.current?.click(); }}><ImagePlus size={17}/> Upload scan</button>
      </div>
      <input ref={upload} hidden type="file" accept="image/*,application/pdf" aria-label="Upload a loan document" onChange={event => void choose(event.target.files?.[0])}/>
      <input ref={camera} hidden type="file" accept="image/*" capture="environment" aria-label="Photograph a signed loan document" onChange={event => void choose(event.target.files?.[0])}/>
      <small className="muted">Up to 20 MB per source file. Images are compressed on this device; PDFs keep their original pages.</small>
      {storage && storage.quota > 0 && <p className="muted"><small>Browser storage: {sizeLabel(storage.usage)} used of approximately {sizeLabel(storage.quota)}. Keep an external backup.</small></p>}
      {!source && <ErrorMessage message={error}/>}{success && <p className="notice" role="status">{success}</p>}
    </div>
    {items.length > 0 && <div className="card" style={{ marginTop: 16 }}>{items.map(file => <div key={file.id} className="list-row" style={{ flexWrap: 'wrap' }}>
      <button type="button" className="text-button" onClick={() => setPreview(file)} style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
        <FileText size={18}/><span style={{ overflowWrap: 'anywhere' }}><strong>{file.name}</strong><small className="muted" style={{ display: 'block' }}>{file.category === 'agreement' ? 'Signed agreement' : file.category === 'proof' ? 'Payment proof' : 'Other document'} · {data.loans.find(loan => loan.id === file.loanId)?.ref} · <DateText date={file.createdAt.slice(0, 10)}/>{file.revisionOf ? ' · revised scan' : ''}</small></span>
      </button>
      <button type="button" className="text-button" aria-label={`Add a revised scan of ${file.name}`} onClick={() => { setSelectedLoan(file.loanId); setRevisionOf(file.id); setCategory(file.category || 'other'); upload.current?.click(); }}><ScanLine size={16}/> New scan</button>
    </div>)}</div>}
    {!items.length && <p className="muted">No scans attached yet. A generated agreement is not a signed agreement.</p>}
    {source && <Modal title={revisionOf ? 'Review revised scan' : 'Review document'} onClose={reset} wide>
      <Field label="Document name"><input aria-label="Document name" value={fileName} onChange={event => setFileName(event.target.value)} maxLength={200}/></Field>
      <Field label="What is this document?" hint="Choose signed agreement only after the paper has been signed."><select aria-label="Document type" value={category} onChange={event => setCategory(event.target.value as NonNullable<Attachment['category']> | '')}><option value="">Choose document type</option><option value="agreement">Signed loan agreement</option><option value="proof">Payment proof</option><option value="other">Other document</option></select></Field>
      <Field label="Loan"><select aria-label="Attach document to loan" value={selectedLoan} disabled={Boolean(loanId || revisionOf)} onChange={event => setSelectedLoan(event.target.value)}><option value="">Choose a loan</option>{loans.map(loan => <option key={loan.id} value={loan.id}>{loan.ref}</option>)}</select></Field>
      {type !== 'application/pdf' && <div className="button-row"><button type="button" className="button secondary" onClick={() => setRotation((rotation + 90) % 360)}><RotateCw size={16}/> Rotate</button><button type="button" className="button secondary" aria-pressed={crop} onClick={() => setCrop(!crop)}><Crop size={16}/>{crop ? 'Show full photo' : 'Center square crop'}</button></div>}
      <p className="muted"><small>Check that all text, amounts and signatures remain visible before saving.{revisionOf ? ' The earlier scan stays in history.' : ''}</small></p>
      {type === 'application/pdf' ? <iframe title="PDF document preview" src={source} style={{ width: '100%', height: 360, border: '1px solid #e4e1ef', borderRadius: 12 }}/> : processed ? <img alt="Document preview after rotation and crop" src={processed} style={{ display: 'block', maxWidth: '100%', maxHeight: 400, objectFit: 'contain', margin: '12px auto' }}/> : <p role="status">Preparing private preview…</p>}
      {processed && <p className="muted"><small>Stored file: {sizeLabel(bytesFromUrl(processed))}. {type === 'application/pdf' ? 'If preview is unavailable, open the file below to review it.' : 'Compressed JPEG, up to 1600 pixels on the longest side.'}</small></p>}
      {type === 'application/pdf' && <a className="text-button" href={source} download={fileName}>Open/download PDF for review</a>}
      <ErrorMessage message={error}/><div className="button-row"><button type="button" className="button secondary" disabled={saving} onClick={reset}>Cancel</button><button type="button" className="button primary" disabled={saving || processing || !processed || !selectedLoan || !category} onClick={() => void save()}>{saving ? 'Saving…' : 'Save document'}</button></div>
    </Modal>}
    {preview && <Modal title={preview.name} onClose={() => setPreview(null)} wide>
      <p className="muted">{data.loans.find(loan => loan.id === preview.loanId)?.ref} · Added {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(preview.createdAt))}</p>
      {preview.type === 'application/pdf' ? <iframe title={`Preview of ${preview.name}`} src={preview.data} style={{ width: '100%', height: 450, border: 0 }}/> : <img alt={preview.name} src={preview.data} style={{ display: 'block', maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', margin: 'auto' }}/>}
      <div className="button-row"><a className="button secondary" href={preview.data} download={preview.name}><Download size={16}/> Download</a><button type="button" className="button primary" onClick={() => setPreview(null)}>Done</button></div>
      <p className="muted"><small>Revision history: {data.attachments.filter(file => file.id === preview.id || file.revisionOf === preview.id || file.id === preview.revisionOf).map(file => file.name).join(' → ')}</small></p>
    </Modal>}
  </section>;
}
