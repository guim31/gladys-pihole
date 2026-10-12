// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// The blocking switch is already a Gladys scene action ("control a device"),
// but it cannot say for how long, nor reach every server at once. These two
// can: pause one Pi-hole or all of them for a number of minutes (0: until
// resumed), and resume. Gladys applies the field defaults to scene actions.
// -----------------------------------------------------------------------------

import { DEFAULT_PAUSE_MINUTES, parseMinutes } from './hub.js';

export const SCENE_ACTIONS = {
  async pause_blocking(hub, { fields = {} }) {
    const minutes = parseMinutes(fields.minutes, DEFAULT_PAUSE_MINUTES);
    const servers = await hub.pause(fields.device || null, minutes);
    return { servers, minutes };
  },

  async resume_blocking(hub, { fields = {} }) {
    const servers = await hub.resume(fields.device || null);
    return { servers };
  },
};
