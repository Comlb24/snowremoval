'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { input } from '@/components/ui';

type Suggestion = { id: string; main: string; secondary: string; prediction: any };

let loader: Promise<any> | null = null;

/** Loads the Google Maps JavaScript API once per page and returns the Places library. */
function loadPlaces(key: string): Promise<any> {
  const w = window as any;
  if (!loader) {
    loader = new Promise<void>((resolve, reject) => {
      if (w.google?.maps?.importLibrary) return resolve();
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&v=weekly&callback=__snowMapsReady`;
      s.async = true;
      w.__snowMapsReady = () => resolve();
      s.onerror = () => reject(new Error('Google Maps did not load'));
      document.head.appendChild(s);
    }).then(() => w.google.maps.importLibrary('places'));
    loader.catch(() => { loader = null; });
  }
  return loader;
}

/**
 * Address box with Google address suggestions. Picking a suggestion also sends its map location
 * (placeLat / placeLng / placeAddress), so the server does not need to look the address up.
 * With no key, or if Google cannot be reached, it is a plain text box and the server looks the address up as before.
 */
export function AddressInput({ apiKey, defaultValue, bias }: { apiKey: string | null; defaultValue: string; bias: { lat: number; lng: number } }) {
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ address: string; lat: number; lng: number } | null>(null);
  const places = useRef<any>(null);
  const session = useRef<any>(null);
  const request = useRef(0);
  const listId = useId();

  useEffect(() => {
    if (!apiKey) return;
    loadPlaces(apiKey).then((lib) => { places.current = lib; }).catch(() => { /* plain text box */ });
  }, [apiKey]);

  // Ask Google for suggestions shortly after the user stops typing.
  useEffect(() => {
    const lib = places.current;
    const q = value.trim();
    if (!lib || !open || q.length < 3 || picked?.address === value) { setItems([]); return; }
    const n = ++request.current;
    const t = setTimeout(async () => {
      try {
        session.current ??= new lib.AutocompleteSessionToken();
        const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q.slice(0, 200),
          sessionToken: session.current,
          includedRegionCodes: ['ca'],
          locationBias: { center: { lat: bias.lat, lng: bias.lng }, radius: 50000 },
        });
        if (n !== request.current) return;
        setItems(
          (suggestions ?? []).filter((s: any) => s.placePrediction).slice(0, 5).map((s: any) => ({
            id: s.placePrediction.placeId,
            main: s.placePrediction.mainText?.text ?? s.placePrediction.text?.text ?? '',
            secondary: s.placePrediction.secondaryText?.text ?? '',
            prediction: s.placePrediction,
          })),
        );
        setActive(-1);
      } catch {
        if (n === request.current) setItems([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value, open, picked, bias.lat, bias.lng]);

  async function choose(s: Suggestion) {
    setOpen(false);
    setItems([]);
    const fallback = [s.main, s.secondary].filter(Boolean).join(', ');
    setValue(fallback);
    try {
      const place = s.prediction.toPlace();
      await place.fetchFields({ fields: ['formattedAddress', 'location'] });
      const address = String(place.formattedAddress ?? fallback).replace(/, Canada$/, '');
      setValue(address);
      setPicked({ address, lat: place.location.lat(), lng: place.location.lng() });
    } catch {
      setPicked(null); // The server looks the address up instead.
    } finally {
      session.current = null; // One session per picked address (Google bills per session).
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? items.length - 1 : i - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  }

  // Coordinates count only while the box still holds the picked address.
  const location = picked && picked.address === value ? picked : null;
  const showList = open && items.length > 0;

  return (
    <div className="relative">
      <input
        name="address"
        required
        value={value}
        onChange={(e) => { setValue(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder="12 Main St, Moncton, NB"
        autoComplete={apiKey ? 'off' : 'street-address'}
        role={apiKey ? 'combobox' : undefined}
        aria-expanded={apiKey ? showList : undefined}
        aria-controls={apiKey ? listId : undefined}
        aria-autocomplete={apiKey ? 'list' : undefined}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        className={input}
      />
      {location && (
        <>
          <input type="hidden" name="placeAddress" value={location.address} />
          <input type="hidden" name="placeLat" value={String(location.lat)} />
          <input type="hidden" name="placeLng" value={String(location.lng)} />
        </>
      )}
      {showList && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <ul id={listId} role="listbox">
            {items.map((s, i) => (
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); choose(s); }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-sky-50' : ''}`}
              >
                <span className="font-medium text-slate-900">{s.main}</span>
                {s.secondary && <span className="ml-1 text-slate-500">{s.secondary}</span>}
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-3 py-1 text-right text-[11px] text-slate-400">Powered by Google</p>
        </div>
      )}
    </div>
  );
}
