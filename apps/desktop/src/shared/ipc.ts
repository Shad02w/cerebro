export const IPC = {
  workspaces: {
    list: 'cerebro:workspaces:list',
    create: 'cerebro:workspaces:create',
    setActive: 'cerebro:workspaces:set-active'
  },
  settings: {
    getCloneLocation: 'cerebro:settings:get-clone-location',
    setCloneLocation: 'cerebro:settings:set-clone-location',
    chooseCloneLocation: 'cerebro:settings:choose-clone-location'
  }
} as const
