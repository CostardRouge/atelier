/**
 * What a series still needs before its posts read real numbers and real
 * pictures (his « je n'ai pas pu connecter l'instance … ni sélectionner les
 * photos », 2026-11-02, on atelier.steeve.website): a script, a Winnow
 * connected IN THIS BROWSER and chosen for the series, a trip IN THIS BROWSER
 * and chosen, a first Count. Every one of these is kept per browser and per
 * address — what a local Atelier holds is not on the published site — so each
 * step says where to fix it. (pure)
 */
import type { StoryScript } from './story-script';

export type StartStepId = 'script' | 'winnow' | 'trip' | 'count';

export interface StartStep {
  id: StartStepId;
  done: boolean;
  title: string;
  /** What stands, or what to do, in one sentence. */
  detail: string;
}

export interface StartState {
  script: StoryScript | null;
  /** The Winnow connections this browser holds. */
  connections: readonly { id: string }[];
  /** The trips this browser holds; null while they are read. */
  trips: readonly { id: string; name: string }[] | null;
}

/** The four steps, in order, each done or saying what is missing. (pure) */
export function startSteps({ script, connections, trips }: StartState): StartStep[] {
  const sources = script?.sources;
  const chosenWinnow = sources?.winnow?.source;
  const winnowHere = !!chosenWinnow && connections.some((c) => c.id === chosenWinnow);
  const chosenTrip = sources?.trip;
  const tripHere = !!chosenTrip && !!trips?.some((t) => t.id === chosenTrip.id);
  const counted = !!script?.facts && Object.keys(script.facts.values ?? {}).length > 0;
  return [
    {
      id: 'script',
      done: !!script,
      title: 'A series',
      detail: script ? `« ${script.series || 'Your series'} », kept in this browser.` : 'Start a new series here, or load your script file.',
    },
    {
      id: 'winnow',
      done: winnowHere,
      title: 'Your Winnow',
      detail: winnowHere
        ? `${chosenWinnow}, connected in this browser.`
        : chosenWinnow
          ? `${chosenWinnow} is chosen, but not connected in this browser: each browser and each address keeps its own connections.`
          : connections.length
            ? 'Choose the Winnow the series counts and picks its pictures on.'
            : 'No Winnow is connected in this browser: each browser and each address keeps its own. Connect yours under Sources.',
    },
    {
      id: 'trip',
      done: tripHere,
      title: 'The trip',
      detail: tripHere
        ? `« ${chosenTrip!.name} », in this browser.`
        : trips === null
          ? 'Reading the trips of this browser…'
          : chosenTrip
            ? `« ${chosenTrip.name} » is chosen, but not in this browser: open it from your Winnow in Trips, or import its .roadtrip.json.`
            : trips.length
              ? 'Choose the trip the maps follow and the counts span.'
              : 'No trip in this browser: open yours from your Winnow in Trips, or import its .roadtrip.json.',
    },
    {
      id: 'count',
      done: counted,
      title: 'A first Count',
      detail: counted
        ? `Counted${script?.facts?.at ? ` on ${script.facts.at.slice(0, 10)}` : ''}: the posts cite the numbers, the wall shows the pictures.`
        : 'Count the trip’s days on your Winnow (a post’s Sources): the numbers and the wall’s pictures come from it.',
    },
  ];
}
