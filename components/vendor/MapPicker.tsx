"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinned } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/lib/i18n";

export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export type Picked = { address: string; lat: number; lng: number };

type LatLng = { lat: () => number; lng: () => number };
type GMaps = {
  Map: new (el: HTMLElement, opts: object) => { addListener: (e: string, f: (ev: { latLng: LatLng }) => void) => void };
  Marker: new (opts: object) => { setPosition: (p: object) => void };
  Geocoder: new () => { geocode: (req: object) => Promise<{ results: { formatted_address: string }[] }> };
};

let loading: Promise<GMaps> | null = null;
/** Google Maps JS API, loaded once (needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY with Maps JS + Geocoding). */
function loadMaps(lang: string): Promise<GMaps> {
  const w = window as unknown as { google?: { maps: GMaps } };
  if (w.google?.maps) return Promise.resolve(w.google.maps);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&language=${lang}`;
    script.async = true;
    script.onload = () => (w.google?.maps ? resolve(w.google.maps) : reject(new Error("Google Maps failed to load.")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Google Maps failed to load."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

const CAIRO = { lat: 30.0444, lng: 31.2357 };

/** "Pick on map" button + dialog: click the map to drop a pin; the address is looked up for the text field. */
export function MapPicker({ value, onPick }: { value: Picked | null; onPick: (picked: Picked) => void }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(value);
  const [error, setError] = useState<string | null>(null);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // The dialog's content mounts after `open`; wait a frame for the map container.
    const frame = requestAnimationFrame(() => {
      loadMaps(locale)
        .then((maps) => {
          if (cancelled || !el.current) return;
          const centre = value ? { lat: value.lat, lng: value.lng } : CAIRO;
          const map = new maps.Map(el.current, { center: centre, zoom: value ? 15 : 11, streetViewControl: false, mapTypeControl: false });
          const marker = new maps.Marker({ map, position: value ? centre : null });
          const geocoder = new maps.Geocoder();
          map.addListener("click", ({ latLng }) => {
            const point = { lat: latLng.lat(), lng: latLng.lng() };
            marker.setPosition(point);
            const fallback = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
            setPicked({ address: fallback, ...point });
            geocoder
              .geocode({ location: point })
              .then(({ results }) => !cancelled && setPicked({ address: results[0]?.formatted_address ?? fallback, ...point }))
              .catch(() => undefined); // keep the coordinates as the address
          });
        })
        .catch((caught: Error) => setError(caught.message));
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [open, locale, value]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-navy underline-offset-4 hover:text-brand-amber hover:underline">
        <MapPinned className="size-3.5" aria-hidden />
        {t("Pick on map")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Pick your location")}</DialogTitle>
            <DialogDescription>{t("Click the map where your studio or showroom is.")}</DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{t(error)}</p>
          ) : (
            <div ref={el} className="h-80 w-full overflow-hidden rounded-xl bg-slate-100" />
          )}
          <p className="min-h-5 text-sm text-slate-600">{picked?.address}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              disabled={!picked}
              onClick={() => {
                if (picked) onPick(picked);
                setOpen(false);
              }}
            >
              {t("Use this location")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
