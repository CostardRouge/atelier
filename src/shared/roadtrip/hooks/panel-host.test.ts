import { describe, expect, it } from 'vitest';
import type { HookPanelHost } from './hook-variant';
import { hostShape, steadyHost } from './panel-host';

describe('a variant panel’s steady host', () => {
  it('has the same shape for a host rebuilt with new functions, and another when an ask comes or goes', () => {
    const a: HookPanelHost = { configureVehicle: () => undefined, editStopsOnMap: async () => null };
    const b: HookPanelHost = { configureVehicle: () => undefined, editStopsOnMap: async () => null };
    expect(hostShape(a)).toBe(hostShape(b));
    expect(hostShape({ editStopsOnMap: async () => null })).not.toBe(hostShape(a));
    expect(hostShape(undefined)).toBe('');
  });

  it('calls the CURRENT host’s ask, and offers only the asks of its shape', async () => {
    const calls: string[] = [];
    let current: HookPanelHost = { configureVehicle: () => void calls.push('first'), chooseHop: (id) => void calls.push(`hop ${id}`) };
    const host = steadyHost(hostShape(current), undefined, () => current)!;
    host.configureVehicle?.();
    current = { configureVehicle: () => void calls.push('second'), chooseHop: (id) => void calls.push(`hop2 ${id}`) };
    host.configureVehicle?.();
    host.chooseHop?.('p1', { mode: 'road' } as never);
    expect(calls).toEqual(['first', 'second', 'hop2 p1']);
    expect(host.choosePictures).toBeUndefined();
    expect(host.editStopsOnMap).toBeUndefined();
    // A host gone between two renders answers nothing rather than throwing.
    current = {};
    expect(() => host.configureVehicle?.()).not.toThrow();
    current = { editStopsOnMap: async () => [] };
    expect(await steadyHost(hostShape(current), undefined, () => ({}))!.editStopsOnMap!([], {})).toBeNull();
  });

  it('carries the pictures’ status as given, and is nothing without a host', () => {
    const status = { loading: 2 } as unknown as HookPanelHost['pictureStatus'];
    expect(steadyHost('', status, () => ({ pictureStatus: status }))?.pictureStatus).toBe(status);
    expect(steadyHost('', undefined, () => undefined)).toBeUndefined();
  });
});
