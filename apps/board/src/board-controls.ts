/**
 * board-controls.ts: the Board's Controls row (Req 13). The logic is the skeleton's shared
 * `mountInputControls` (`@planchette/skeleton/ui`); this file passes the Board's strings and keeps
 * the names the Board's code and tests use. See the skeleton's input-controls.ts for the behaviour.
 */
import { mountInputControls, type ControlsHost, type InputControls } from '@planchette/skeleton/ui';
import { messages } from './messages.js';
export type { ControlsHost };
export interface BoardControlsOptions {
  readonly host: ControlsHost;
  readonly document: Document;
  /** Called after a mode change and after a calibration run ends. */
  readonly saveProfile: () => void;
  /** True when no saved Profile existed at load: shows the first-run hint. Default false. */
  readonly firstRun?: boolean;
}
export type BoardControls = InputControls;
export function mountBoardControls({ host, document, saveProfile, firstRun }: BoardControlsOptions): BoardControls {
  return mountInputControls({
    host,
    document,
    saveProfile,
    text: messages.controls,
    ...(firstRun === undefined ? {} : { firstRun }),
  });
}
