// ----------------------------------------------------------------------------
// ScanOrderModal — "Scan Order" on the Sales Orders list.
//
// v1 of the handwritten-slip OCR flow (ported from HOOKKA's scan-po modal,
// deliberately simpler):
//   1. Operator drops / snaps photo(s) of a showroom sale-order slip
//      (jpeg/png/webp, PDF also accepted).
//   2. POST /scan-so/extract → Claude vision reads the handwriting against
//      the live SKU/fabric catalog and returns structured JSON + a sampleId.
//   3. Operator reviews + corrects in an editable form (customer block,
//      dates, line cards with a searchable SKU picker + confidence chip).
//   4. "Open in New SO" → corrections are saved back as a few-shot example
//      (POST /scan-so/samples/:id/confirm) and the New SO page opens with
//      the reviewed data prefilled via sessionStorage handoff
//      (?fromScan=1 + SCAN_PREFILL_KEY — see SalesOrderNew.tsx seed effect).
//
// The modal NEVER creates the SO itself — everything lands in the normal
// New SO form where pricing, variants and validation run as usual.
// ----------------------------------------------------------------------------

import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Camera, Loader2, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { authedFetch } from '../lib/authed-fetch';
import styles from './ScanOrderModal.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

/* ── Handoff contract with SalesOrderNew.tsx ───────────────────────────── */
export const SCAN_PREFILL_KEY = 'soScanPrefill';

export type ScanPrefillLine = {
  itemCode:       string;        // '' when no SKU picked — operator fills in the form
  itemGroup:      string;        // 'sofa' | 'bedframe' | 'mattress' | 'accessory' | 'service' | 'others'
  description:    string;
  qty:            number;
  unitPriceCenti: number;        // RM handwriting × 100, rounded
  remark:         string;        // rawText + notes so nothing on the slip is lost
};

export type ScanPrefill = {
  customerName:   string;
  phone:          string;        // first phone, raw string
  address1:       string;
  note:           string;        // remarks + location + extra phones + non-date delivery text
  deliveryDate:   string | null; // only when a clean YYYY-MM-DD
  processingDate: string | null;
  lines:          ScanPrefillLine[];
};

/* ── /scan-so/extract response shape ───────────────────────────────────── */
type SkuMatch = { code: string; confidence: number; reason: string };
type ExtractedLine = {
  rawText: string;
  qtyGuess: number;
  priceRmGuess: number | null;
  skuMatch: SkuMatch | null;
  fabricMatch: SkuMatch | null;
  notes: string | null;
};
type ExtractedSlip = {
  customerName: string | null;
  address: string | null;
  phones: string[];
  location: string | null;
  deliveryDate: string | null;
  processingDate: string | null;
  salesRep: string | null;
  paymentMethod: string | null;
  depositRm: number | null;
  totalRm: number | null;
  remarks: string | null;
  lines: ExtractedLine[];
};
type CatalogSku = { code: string; name: string; category: string; baseModel: string | null };
type ExtractResp = {
  success: boolean;
  data: {
    sampleId: string | null;
    extracted: ExtractedSlip;
    warnings: Array<{ field: string; value: string; message: string; lineIdx?: number }>;
    catalog: { skus: CatalogSku[]; fabrics: Array<{ code: string; description: string | null }> };
  };
};

/* mfg_product_category → SO line item_group (SoLineCard lowercases the
   product category; SERVICE lines carry item_group='service'). */
