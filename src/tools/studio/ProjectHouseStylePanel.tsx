import HouseStyleControls, { type HouseStyleRow } from '../../shared/ui/HouseStyleControls';
import { presetById } from '../../shared/overlay/title-styles';
import { INTRO_SCENE_ID } from '../../shared/overlay/scenes';
import { transformLabel } from '../../shared/lut/transfer';
import {
  PROJECT_HOUSE_STYLE_PATH,
  projectHouseStyleFrom,
  type ProjectHouseStyle,
} from '../../shared/projects/house-style';
import { bundledProjectHouseStyle } from '../../shared/projects/house-style-bundle';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What each block of the style will actually say. */
function rowsOf(style: ProjectHouseStyle): HouseStyleRow[] {
  const intro = style.scenes.find((scene) => scene.id === INTRO_SCENE_ID);
  const looks = style.lutStack.map((layer) => layer.name);
  if (style.outputTransform !== 'none') looks.push(transformLabel(style.outputTransform));
  return [
    {
      label: 'Title style',
      value: style.theme
        ? (presetById(style.theme.presetId)?.name ?? style.theme.presetId)
        : 'Element styles as-is',
    },
    { label: 'Overlays', value: plural(style.elements.length, 'element') },
    { label: 'Intro', value: intro ? `${(intro.end - intro.start).toFixed(1)} s` : 'None' },
    {
      label: 'Closing card',
      value: style.outro
        ? `${style.outro.seconds} s${style.outro.qr ? ' · QR' : ''}`
        : 'None',
    },
    { label: 'Grade', value: looks.length ? looks.join(' + ') : 'None' },
    {
      label: 'Export',
      value: style.exportPrefs.variants
        .map((v) => `${v.aspectId} · ${v.resolution}${v.overlays ? '' : ' · clean'}`)
        .join(', '),
    },
  ];
}

/**
 * Project settings → House style: the open project's look as the one every
 * new project starts from. `project` is the editor's LIVE portable half, like
 * the settings export, so an edit the autosave has not written yet still counts.
 */
export default function ProjectHouseStylePanel({ project }: { project: ProjectHouseStyle }) {
  const { file, uploadedLooks, leftTrips } = projectHouseStyleFrom(project);
  const committed = bundledProjectHouseStyle();
  const leftOut = [
    ...(leftTrips
      ? ['Left out: the hook and closing card sent from Trips — they tell one day of one journey.']
      : []),
    ...(uploadedLooks.length
      ? [
          `Left out: ${uploadedLooks.join(', ')} — an uploaded look carries its whole .cube. Drop the file in public/luts/ to ship it as a built-in.`,
        ]
      : []),
  ];
  return (
    <HouseStyleControls
      target="project"
      path={PROJECT_HOUSE_STYLE_PATH}
      file={file}
      rows={rowsOf(file.style)}
      leftOut={leftOut}
      committed={committed !== null}
      same={committed !== null && JSON.stringify(committed) === JSON.stringify(file.style)}
    >
      <p>
        Every new project without a template starts from this project’s look — its
        overlays, guides, title style, intro, closing card, grade and export matrix.
        Never its format (chosen when creating), its capture-time shift, its cadence,
        its file name or its media. Projects that already exist never change, and
        neither does an imported project file.
      </p>
      <p>
        Saving writes <code>{PROJECT_HOUSE_STYLE_PATH}</code> in the repository: commit
        it and the deployed site’s new projects start there too. This section only
        exists on the dev server.
      </p>
    </HouseStyleControls>
  );
}
