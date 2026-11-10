import { useEffect, useState } from 'react';
import { isRawImage } from '../library/assets';
import { rawSizes, type RawSizes } from '../exif/raw-probe';
import type { MaterialRow } from './MaterialMenu';
import type { RawMaterial } from './raw-choice';
import { materialForFile, sensorReachable, sensorStillFile, type SensorStillOptions } from './sensor-still';

export interface SensorFile {
  /** What to draw: the sensor's picture when the picture is on its sensor and it is ready, else the file itself. */
  file: File | null;
  /** A RAW stands behind the file — the material menu is offered. */
  reachable: boolean;
  material: RawMaterial;
  /** The material is Auto's answer, not a stored choice. */
  auto: boolean;
  /** The sensor is being read (or fetched). */
  busy: boolean;
  /** The menu's two rows for this file. */
  rows: MaterialRow[];
}

const sizeText = (s: { width: number; height: number } | null | undefined) => (s ? `${s.width} × ${s.height}` : null);

/**
 * A host's picture read from its stored material (`raw-choice.ts`): the file
 * itself on its render, the sensor's picture (`sensorStillFile`) on its
 * sensor — what Trips' and the Studio's stages draw (`sensor-outside-develop.md`).
 * The file is drawn as it is while the sensor is read, and stays when the
 * sensor cannot be reached: a picture is never left blank for its material.
 */
export function useSensorFile(
  file: File | null,
  own: RawMaterial | null | undefined,
  opts: Pick<SensorStillOptions, 'edge' | 'purpose'> = { edge: 4096, purpose: 'stage' },
): SensorFile {
  const isImage = Boolean(file && (file.type.startsWith('image/') || isRawImage(file.name)));
  const reachable = isImage && sensorReachable(file);
  const [material, setMaterial] = useState<RawMaterial>('render');
  const [shown, setShown] = useState<{ of: File; file: File } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sizes, setSizes] = useState<RawSizes | null>(null);
  const { edge, purpose } = opts;

  useEffect(() => {
    setSizes(null);
    if (!file || !reachable || !isRawImage(file.name)) return;
    let alive = true;
    void rawSizes(file).then((s) => alive && setSizes(s));
    return () => {
      alive = false;
    };
  }, [file, reachable]);

  useEffect(() => {
    if (!file || !reachable) {
      setMaterial('render');
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    let alive = true;
    void (async () => {
      const m = await materialForFile(file, own);
      if (!alive) return;
      setMaterial(m);
      if (m !== 'sensor') {
        setBusy(false);
        return;
      }
      setBusy(true);
      try {
        const still = await sensorStillFile(file, { edge, purpose, signal: controller.signal });
        if (alive && still) setShown({ of: file, file: still });
      } catch {
        // Out of reach or refused: the file itself stays on the stage.
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [file, reachable, own, edge, purpose]);

  const local = Boolean(file && isRawImage(file.name));
  const rows: MaterialRow[] = [
    local
      ? { material: 'render', label: 'Camera render', short: 'Render', hint: 'The picture inside the file · instant', pixels: sizeText(sizes?.render) }
      : { material: 'render', label: 'Proxy', hint: 'Your Winnow’s copy · instant', pixels: null },
    { material: 'sensor', label: 'Sensor', hint: local ? 'Full quality · decoded once' : 'Full quality · downloads the original once', pixels: sizeText(sizes?.sensor) },
  ];
  const onSensor = material === 'sensor' && shown && shown.of === file ? shown.file : null;
  return { file: onSensor ?? file, reachable, material, auto: !own, busy, rows };
}