const CATEGORY_TO_GROUP: Record<string, string> = {
  SOFA: 'sofa',
  BEDFRAME: 'bedframe',
  MATTRESS: 'mattress',
  ACCESSORY: 'accessory',
  SERVICE: 'service',
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type LineEdit = {
  rid: string;
  rawText: string;
  code: string;            // operator-editable SKU code ('' = none)
  suggestedCode: string;   // what Claude suggested (for the chip)
  confidence: number;
  reason: string;
  qty: number;
  priceRm: string;         // kept as text while editing; parsed on submit
  notes: string;
  fabricCode: string;
};

interface Props {
  onClose: () => void;
}

export const ScanOrderModal = ({ onClose }: Props) => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Review state (set after a successful extract).
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [skus, setSkus] = useState<CatalogSku[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [phonesText, setPhonesText] = useState('');   // " / "-joined, editable
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [processingDate, setProcessingDate] = useState('');
  const [salesRep, setSalesRep] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [depositRm, setDepositRm] = useState('');
  const [totalRm, setTotalRm] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<LineEdit[] | null>(null);

  const skuByCode = useMemo(
    () => new Map(skus.map((s) => [s.code.toUpperCase(), s])),
    [skus],
  );

  const addFiles = (picked: FileList | File[] | null) => {
    if (!picked) return;
    const ok = Array.from(picked).filter((f) =>
      /^image\/(jpeg|png|webp)$/.test(f.type) ||
      f.type === 'application/pdf' ||
      /\.(jpe?g|png|webp|pdf)$/i.test(f.name),
    );
    if (ok.length > 0) setFiles((prev) => [...prev, ...ok]);
  };

  const runExtract = async () => {
    if (files.length === 0 || extracting) return;
    setExtracting(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('file', f);
      const resp = await authedFetch<ExtractResp>('/scan-so/extract', {
        method: 'POST',
        body: fd,
      });
      const d = resp.data;
      setSampleId(d.sampleId);
      setSkus(d.catalog.skus);
      const ex = d.extracted;
      setCustomerName(ex.customerName ?? '');
      setPhonesText(ex.phones.join(' / '));
      setAddress(ex.address ?? '');
      setLocation(ex.location ?? '');
      setDeliveryDate(ex.deliveryDate ?? '');
      setProcessingDate(ex.processingDate ?? '');
      setSalesRep(ex.salesRep ?? '');
      setPaymentMethod(ex.paymentMethod ?? '');
      setDepositRm(ex.depositRm != null ? String(ex.depositRm) : '');
      setTotalRm(ex.totalRm != null ? String(ex.totalRm) : '');
      setRemarks(ex.remarks ?? '');
      setLines(ex.lines.map((l, i) => ({
        rid: `sl${i}-${Math.random().toString(36).slice(2, 7)}`,
        rawText: l.rawText,
        code: l.skuMatch?.code ?? '',
        suggestedCode: l.skuMatch?.code ?? '',
        confidence: l.skuMatch?.confidence ?? 0,
        reason: l.skuMatch?.reason ?? '',
        qty: l.qtyGuess,
        priceRm: l.priceRmGuess != null ? String(l.priceRmGuess) : '',
        notes: l.notes ?? '',
        fabricCode: l.fabricMatch?.code ?? '',
      })));
    } catch (e) {
      /* authedFetch already throws operator-friendly messages (humanApiError
         runs inside it) — surface the message as-is. */
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setExtracting(false);
    }
  };

  const updateLine = (rid: string, patch: Partial<LineEdit>) =>
    setLines((prev) => (prev ?? []).map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const dropLine = (rid: string) =>
    setLines((prev) => (prev ?? []).filter((l) => l.rid !== rid));

  /* "Open in New SO" — confirm the corrections (few-shot pool) then hand the
     reviewed payload to the New SO page via sessionStorage. */
  const openInNewSo = async () => {
    const edited = lines ?? [];
    const phones = phonesText.split('/').map((p) => p.trim()).filter(Boolean);

    // Corrected blob mirrors the extracted slip shape so future few-shot
    // examples teach the extractor the conventions the operator wants.
    const corrected: ExtractedSlip = {
      customerName: customerName || null,
      address: address || null,
      phones,
      location: location || null,
      deliveryDate: deliveryDate || null,
      processingDate: processingDate || null,
      salesRep: salesRep || null,
      paymentMethod: paymentMethod || null,
      depositRm: depositRm.trim() === '' ? null : Number(depositRm) || null,
      totalRm: totalRm.trim() === '' ? null : Number(totalRm) || null,
      remarks: remarks || null,
      lines: edited.map((l) => ({
        rawText: l.rawText,
        qtyGuess: l.qty,
        priceRmGuess: l.priceRm.trim() === '' ? null : Number(l.priceRm) || null,
        skuMatch: l.code
          ? { code: l.code, confidence: l.code === l.suggestedCode ? l.confidence : 1, reason: l.code === l.suggestedCode ? l.reason : 'operator-picked' }
          : null,
        fabricMatch: l.fabricCode ? { code: l.fabricCode, confidence: 1, reason: 'operator-confirmed' } : null,
        notes: l.notes || null,
      })),
    };
    if (sampleId) {
      // Best-effort — the SO prefill must not be blocked by sample bookkeeping.
      authedFetch(`/scan-so/samples/${sampleId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ corrected }),
      }).catch(() => { /* few-shot is best-effort */ });
    }

    const noteParts: string[] = [];
    if (remarks) noteParts.push(remarks);
    if (location) noteParts.push(`Venue/location on slip: ${location}`);
    if (phones.length > 1) noteParts.push(`Other phone(s): ${phones.slice(1).join(', ')}`);
    if (deliveryDate && !ISO_DATE_RE.test(deliveryDate)) noteParts.push(`Delivery: ${deliveryDate}`);
    if (paymentMethod) noteParts.push(`Payment method on slip: ${paymentMethod}`);
    if (depositRm.trim() !== '') noteParts.push(`Deposit on slip: RM ${depositRm}`);
    if (totalRm.trim() !== '') noteParts.push(`Total on slip: RM ${totalRm}`);
    if (salesRep) noteParts.push(`Sales rep on slip: ${salesRep}`);
    noteParts.push('(Prefilled from scanned slip — verify before saving.)');

    const prefill: ScanPrefill = {
      customerName,
      phone: phones[0] ?? '',
      address1: address,
      note: noteParts.join('\n'),
      deliveryDate: ISO_DATE_RE.test(deliveryDate) ? deliveryDate : null,
      processingDate: ISO_DATE_RE.test(processingDate) ? processingDate : null,
      lines: edited.map((l) => {
        const sku = skuByCode.get(l.code.toUpperCase());
        const remarkParts = [l.rawText && `Slip: ${l.rawText}`, l.notes].filter(Boolean) as string[];
        return {
          itemCode: sku?.code ?? '',
          itemGroup: sku ? (CATEGORY_TO_GROUP[sku.category] ?? 'others') : 'others',
          description: sku?.name ?? l.rawText,
          qty: l.qty > 0 ? l.qty : 1,
          // RM floats from handwriting → centi (×100, rounded).
          unitPriceCenti: Math.round((Number(l.priceRm) || 0) * 100),
          remark: remarkParts.join(' · '),
        };
      }),
    };
    sessionStorage.setItem(SCAN_PREFILL_KEY, JSON.stringify(prefill));
    onClose();
    navigate('/mfg-sales-orders/new?fromScan=1');
  };

  const confidenceChip = (l: LineEdit) => {
    if (!l.code) return <span className={`${styles.chip} ${styles.chipGrey}`}>no match</span>;
    if (l.code !== l.suggestedCode) return <span className={`${styles.chip} ${styles.chipGrey}`}>manual</span>;
    const pct = Math.round(l.confidence * 100);
    const cls = l.confidence >= 0.8 ? styles.chipGreen : styles.chipYellow;
    return <span className={`${styles.chip} ${cls}`} title={l.reason}>{pct}%</span>;
  };

  const inReview = lines !== null;

  return (
    <div className={styles.modal} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <div>
            <div className={styles.eyebrow}>Sales Orders</div>
            <h2 className={styles.title}>Scan Order</h2>
            <p className={styles.sub}>
              Photo of a handwritten sale-order slip → reviewed draft in the New SO form.
              Nothing is saved until you save the SO itself.
            </p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className={styles.body}>
          {error && <div className={styles.error}>{error}</div>}

          {!inReview && (
            <>
              <div
                className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              >
                <Camera size={28} strokeWidth={1.5} style={{ marginBottom: 8 }} />
                <div>Drop slip photo(s) here, or click to choose</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>JPEG / PNG / WEBP / PDF · max 20MB each</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
                />
              </div>
              {files.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {files.map((f, i) => (
                    <span key={`${f.name}-${i}`} className={styles.fileChip}>
                      {f.name}
                      <button
                        type="button"
                        className={styles.removeBtn}
                        style={{ padding: 0 }}
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Remove ${f.name}`}
                      >
                        <X size={12} strokeWidth={1.75} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {inReview && (
            <>
              <div className={styles.sectionLabel}>Customer</div>
              <div className={styles.grid2}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Customer name</span>
                  <input className={styles.input} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Phone(s) — separate with /</span>
                  <input className={styles.input} value={phonesText} onChange={(e) => setPhonesText(e.target.value)} />
                </label>
                <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <span className={styles.fieldLabel}>Address</span>
                  <input className={styles.input} value={address} onChange={(e) => setAddress(e.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Venue / location</span>
                  <input className={styles.input} value={location} onChange={(e) => setLocation(e.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Sales rep on slip</span>
                  <input className={styles.input} value={salesRep} onChange={(e) => setSalesRep(e.target.value)} />
                </label>
              </div>

              <div className={styles.sectionLabel}>Dates &amp; money</div>
              <div className={styles.grid2}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Delivery date (YYYY-MM-DD, or text like TBC)</span>
                  <input className={styles.input} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Processing date</span>
                  <input className={styles.input} value={processingDate} onChange={(e) => setProcessingDate(e.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Payment method</span>
                  <input className={styles.input} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Deposit (RM)</span>
                  <input className={styles.input} value={depositRm} onChange={(e) => setDepositRm(e.target.value)} inputMode="decimal" />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Total (RM)</span>
                  <input className={styles.input} value={totalRm} onChange={(e) => setTotalRm(e.target.value)} inputMode="decimal" />
                </label>
              </div>

              <div className={styles.sectionLabel}>Line items</div>
              {(lines ?? []).map((l) => (
                <div key={l.rid} className={styles.lineCard}>
                  {l.rawText && <div className={styles.rawText}>{l.rawText}</div>}
                  <div className={styles.lineRow}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>
                        SKU {confidenceChip(l)}
                      </span>
                      <input
                        className={styles.input}
                        list="scan-so-sku-options"
                        value={l.code}
                        placeholder="Type to search the SKU master…"
                        onChange={(e) => updateLine(l.rid, { code: e.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Qty</span>
                      <input
                        className={styles.input}
                        type="number"
                        min={1}
                        value={l.qty}
                        onChange={(e) => updateLine(l.rid, { qty: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Price (RM)</span>
                      <input
                        className={styles.input}
                        value={l.priceRm}
                        inputMode="decimal"
                        onChange={(e) => updateLine(l.rid, { priceRm: e.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => dropLine(l.rid)}
                      aria-label="Remove line"
                    >
                      <Trash2 size={15} strokeWidth={1.75} />
                    </button>
                  </div>
                  {l.code && !skuByCode.has(l.code.toUpperCase()) && (
                    <div className={styles.notes} style={{ color: 'var(--c-festive-b, #B8331F)' }}>
                      Not in the SKU master — the line will land without an item code.
                    </div>
                  )}
                  {(l.notes || l.fabricCode) && (
                    <div className={styles.notes}>
                      {l.fabricCode ? `Fabric: ${l.fabricCode}` : ''}
                      {l.fabricCode && l.notes ? ' · ' : ''}
                      {l.notes}
                    </div>
                  )}
                </div>
              ))}
              <datalist id="scan-so-sku-options">
                {skus.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </datalist>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Remarks</span>
                <textarea
                  className={styles.input}
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </label>
            </>
          )}
        </div>

        <div className={styles.foot}>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          {!inReview ? (
            <Button variant="primary" size="sm" onClick={() => void runExtract()} disabled={files.length === 0 || extracting}>
              {extracting
                ? <Loader2 size={ICON.size} strokeWidth={ICON.strokeWidth} className={styles.spin} />
                : <Upload size={ICON.size} strokeWidth={ICON.strokeWidth} />}
              <span>{extracting ? 'Reading slip…' : 'Extract'}</span>
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => void openInNewSo()}>
              <span>Open in New SO</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
