import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import 'antd/dist/reset.css'
import './app.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#176b87',
          colorInfo: '#176b87',
          colorSuccess: '#2f855a',
          colorWarning: '#b7791f',
          colorError: '#c2414b',
          colorText: '#172333',
          colorTextSecondary: '#667386',
          colorBorder: '#dce3e9',
          borderRadius: 5,
          fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
          boxShadowSecondary: '0 14px 38px rgba(18, 32, 48, 0.14)',
        },
        components: {
          Button: { controlHeight: 34, primaryShadow: 'none', fontWeight: 600 },
          Input: { controlHeight: 36 },
          Select: { controlHeight: 36 },
          Table: { headerBg: '#f5f7f8', headerColor: '#455468', rowHoverBg: '#f1f8fa' },
          Card: { headerBg: '#ffffff' },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
