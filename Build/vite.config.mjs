// vite.config.js
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ mode }) => {
  // Load environment variables
  const env = loadEnv(mode, process.cwd(), "");
  const isSingleFile = env.SINGLE_FILE === "true";

  return {
    base: '/LRCGetter/',
    plugins: [
      !isSingleFile && VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['robots.txt'],
        manifest: {
          name: 'LRCGetter',
          short_name: 'LRCGetter',
          start_url: '/LRCGetter/',
          scope: "/LRCGetter/",
          display: 'standalone',
          theme_color: '#00bfff',
          background_color: '#00bfff',
        },
        pwaAssets: {
          config:true,
        },
        workbox: {
          runtimeCaching: [
            {
              urlPattern: /.*\.(js|css|html)$/,
              handler: 'NetworkFirst',
              options: { cacheName: 'app-shell' },
            },
            {
              urlPattern: /.*\.(png|ico|json)$/,
              handler: 'CacheFirst',
              options: { cacheName: 'assets' },
            },
          ],
        },
      }),
      // Conditionally add the single file plugin
      isSingleFile && viteSingleFile(),
    ].filter(Boolean), // Removes 'false' values if not in single-file mode

    build: {
      sourcemap: !isSingleFile,
      outDir: './dist',
      emptyOutDir: true,
      inlineDynamicImports: true,
      chunkSizeWarningLimit: 1000,
    },
  }
});
