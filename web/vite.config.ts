import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// presets/ lives at the repo root, outside web/
export default defineConfig({ plugins: [react()], server: { port: 5173, fs: { allow: ['..'] } } });
