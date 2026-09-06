export const IPC = {
  projects: {
    list: 'cerebro:projects:list',
    create: 'cerebro:projects:create',
    createFromDirectory: 'cerebro:projects:create-from-directory',
    pickDirectory: 'cerebro:projects:pick-directory',
    listBranches: 'cerebro:projects:list-branches',
    remove: 'cerebro:projects:remove',
    /** Sent by the main process when an external source (CLI) mutates the DB. */
    invalidate: 'cerebro:projects:list:invalidate'
  },
  workspaces: {
    setActive: 'cerebro:workspaces:set-active',
    create: 'cerebro:workspaces:create',
    remove: 'cerebro:workspaces:remove'
  },
  settings: {
    get: 'cerebro:settings:get',
    set: 'cerebro:settings:set',
    pickDirectory: 'cerebro:settings:pick-directory'
  },
  native: {
    runCommand: 'cerebro:native:run-command'
  },
  keybinds: {
    /** Main → renderer: File › Close menu item (no accelerator). */
    menuClose: 'cerebro:keybinds:menu-close'
  },
  github: {
    getStatus: 'cerebro:github:get-status',
    beginDeviceFlow: 'cerebro:github:begin-device-flow',
    cancelDeviceFlow: 'cerebro:github:cancel-device-flow',
    disconnect: 'cerebro:github:disconnect',
    status: 'cerebro:github:status'
  },
  shell: {
    openExternal: 'cerebro:shell:open-external'
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
