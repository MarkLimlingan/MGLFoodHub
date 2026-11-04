// Runs the PHP API (public/api) on this computer for npm run dev (Vite sends
// /api and /uploads here). Uses hostinger/config.dev.php: a copy of
// hostinger/mgl-config.example.php pointing at a local MySQL/MariaDB database
// (e.g. XAMPP) with schema.sql and data.local.sql imported.
// Usage: npm run dev:api (PHP_BIN to use another PHP than XAMPP's).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = path.join(root, 'hostinger', 'config.dev.php')
const PHP = process.env.PHP_BIN || (process.platform === 'win32' ? 'C:\\xampp\\php\\php.exe' : 'php')

if (!existsSync(config)) {
  console.error(`Missing ${config}\nCopy hostinger/mgl-config.example.php to that name and point it at a local database.`)
  process.exit(1)
}
console.log('PHP API on http://127.0.0.1:8710 (npm run dev sends /api and /uploads here)')
spawn(PHP, ['-S', '127.0.0.1:8710', '-t', path.join(root, 'public'), path.join(root, 'scripts', 'dev-router.php')], {
  stdio: 'inherit',
  env: { ...process.env, MGL_API_CONFIG: config },
}).on('exit', (code) => process.exit(code ?? 0))
