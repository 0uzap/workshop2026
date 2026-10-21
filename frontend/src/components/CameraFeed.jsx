import { useEffect, useState } from 'react';
import { fetchFrame } from '../api';

/**
 * Retour vidéo de la caméra USB du PC Hôte, relayé par auth-service.
 * Le navigateur n'accède jamais à une webcam : il affiche seulement les
 * images que le serveur capture lui-même.
 * Affiché en miroir, plus naturel pour la personne filmée.
 */
export default function CameraFeed({ path, headers, overlay, active = true }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!active) return undefined;

    let stopped = false;
    let currentUrl = null;

    const loop = async () => {
      while (!stopped) {
        const blob = await fetchFrame(path, headers).catch(() => null);
        if (stopped) break;
        if (blob) {
          const url = URL.createObjectURL(blob);
          setSrc(url);
          if (currentUrl) URL.revokeObjectURL(currentUrl);
          currentUrl = url;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    };
    loop();

    return () => {
      stopped = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      setSrc(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, active, JSON.stringify(headers)]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-black">
      {src ? (
        <img src={src} alt="Caméra du poste" className="aspect-[4/3] w-full -scale-x-100 object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center text-sm text-slate-500">
          Activation de la caméra…
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-3/4 w-1/2 rounded-[50%] border-2 border-dashed border-emerald-400/60" />
      </div>
      {overlay && (
        <div className="absolute inset-x-0 bottom-0 bg-slate-950/80 p-3 text-center text-lg font-semibold">
          {overlay}
        </div>
      )}
    </div>
  );
}
