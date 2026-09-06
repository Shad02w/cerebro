// Matches BrowserWindow trafficLightPosition in src/main/index.ts.
export const TRAFFIC_LIGHT_Y = 16
export const TRAFFIC_LIGHT_SIZE = 12
/** Height that vertically centers the 12px traffic lights (y=16). Tailwind `h-11`. */
export const TITLEBAR_HEIGHT = TRAFFIC_LIGHT_Y * 2 + TRAFFIC_LIGHT_SIZE
export const TITLEBAR_TRIGGER_LEFT = 78
export const TITLEBAR_TRIGGER_SIZE = 24
export const TITLEBAR_TRIGGER_GAP = 8

/** Content-area chrome starts after the traffic lights and sidebar trigger. */
export const TITLEBAR_COLLAPSED_INSET_LEFT =
  TITLEBAR_TRIGGER_LEFT + TITLEBAR_TRIGGER_SIZE + TITLEBAR_TRIGGER_GAP

