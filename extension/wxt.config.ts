import { defineConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ShopReply — Auto Reply AI for Facebook Messenger & Zalo',
    description: 'AI auto-reply for Facebook Messenger & Zalo. Detect questions, suggest answers from your Q&A database. 100% local, no cloud.',
    version: '1.1.0',
    permissions: ['storage', 'notifications', 'alarms'],
    host_permissions: [
      'https://www.facebook.com/*',
      'https://facebook.com/*',
      'https://chat.zalo.me/*',
      'http://localhost:3939/*'
    ]
  },
  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      minify: 'terser',
      terserOptions: {
        compress: { drop_console: false, drop_debugger: true },
        mangle: { toplevel: false },
      },
    },
  }),
})
