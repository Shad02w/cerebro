export const IPC = {
  chat: {
    command: 'cerebro:chat:command',
    catalog: 'cerebro:chat:catalog',
    favorite: 'cerebro:chat:favorite',
    changed: 'cerebro:chat:changed'
  },
  cli: {
    status: 'cerebro:cli:status',
    install: 'cerebro:cli:install',
    remove: 'cerebro:cli:remove'
  },
  layout: {
    get: 'cerebro:layout:get',
    paneState: 'cerebro:layout:pane-state',
    focusWorkspace: 'cerebro:layout:focus-workspace',
    command: 'cerebro:layout:command',
    changed: 'cerebro:layout:changed',
    measure: 'cerebro:layout:measure'
  },
  repositories: {
    workspaces: 'cerebro:repositories:workspaces',
    pullRequests: 'cerebro:repositories:pull-requests'
  },
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
    remove: 'cerebro:workspaces:remove',
    listChanges: 'cerebro:workspaces:list-changes',
    getFileDiff: 'cerebro:workspaces:get-file-diff'
  },
  settings: {
    get: 'cerebro:settings:get',
    set: 'cerebro:settings:set',
    pickDirectory: 'cerebro:settings:pick-directory'
  },
  native: {
    focus: 'cerebro:native:focus',
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
    ack: 'cerebro:pty:ack',
    restart: 'cerebro:pty:restart',
    write: 'cerebro:pty:write',
    resize: 'cerebro:pty:resize',
    kill: 'cerebro:pty:kill',
    data: 'cerebro:pty:data',
    exit: 'cerebro:pty:exit'
  }
} as const
