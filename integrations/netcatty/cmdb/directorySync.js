export const DIRECTORY_CHANGE_KEY = 'netcatty:cmdb-directory-changed'

export function broadcastDirectoryChange(bridge) {
  bridge?.notifySettingsChanged?.({ key: DIRECTORY_CHANGE_KEY, value: Date.now() })
}

export function listenDirectoryChanges(bridge, onChange) {
  return bridge?.onSettingsChanged?.((payload) => {
    if (payload?.key === DIRECTORY_CHANGE_KEY) onChange()
  }) || (() => {})
}
