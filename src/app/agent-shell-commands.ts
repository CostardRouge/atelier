import { commands } from '../shared/commands/registry';
import { contactSheetImage } from '../shared/commands/contact-sheet-image';
import { winnowCommands } from '../shared/sources/winnow/winnow-commands';
import { libraryCommands, type LibraryCommandDeps } from './library-commands';

/**
 * The shell's commands for FINDING media — the Library's and the connected
 * Winnow's — registered for the whole session once this module has loaded.
 * It is imported dynamically by `App`, so their code and their long
 * descriptions stay out of the entry chunk (`deployment.md`): an agent asks
 * for them a moment after the page opens, and `app.waitFor` covers that
 * moment like any tool's commands.
 *
 * `state` is read at call time, so every command sees the shell as it is.
 */
export function registerShellCommands(state: () => LibraryCommandDeps): () => void {
  const deps: LibraryCommandDeps = {
    lib: () => state().lib(),
    winnow: () => state().winnow(),
    actions: () => state().actions(),
  };
  const offLibrary = commands.register('library', libraryCommands(deps));
  const offWinnow = commands.register('winnow', winnowCommands({ winnow: deps.winnow, sheet: contactSheetImage }));
  return () => {
    offLibrary();
    offWinnow();
  };
}
