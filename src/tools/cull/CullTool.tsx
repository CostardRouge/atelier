import { useState } from 'react';
import ExportPanel from './ExportPanel';
import { type CullMode } from './ModeSwitch';
import TriagePanel from './TriagePanel';

/**
 * Cull — one tool, two halves of the same job. **Triage** the photos and clips
 * selected in the library (rate 1–5, flag picks/rejects, filter to the keepers),
 * then **Export** the keepers straight into an album folder on disk. The verdict
 * lives in the shared library, so the two halves act on the very same picks; the
 * Triage/Export switch (rendered inside each panel) flips between them.
 */
export default function CullTool() {
  const [mode, setMode] = useState<CullMode>('triage');

  return mode === 'triage' ? (
    <TriagePanel mode={mode} onModeChange={setMode} />
  ) : (
    <ExportPanel mode={mode} onModeChange={setMode} />
  );
}
