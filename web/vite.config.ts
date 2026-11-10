import { defineConfig } from 'vitest/config';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS in dev so an iPhone on the same Wi-Fi can open the camera (getUserMedia needs a secure context).
// NO_SSL=1 serves plain http (localhost is still a secure context) for the headless checks.
export default defineConfig(({ command }) => ({
  base: './',
  plugins: command === 'serve' && !process.env.NO_SSL ? [basicSsl()] : [],
  server: { host: true },
  build: { target: 'es2020' },
  test: { environment: 'node' },
}));
