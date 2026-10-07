import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTO_PLAN, allState, autoPlanPref, describeSteps, readAutoPlan, withStep } from './auto-plan';

describe('readAutoPlan', () => {
  it('is the default for nothing or junk', () => {
    expect(readAutoPlan(null)).toEqual(DEFAULT_AUTO_PLAN);
    expect(readAutoPlan('x')).toEqual(DEFAULT_AUTO_PLAN);
    expect(readAutoPlan({ steps: 'tone' })).toEqual(DEFAULT_AUTO_PLAN);
  });

  it('keeps known steps in the canonical order and drops the rest', () => {
    expect(readAutoPlan({ steps: ['upright', 'wat', 'tone', 'tone'], onOpen: 'yes' })).toEqual({ steps: ['tone', 'upright'], onOpen: false });
    expect(readAutoPlan({ steps: [], onOpen: true })).toEqual({ steps: [], onOpen: true });
  });
});

describe('withStep', () => {
  it('ticks and unticks one step, the order kept', () => {
    const plan = readAutoPlan({ steps: ['detail'] });
    expect(withStep(plan, 'tone', true).steps).toEqual(['tone', 'detail']);
    expect(withStep(withStep(plan, 'tone', true), 'detail', false).steps).toEqual(['tone']);
    expect(withStep(plan, 'detail', true).steps).toEqual(['detail']);
  });
});

describe('allState', () => {
  it('reads the one switch off its steps', () => {
    expect(allState([])).toBe('off');
    expect(allState(['off', 'off'])).toBe('off');
    expect(allState(['on', 'nothing'])).toBe('on');
    expect(allState(['nothing', 'nothing'])).toBe('nothing');
    expect(allState(['on', 'off'])).toBe('edited');
    expect(allState(['on', 'edited'])).toBe('edited');
  });
});

describe('describeSteps', () => {
  it('lists the steps as a sentence', () => {
    expect(describeSteps([])).toBe('nothing');
    expect(describeSteps(['tone'])).toBe('tone');
    expect(describeSteps(['tone', 'bands'])).toBe('tone and bands');
    expect(describeSteps(DEFAULT_AUTO_PLAN.steps)).toBe('tone, bands and detail');
  });
});

describe('autoPlanPref', () => {
  it('round-trips through its encoding', () => {
    autoPlanPref.set({ steps: ['colour', 'level'], onOpen: true });
    expect(autoPlanPref.get()).toEqual({ steps: ['colour', 'level'], onOpen: true });
    autoPlanPref.set(readAutoPlan(null));
  });
});
