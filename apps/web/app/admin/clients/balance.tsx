import { money } from '@/lib/format';

/** Owing in amber, credit in green, settled in grey. Text says which, not only colour. */
export function Balance({ amount }: { amount: number }) {
  const n = Math.round(amount * 100) / 100;
  if (n > 0) return <span className="font-medium text-amber-800">{money(n)} owing</span>;
  if (n < 0) return <span className="font-medium text-emerald-700">{money(-n)} credit</span>;
  return <span className="text-slate-500">Paid up</span>;
}
