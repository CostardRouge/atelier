import { useEffect, useState } from 'react';
import { useObjectUrl } from '../../shared/media/use-object-url';
import type { RecapPicture } from '../../shared/recap/recap-doc';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { Icons } from '../../shared/ui/icons';
import { getPrint } from './recap-store';
import { printKey } from '../../shared/recap/recap-raw';

/**
 * A pool picture as a small square: Winnow's thumbnail, the local file in
 * hand, else the print kept on this device — and its name when none of them
 * can be had (a local file not handed over again).
 */
export default function PictureThumb({
  pic,
  client,
  instance,
  file,
  className = '',
}: {
  pic: RecapPicture;
  client: WinnowClient | null;
  instance: string | null;
  file: File | null;
  className?: string;
}) {
  const remote = pic.origin === 'winnow' && client && pic.asset !== undefined && pic.instance === instance ? client.thumbUrl(pic.liveStill ?? pic.asset) : null;
  const [kept, setKept] = useState<Blob | null>(null);
  const localImage = file && pic.kind === 'photo' && /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name) ? file : null;
  useEffect(() => {
    if (remote || localImage) return;
    let alive = true;
    // A RAW on its sensor may have only its sensor's print kept (`recap-raw.ts`).
    void getPrint(pic.key)
      .then((b) => b ?? getPrint(printKey(pic.key, 'sensor')))
      .then((b) => alive && setKept(b));
    return () => {
      alive = false;
    };
  }, [pic.key, remote, localImage]);
  const url = useObjectUrl(localImage ?? kept);
  const src = remote ?? url;
  return (
    <span className={`relative block overflow-hidden bg-frame ${className}`}>
      {src ? (
        <img src={src} alt="" loading="lazy" draggable={false} className="block w-full h-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center p-1 text-center font-mono text-3xs text-on-media/70 break-all leading-tight">{pic.name}</span>
      )}
      {pic.kind === 'video' && <span className="absolute left-1 bottom-1 inline-flex w-4 h-4 items-center justify-center rounded-[3px] bg-accent text-on-media [&>svg]:w-3 [&>svg]:h-3">{Icons.play}</span>}
    </span>
  );
}
