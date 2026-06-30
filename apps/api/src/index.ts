import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveStatic, websocket } from 'hono/bun'
import app from './app'
import { embeddedStatic } from './embedded-static'
import { getEngine } from './engines/issue'
import {
  stopPeriodicReconciliation,
} from './engines/reconciler'
import { initLauncher, registerUpgradeShutdown } from './launcher-init'
import { logger } from './logger'
import { releasePidLock } from './pid-lock'
import { APP_DIR, ROOT_DIR } from './root'
import { printStartupBanner } from './startup-banner'
import { staticAssets } from './static-assets'
import { stopPeriodicCheck } from './upgrade/service'

const listenHost = process.env.HOST ?? '0.0.0.0'
const listenPort = Number(process.env.PORT ?? 3000)

// --- Static file serving ---
if (staticAssets.size > 0) {
  app.use('*', embeddedStatic(staticAssets))
  logger.info({ assets: staticAssets.size }, 'embedded_static_loaded')
} else {
  const staticRoot = APP_DIR ? resolve(APP_DIR, 'public') : resolve(ROOT_DIR, 'apps/frontend/dist')
  if (existsSync(staticRoot)) {
    app.use(
      '/assets/*',
      serveStatic({
        root: staticRoot,
        onFound: (_path, c) => {
          c.header('Cache-Control', 'public, max-age=31536000, immutable')
        },
      }),
    )

    // Serve PWA manifest with CORS headers to prevent auth-proxy CORS errors
    app.get('/manifest.webmanifest', async (c) => {
      const manifestPath = resolve(staticRoot, 'manifest.webmanifest')
      if (!existsSync(manifestPath)) return c.notFound()
      const file = Bun.file(manifestPath)
      return new Response(file, {
        headers: {
          'Content-Type': 'application/manifest+json',
          'Cache-Control': 'public, max-age=3600, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        },
      })
    })

    app.use(
      '*',
      serveStatic({
        root: staticRoot,
        onFound: (path, c) => {
          if (path === 'index.html') {
            c.header('Cache-Control', 'no-cache')
          } else {
            c.header('Cache-Control', 'public, max-age=3600, must-revalidate')
          }
        },
      }),
    )

    const indexHtml = resolve(staticRoot, 'index.html')
    if (existsSync(indexHtml)) {
      app.use('*', async (c, next) => {
        if (c.req.path.startsWith('/api/')) return next()
        if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
        return new Response(Bun.file(indexHtml), {
          headers: {
            'Content-Type': 'text/html;charset=utf-8',
            'Cache-Control': 'no-cache',
          },
        })
      })
    }
  }
}

const http = Bun.serve({
  port: listenPort,
  hostname: listenHost,
  idleTimeout: 60,
  maxRequestBodySize: 1024 * 1024 * 1024 + 16 * 1024 * 1024, // 1040 MB
  fetch: app.fetch,
  websocket,
})

printStartupBanner(listenHost, listenPort)

const stops = initLauncher()
registerUpgradeShutdown(stops, http)

let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn({ signal }, 'server_shutdown_forced')
    process.exit(1)
  }
  isShuttingDown = true

  const engine = getEngine()
  const activeProcesses = engine.getActiveProcesses()
  logger.warn(
    {
      signal,
      activeProcessCount: activeProcesses.length,
      activeIssues: activeProcesses.map(p => p.issueId),
      uptimeSeconds: Math.round(process.uptime()),
    },
    'server_shutdown',
  )

  stops.stopCron()
  stopPeriodicCheck()
  stops.stopChangesSummaryWatcher()
  stops.stopSettledReconciliation()
  stopPeriodicReconciliation()
  stops.stopDeliveryCleanup()
  stops.stopCockpitDigestBridge()

  await engine.cancelAll()

  http.stop()
  releasePidLock()
  logger.info('server_stopped')
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
