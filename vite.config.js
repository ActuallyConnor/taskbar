import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so dist/index.html loads over file:// in Electron
export default defineConfig({ plugins: [react()], base: './' })
