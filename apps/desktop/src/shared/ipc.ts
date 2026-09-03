export const IPC = {
  workspaces: {
    list: 'cerebro:workspaces:list',
    create: 'cerebro:workspaces:create',
    setActive: 'cerebro:workspaces:set-active'
  },
  settings: {
    get: 'cerebro:settings:get',
    set: 'cerebro:settings:set',
    pickDirectory: 'cerebro:settings:pick-directory'
  },
  github: {
    getStatus: 'cerebro:github:get-status',
    beginDeviceFlow: 'cerebro:github:begin-device-flow',
    cancelDeviceFlow: 'cerebro:github:cancel-device-flow',
    disconnect: 'cerebro:github:disconnect',
    status: 'cerebro:github:status'
  },
  pty: {
    open: 'cerebro:pty:open',
    write: 'cerebro:pty:write',
    resize: 'cerebro:pty:resize',
    kill: 'cerebro:pty:kill',
    data: 'cerebro:pty:data',
    exit: 'cerebro:pty:exit'
  }
} as const
