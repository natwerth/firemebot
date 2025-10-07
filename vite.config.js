// vite.config.js
export default {
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/roast': {
        target: 'http://localhost:8787',   // Wrangler worker
        changeOrigin: true
      }
    }
  }
}