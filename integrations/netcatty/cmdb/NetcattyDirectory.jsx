import React, { createContext, useContext } from 'react'

const EMPTY = Object.freeze({ hosts: [], credentials: [], connectHost: () => { throw new Error('Netcatty 连接入口未初始化') }, createHost: async () => { throw new Error('Netcatty 主机保存不可用') }, createCredential: async () => { throw new Error('Netcatty 身份保存不可用') }, bindHostCredential: async () => { throw new Error('Netcatty 主机认证更新不可用') }, refreshDirectory: () => {}, readSwitch: async () => { throw new Error('Netcatty 交换机读取不可用') }, readHardware: async () => { throw new Error('Netcatty 硬件读取不可用') } })
const NetcattyDirectoryContext = createContext(EMPTY)

export function NetcattyDirectoryProvider({ value, children }) {
  return <NetcattyDirectoryContext.Provider value={value || EMPTY}>{children}</NetcattyDirectoryContext.Provider>
}

export function useNetcattyDirectory() {
  return useContext(NetcattyDirectoryContext)
}
