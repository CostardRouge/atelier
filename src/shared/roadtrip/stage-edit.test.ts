import { describe, expect, it } from 'vitest';
import {
  dayStageActions,
  insertStageInOrder,
  resizeStage,
  shiftStage,
  stageOverGap,
  startStageAt,
} from './stage-edit';
import { createTripDoc, createTripStage, type TripDoc, type TripStage } from './trip-types';

const stage = (start: string, end: string, name = ''): TripStage =>
  createTripStage(name, '', start, end);

const trip = (stages: TripStage[] = []): TripDoc => ({
  ...createTripDoc('Test', '', '2025-03-01', '2025-03-20'),
  stages,
});

describe('resizeStage', () => {
  const s = stage('2025-03-05', '2025-03-10');

  it('moves one edge and holds the other', () => {
    expect(resizeStage(trip(), s, 'start', '2025-03-03')).toMatchObject({
      startDate: '2025-03-03',
      endDate: '2025-03-10',
    });
    expect(resizeStage(trip(), s, 'end', '2025-03-12')).toMatchObject({
      startDate: '2025-03-05',
      endDate: '2025-03-12',
    });
  });

  it('collapses to one day instead of reversing when an edge crosses the other', () => {
    expect(resizeStage(trip(), s, 'start', '2025-03-15')).toMatchObject({
      startDate: '2025-03-15',
      endDate: '2025-03-15',
    });
    expect(resizeStage(trip(), s, 'end', '2025-03-02')).toMatchObject({
      startDate: '2025-03-02',
      endDate: '2025-03-02',
    });
  });

  it('stops at the trip’s edges', () => {
    expect(resizeStage(trip(), s, 'start', '2025-02-01').startDate).toBe('2025-03-01');
    expect(resizeStage(trip(), s, 'end', '2025-04-01').endDate).toBe('2025-03-20');
  });
});

describe('shiftStage', () => {
  const s = stage('2025-03-05', '2025-03-10');

  it('slides both dates and keeps the length', () => {
    expect(shiftStage(trip(), s, 3)).toMatchObject({ startDate: '2025-03-08', endDate: '2025-03-13' });
    expect(shiftStage(trip(), s, -2)).toMatchObject({ startDate: '2025-03-03', endDate: '2025-03-08' });
  });

  it('shortens the slide so the leg stays inside the trip', () => {
    expect(shiftStage(trip(), s, 30)).toMatchObject({ startDate: '2025-03-15', endDate: '2025-03-20' });
    expect(shiftStage(trip(), s, -30)).toMatchObject({ startDate: '2025-03-01', endDate: '2025-03-06' });
  });

  it('returns the same stage for a zero or impossible move', () => {
    expect(shiftStage(trip(), s, 0)).toBe(s);
    expect(shiftStage(trip(), stage('bad', '2025-03-10'), 2).startDate).toBe('bad');
  });
});

describe('insertStageInOrder', () => {
  it('keeps the list in lived order', () => {
    const a = stage('2025-03-01', '2025-03-03');
    const c = stage('2025-03-10', '2025-03-12');
    const b = stage('2025-03-05', '2025-03-08');
    expect(insertStageInOrder([a, c], b)).toEqual([a, b, c]);
    expect(insertStageInOrder([a, b], c)).toEqual([a, b, c]);
  });
});

