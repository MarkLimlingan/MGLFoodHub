// Copies the live menu and settings from Supabase into a MySQL file for
// Hostinger: hostinger/mysql/data.local.sql (import it after schema.sql).
// Photos the admin uploaded to Supabase Storage are downloaded into
// public/uploads (part of the build) and their links changed to /uploads/…
// Orders are not copied. Usage: npm run export:supabase
// Asks for an admin email and password (settings are admin only). Press
// Enter at the email to copy only the menu and keep the default settings.
import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'hostinger', 'mysql', 'data.local.sql')
const UPLOADS = path.join(root, 'public', 'uploads')

// Copied in this order so every reference already exists.
const TABLES = {
  hub_categories: ['id', 'name', 'slug', 'sort'],
  stores: ['id', 'slug', 'name', 'tagline', 'hub_category_id', 'open_time', 'close_time', 'address', 'contact_note', 'cover_image_url', 'menu_image_url', 'is_accepting_orders', 'sort'],
  menu_sections: ['id', 'store_id', 'name', 'note', 'sort'],
  products: ['id', 'store_id', 'section_id', 'name', 'description', 'badge', 'image_url', 'is_sold_out', 'sort'],
  product_variants: ['id', 'product_id', 'label', 'price', 'addon_price', 'is_sold_out', 'sort'],
  option_groups: ['id', 'product_id', 'name', 'is_required'],
  option_choices: ['id', 'group_id', 'label', 'price_delta', 'sort'],
}

function readEnv() {
  const env = {}
  const file = path.join(root, '.env')
  if (!existsSync(file)) return env
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return env
}

// One reader for every question: lines typed (or piped) before a question is
// asked are queued instead of lost.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) })
let muted = false
rl._writeToOutput = (s) => {
  if (!muted) rl.output.write(s)
}
const typed = []
const waiting = []
let inputClosed = false
rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : typed.push(line)))
rl.on('close', () => {
  inputClosed = true
  while (waiting.length) waiting.shift()('')
})

function ask(question, hidden = false) {
  rl.setPrompt(question)
  muted = false
  rl.prompt()
  muted = hidden // hide what is typed (the password)
  return new Promise((resolve) => {
    const done = (line) => {
      if (hidden) {
        muted = false
        rl.output.write('\n')
      }
      resolve(line.trim())
    }
    if (typed.length) done(typed.shift())
    else if (inputClosed) done('')
    else waiting.push(done)
  })
}

async function readAll(supabase, table) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').order(table === 'settings' ? 'key' : 'id').range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v === 'number') return String(v)
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return `'${s.replace(/[\\'\0\n\r\x1a]/g, (c) => ({ '\\': '\\\\', "'": "\\'", '\0': '\\0', '\n': '\\n', '\r': '\\r', '\x1a': '\\Z' })[c])}'`
}

function insert(table, columns, rows) {
  if (!rows.length) return ''
  const cols = columns.map((c) => `\`${c}\``).join(', ')
  const update = columns.filter((c) => c !== 'id' && c !== 'key').map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')
  let sql = ''
  for (let i = 0; i < rows.length; i += 100) {
    const values = rows.slice(i, i + 100).map((r) => `(${columns.map((c) => sqlValue(r[c])).join(', ')})`)
    sql += `INSERT INTO ${table} (${cols}) VALUES\n  ${values.join(',\n  ')}\nON DUPLICATE KEY UPDATE ${update};\n\n`
  }
  return sql
}

const env = readEnv()
const url = (process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env')
  process.exit(1)
}
const supabase = createClient(url, key, { auth: { persistSession: false } })

console.log(`Copying from ${url}`)
const email = await ask('Admin email (Enter to skip settings): ')
let settings = null
if (email) {
  const password = await ask('Admin password: ', true)
  console.log(`Signing in as ${email}…`)
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    console.error(`Could not sign in: ${error.message}`)
    process.exit(1)
  }
  settings = await readAll(supabase, 'settings')
  if (!settings.length) {
    console.error('Signed in, but no settings came back. Is this account an admin?')
    process.exit(1)
  }
}
rl.close()

const data = {}
for (const table of Object.keys(TABLES)) {
  data[table] = await readAll(supabase, table)
  console.log(`  ${table}: ${data[table].length}`)
}
if (settings) console.log(`  settings: ${settings.length}`)

// Photos uploaded through the admin live in Supabase Storage. Download them
// so the site no longer needs Supabase once it moves.
// Any Supabase project counts: some payment QR codes still live in the old one.
const PUBLIC = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/(.+)$/
const moved = new Map()
let failed = 0
async function localize(link) {
  const m = typeof link === 'string' ? link.match(PUBLIC) : null
  if (!m) return link
  if (moved.has(link)) return moved.get(link)
  const rel = decodeURIComponent(m[1].split(/[?#]/)[0])
  if (rel.split('/').some((p) => p === '..' || p === '')) return link
  const res = await fetch(link).catch(() => null)
  if (!res?.ok) {
    failed++
    console.warn(`  could not download ${link}`)
    return link
  }
  const file = path.join(UPLOADS, ...rel.split('/'))
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  const local = `/uploads/${rel}`
  moved.set(link, local)
  return local
}
for (const s of data.stores) {
  s.cover_image_url = await localize(s.cover_image_url)
  s.menu_image_url = await localize(s.menu_image_url)
}
for (const p of data.products) p.image_url = await localize(p.image_url)
for (const s of settings ?? []) {
  if (typeof s.value === 'string') s.value = await localize(s.value)
}
console.log(`  photos downloaded: ${moved.size}${failed ? `, failed: ${failed}` : ''}`)

let sql = `-- MGL Food Hub menu and settings, copied from Supabase on ${new Date().toISOString()}
-- by npm run export:supabase. Import after schema.sql. Safe to import again:
-- rows are updated, nothing is deleted.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

`
for (const [table, columns] of Object.entries(TABLES)) sql += insert(table, columns, data[table])
// Settings values are JSON in MySQL too, so "0917…" keeps its quotes.
if (settings) sql += insert('settings', ['key', 'value'], settings.map((s) => ({ key: s.key, value: JSON.stringify(s.value) })))
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, sql)
console.log(`\nSaved ${OUT}`)
if (!settings) console.log('Settings were skipped: the defaults from schema.sql will be used.')
process.exit(0)
