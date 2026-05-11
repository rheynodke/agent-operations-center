import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import mdx from "@mdx-js/rollup"
import remarkGfm from "remark-gfm"
import remarkFrontmatter from "remark-frontmatter"
import remarkMdxFrontmatter from "remark-mdx-frontmatter"
import rehypeSlug from "rehype-slug"
import rehypePrettyCode from "rehype-pretty-code"
import withToc from "@stefanprobst/rehype-extract-toc"
import withTocExport from "@stefanprobst/rehype-extract-toc/mdx"
import { defineConfig } from "vite"
import { Agent } from "node:http"

// Reuse TCP connections to avoid TIME_WAIT port exhaustion in dev
const keepAliveAgent = new Agent({ keepAlive: true, maxSockets: 20 })

export default defineConfig({
  plugins: [
    {
      enforce: "pre",
      ...mdx({
        jsxImportSource: "react",
        providerImportSource: "@mdx-js/react",
        remarkPlugins: [
          remarkGfm,
          remarkFrontmatter,
          [remarkMdxFrontmatter, { name: "frontmatter" }],
        ],
        rehypePlugins: [
          rehypeSlug,
          [rehypePrettyCode, {
            theme: { dark: "github-dark", light: "github-light" },
            keepBackground: false,
          }],
          withToc,
          [withTocExport, { name: "toc" }],
        ],
      }),
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api/ai/generate": {
        target: "http://127.0.0.1:18800",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.pipe(res, { end: true })
            }
          })
        },
      },
      "/api": {
        target: "http://127.0.0.1:18800",
        changeOrigin: true,
        agent: keepAliveAgent,
      },
      "/ws": {
        target: "ws://127.0.0.1:18800",
        ws: true,
        changeOrigin: true,
      },
      "/embed": {
        target: "http://127.0.0.1:18800",
        changeOrigin: true,
        agent: keepAliveAgent,
      },
    },
  },
})
