'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { ImportPreview } from '@snow/core';
import { btn, Card, Notice, Tag } from '@/components/ui';
import { importCsvAction, previewCsvAction } from '../../actions';

type ImportResult = Awaited<ReturnType<typeof importCsvAction>>;

export function ImportForm({ template }: { template: string }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const load = (t: string) => {
    setText(t);
    setResult(null);
    start(async () => setPreview(await previewCsvAction(t)));
  };

  return (
    <div className="space-y-4">
      <Card title="1. Choose a file">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(await f.text()); }} className="text-sm" />
          <a className="text-sm text-sky-700 underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="clients-template.csv">Download template</a>
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-slate-600">Or paste CSV text</summary>
          <textarea rows={6} className="mt-2 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className={`${btn('secondary', 'sm')} mt-2`} onClick={() => load(text)}>Preview</button>
        </details>
        <p className="mt-3 text-xs text-slate-500">Columns: client_name, phone, address (required); email, notify_method (sms, email or voice), latitude, longitude, instructions, service_minutes (optional).</p>
      </Card>

      {pending && <p className="text-sm text-slate-600">Working…</p>}

      {preview && (
        <Card title="2. Check the preview">
          {preview.headerErrors.length > 0 ? (
            <Notice tone="danger">{preview.headerErrors.join('. ')}</Notice>
          ) : (
            <>
              <p className="mb-3 text-sm">
                <strong>{preview.validCount}</strong> of {preview.rows.length} rows are ready · <strong>{preview.clientCount}</strong> clients.
                {preview.rows.length - preview.validCount > 0 && <span className="text-rose-700"> {preview.rows.length - preview.validCount} rows have errors and will be skipped.</span>}
              </p>
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white text-xs uppercase text-slate-500">
                    <tr><th className="py-1 pr-3">Line</th><th className="py-1 pr-3">Client</th><th className="py-1 pr-3">Address</th><th className="py-1 pr-3">Notify</th><th className="py-1">Check</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.map((r) => (
                      <tr key={r.line} className={r.errors.length ? 'bg-rose-50' : ''}>
                        <td className="py-1 pr-3 tabular-nums text-slate-500">{r.line}</td>
                        <td className="py-1 pr-3">{r.clientName || '—'}</td>
                        <td className="py-1 pr-3">{r.address || '—'}</td>
                        <td className="py-1 pr-3">{({ sms: 'SMS', email: 'Email', voice: 'Voice' } as const)[r.notifyChannel]}</td>
                        <td className="py-1">
                          {r.errors.length ? <span className="text-rose-800">✕ {r.errors.join('; ')}</span> : <Tag tone="success">✓ Ready</Tag>}
                          {r.warnings.map((w) => <div key={w} className="text-xs text-amber-800">! {w}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                disabled={pending || preview.validCount === 0 || !!result?.ok}
                className={`${btn()} mt-4`}
                onClick={() => start(async () => setResult(await importCsvAction(text)))}
              >
                Import {preview.validCount} rows
              </button>
            </>
          )}
        </Card>
      )}

      {result && (
        <Card title="3. Result">
          {result.ok ? (
            <Notice tone="success">
              Created {result.clientsCreated} clients and {result.propertiesCreated} properties.
              {result.skippedExisting > 0 && ` ${result.skippedExisting} properties already existed and were skipped.`}
              {result.lookupFailures.length > 0 && ` ${result.lookupFailures.length} addresses could not be found.`}
              {result.simulatedLocations && ' Locations without coordinates were simulated (development).'}{' '}
              <Link href="/admin/clients" className="underline">Go to clients</Link>
            </Notice>
          ) : (
            <Notice tone="danger">{result.error}</Notice>
          )}
        </Card>
      )}
    </div>
  );
}