describe('startStageAt', () => {
  const newest = (r: { stages: TripStage[]; selectedId: string }) =>
    r.stages.find((s) => s.id === r.selectedId)!;

  it('runs from the day to the day before the next leg', () => {
    const next = stage('2025-03-10', '2025-03-15');
    const result = startStageAt(trip([next]), '2025-03-04');
    expect(newest(result)).toMatchObject({ startDate: '2025-03-04', endDate: '2025-03-09' });
    expect(result.stages).toEqual([newest(result), next]);
  });

  it('runs to the trip’s end with nothing after it', () => {
    expect(newest(startStageAt(trip(), '2025-03-18'))).toMatchObject({
      startDate: '2025-03-18',
      endDate: '2025-03-20',
    });
  });

  it('cuts the leg it lands inside, so starting a leg is how one is split', () => {
    const long = stage('2025-03-02', '2025-03-15', 'Long');
    const result = startStageAt(trip([long]), '2025-03-08');
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0]).toMatchObject({ name: 'Long', startDate: '2025-03-02', endDate: '2025-03-07' });
    expect(result.stages[0].id).toBe(long.id);
    expect(newest(result)).toMatchObject({ startDate: '2025-03-08', endDate: '2025-03-15' });
  });

  it('leaves a leg that begins on the very day alone and adds a one-day leg beside it', () => {
    const tight = stage('2025-03-05', '2025-03-08');
    const result = startStageAt(trip([tight]), '2025-03-05');
    expect(newest(result)).toMatchObject({ startDate: '2025-03-05', endDate: '2025-03-05' });
    expect(result.stages.find((s) => s.id === tight.id)).toBe(tight);
  });

  it('derives its label, never a placeholder name', () => {
    expect(newest(startStageAt(trip(), '2025-03-02')).name).toBe('');
  });
});

describe('stageOverGap', () => {
  it('covers exactly the gap, clamped to the trip', () => {
    expect(stageOverGap(trip(), '2025-02-20', '2025-03-03')).toMatchObject({
      startDate: '2025-03-01',
      endDate: '2025-03-03',
    });
  });
});

describe('dayStageActions', () => {
  it('offers nothing off the trip', () => {
    expect(dayStageActions(trip(), '2025-04-01')).toEqual([]);
  });

  it('always offers to start a leg, inserted in order and selected', () => {
    const later = stage('2025-03-10', '2025-03-12', 'Later');
    const t = trip([later]);
    const [start] = dayStageActions(t, '2025-03-03');
    expect(start.id).toBe('start');
    const result = start.apply(t);
    expect(result.stages.map((s) => s.name)).toEqual(['', 'Later']);
    expect(result.stages[0].id).toBe(result.selectedId);
    expect(result.stages[0]).toMatchObject({ startDate: '2025-03-03', endDate: '2025-03-09' });
  });

  it('offers to end the covering leg here, naming it', () => {
    const leg = stage('2025-03-02', '2025-03-10', 'The Red Centre');
    const t = trip([leg]);
    const actions = dayStageActions(t, '2025-03-06');
    expect(actions.map((a) => a.id)).toEqual(['start', 'end']);
    expect(actions[1].label).toBe('End “The Red Centre” here');
    const result = actions[1].apply(t);
    expect(result.stages[0]).toMatchObject({ startDate: '2025-03-02', endDate: '2025-03-06' });
    expect(result.selectedId).toBe(leg.id);
  });

  it('names an unlabelled leg by its number, the way the editor does', () => {
    const first = stage('2025-03-01', '2025-03-03');
    const second = stage('2025-03-05', '2025-03-10');
    expect(dayStageActions(trip([first, second]), '2025-03-07')[1].label).toBe('End stage 2 here');
  });

  it('does not offer to end a leg on the day it already ends', () => {
    const leg = stage('2025-03-02', '2025-03-06');
    expect(dayStageActions(trip([leg]), '2025-03-06').map((a) => a.id)).toEqual(['start']);
  });

  it('offers to extend the last leg that ended before an uncovered day', () => {
    const early = stage('2025-03-01', '2025-03-03', 'Early');
    const leg = stage('2025-03-05', '2025-03-08', 'Coast');
    const t = trip([early, leg]);
    const actions = dayStageActions(t, '2025-03-12');
    expect(actions.map((a) => a.id)).toEqual(['start', 'extend']);
    expect(actions[1].label).toBe('Extend “Coast” to here');
    const result = actions[1].apply(t);
    expect(result.stages[1]).toMatchObject({ startDate: '2025-03-05', endDate: '2025-03-12' });
    expect(result.stages[0]).toBe(early);
    expect(result.selectedId).toBe(leg.id);
  });

  it('names the covering leg by its derived label when it has no name', () => {
    const leg = stage('2025-03-02', '2025-03-10');
    leg.places = [
      { id: 'a', name: 'Perth', region: '', coords: null },
      { id: 'b', name: 'Kalbarri', region: '', coords: null },
    ];
    expect(dayStageActions(trip([leg]), '2025-03-04')[1].label).toBe('End “Perth → Kalbarri” here');
  });
});
