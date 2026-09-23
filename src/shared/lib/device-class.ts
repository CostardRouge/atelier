/**
 * How much room this device gives a tab — ONE coarse answer, read once.
 *
 * A phone kills a tab that grows past what it is given and says nothing:
 * the page simply reloads (`media-pipeline.md`, «The stage has a pixel
 * budget»). No browser tells a page that number. Chrome offers
 * `navigator.deviceMemory`, rounded down to a power of two and capped at 8;
 * Safari — every iPhone and iPad — offers nothing at all. So the honest
 * classification is coarse and deliberately so: a device is either
 * CONSTRAINED (a phone or a tablet, or a machine that says it has 4 GiB or
 * less) or ROOMY (everything else). Nothing here decides a pixel count; the
 * modules that spend memory (`raw/raw-budget.ts`, `sources/held-budget.ts`)
 * ask this and choose their own numbers, each explained where it lives.
 *
 * iOS is read from `navigator.platform` and, for an iPad that calls itself a
 * Mac (iPadOS 13+), from a Mac platform with a touch screen. Android from the
 * user agent, which is the one signal it has. The two are sniffed rather
 * than measured because there is nothing to measure — a page cannot ask a
 * phone how much memory a tab may take before it is killed for taking it.
 *
 * `localStorage['atelier.device']` overrides the answer (`constrained` or
 * `roomy`), so the phone path can be driven on a desktop and a phone can be
 * told to stop holding back. A browser preference, never a document.
 *
 * Pure but for `readDeviceFacts` and the memoised `deviceClass`.
 */

export type DeviceClass = 'constrained' | 'roomy';

export interface DeviceFacts {
  platform: string;
  userAgent: string;
  maxTouchPoints: number;
  /** `navigator.deviceMemory` in GiB where the browser says; null where it does not (Safari, Firefox). */
  deviceMemoryGiB: number | null;
}

/** A machine that says it has this much or less is treated as a phone would be. */
export const CONSTRAINED_MEMORY_GIB = 4;

const IOS_PLATFORM = /^(iPhone|iPad|iPod)/;

/** True for an iPhone, an iPad (the ones that call themselves a Mac included) or an iPod. */
export function isAppleMobile(facts: Pick<DeviceFacts, 'platform' | 'maxTouchPoints'>): boolean {
  if (IOS_PLATFORM.test(facts.platform)) return true;
  // iPadOS 13+ reports `MacIntel`; a Mac has no touch points, an iPad has five.
  return /^Mac/.test(facts.platform) && facts.maxTouchPoints > 1;
}

export function deviceClassFor(facts: DeviceFacts): DeviceClass {
  if (isAppleMobile(facts)) return 'constrained';
  if (/\bAndroid\b/.test(facts.userAgent)) return 'constrained';
  const memory = facts.deviceMemoryGiB;
  if (memory !== null && Number.isFinite(memory) && memory > 0 && memory <= CONSTRAINED_MEMORY_GIB) return 'constrained';
  return 'roomy';
}

/** The facts as this browser states them; empty where there is no browser (a spec). */
export function readDeviceFacts(): DeviceFacts {
  if (typeof navigator === 'undefined') {
    return { platform: '', userAgent: '', maxTouchPoints: 0, deviceMemoryGiB: null };
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    platform: nav.platform ?? '',
    userAgent: nav.userAgent ?? '',
    maxTouchPoints: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0,
    deviceMemoryGiB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
  };
}

export const DEVICE_CLASS_KEY = 'atelier.device';

function storedOverride(): DeviceClass | null {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(DEVICE_CLASS_KEY) : null;
    return v === 'constrained' || v === 'roomy' ? v : null;
  } catch {
    return null;
  }
}

let known: DeviceClass | null = null;
let override: DeviceClass | null = null;

/** This device's class, read once per page (the facts do not change under a tab). */
export function deviceClass(): DeviceClass {
  if (override) return override;
  if (known === null) known = storedOverride() ?? deviceClassFor(readDeviceFacts());
  return known;
}

/** For a spec, or a diagnostic: an answer of one's own; null returns to the device's. */
export function overrideDeviceClass(next: DeviceClass | null): void {
  override = next;
}

export function isConstrainedDevice(): boolean {
  return deviceClass() === 'constrained';
}
