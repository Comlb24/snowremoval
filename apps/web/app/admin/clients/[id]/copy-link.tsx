'use client';
import { useState } from 'react';

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <code className="break-all rounded bg-white px-2 py-1 text-xs text-slate-800 ring-1 ring-slate-300">{url}</code>
      <button
        type="button"
        className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
      <a href={url} target="_blank" rel="noreferrer" className="text-xs text-sky-800 underline">Open</a>
    </div>
  );
}
