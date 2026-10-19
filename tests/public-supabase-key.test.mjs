import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertPublicSupabaseKey } from '../build/public-supabase-key.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const marker = 'synthetic-only-not-a-project-credential'
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
function jwt(payload = { role: 'anon', iss: 'supabase', ref: 'synthetic-project' }, header = { alg: 'HS256', typ: 'JWT' }) {
  const unsigned = `${encode(header)}.${encode(payload)}`
  return `${unsigned}.${createHmac('sha256', marker).update(unsigned).digest('base64url')}`
}
const anon = jwt()
const publishable = 'sb_publishable_synthetic_only_abcdefghijklmnopqrstuvwxyz'
const serviceRole = jwt({ role: 'service_role', iss: 'supabase', ref: 'synthetic-project' })
const secret = 'sb_secret_synthetic_only_abcdefghijklmnopqrstuvwxyz'

for (const [name, key] of [['legacy anon', anon], ['modern publishable', publishable]]) {
  test(`guard accepts ${name}`, () => assert.doesNotThrow(() => assertPublicSupabaseKey(key)))
}

for (const [name, value] of [
  ['missing', undefined], ['null', null], ['empty', ''], ['number', 123],
  ['service role JWT', serviceRole], ['modern secret', secret],
  ['authenticated session JWT', jwt({ role: 'authenticated', sub: marker })],
  ['admin JWT', jwt({ role: 'admin' })], ['postgres JWT', jwt({ role: 'postgres' })],
  ['missing role', jwt({ iss: 'supabase' })], ['array role', jwt({ role: ['anon'] })],
  ['uppercase role', jwt({ role: 'ANON' })], ['blank role', jwt({ role: ' anon ' })],
  ['unknown opaque token', marker], ['old synthetic placeholder', 'synthetic-public-anon-key'],
  ['unknown sb key class', `sb_privileged_${marker}`], ['publishable without body', 'sb_publishable_'],
  ['malformed publishable', `${publishable}.secret`], ['quoted publishable', `"${publishable}"`],
  ['whitespace', ` ${anon}`], ['newline', `${publishable}\n`], ['bearer prefix', `Bearer ${anon}`],
  ['unsigned JWT', `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ role: 'anon' })}.`],
  ['wrong algorithm', jwt({ role: 'anon' }, { alg: 'none', typ: 'JWT' })],
  ['wrong token type', jwt({ role: 'anon' }, { alg: 'HS256', typ: 'OTHER' })],
  ['malformed payload', `${encode({ alg: 'HS256', typ: 'JWT' })}.not-json.${Buffer.alloc(32).toString('base64url')}`],
  ['array payload', jwt([{ role: 'anon' }])], ['truncated signature', `${anon.split('.').slice(0, 2).join('.')}.c2hvcnQ`],
  ['extra segment', `${anon}.more`], ['invalid base64url', `${anon}=`,], ['oversized', 'a'.repeat(8193)],
]) {
  test(`guard rejects ${name} without logging the candidate`, () => {
    assert.throws(() => assertPublicSupabaseKey(value), error => {
      assert.match(error.message, /Refusing to build/)
      if (typeof value === 'string' && value.length > 30) assert.ok(!error.message.includes(value))
      assert.ok(!error.message.includes(marker))
      return true
    })
  })
}

async function fixture(t) {
  const dir = await mkdtemp(join(root, 'tests/.key-guard-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'vite.config.mjs'), `export { default } from ${JSON.stringify(pathToFileURL(join(root, 'vite.config.js')).href)}\n`)
  for (const page of ['index', 'login', 'dashboard', 'upload', 'job-analyses', 'view-analysis']) {
    await writeFile(join(dir, `${page}.html`), '<html><body><script type="module" src="/entry.js"></script></body></html>')
  }
  await writeFile(join(dir, 'entry.js'), 'document.body.textContent = import.meta.env.VITE_SUPABASE_ANON_KEY;')
  return dir
}

function build(dir, value, mode = 'production') {
  const env = { PATH: process.env.PATH, NO_COLOR: '1', VITE_SUPABASE_URL: 'https://synthetic-project.supabase.co' }
  if (value !== undefined) env.VITE_SUPABASE_ANON_KEY = value
  return execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', mode], {
    cwd: dir, env, encoding: 'utf8', timeout: 30000, stdio: 'pipe',
  })
}

for (const [name, value] of [['service role', serviceRole], ['secret', secret], ['unknown', marker], ['missing', undefined]]) {
  test(`actual vite build rejects ${name} before creating output`, async t => {
    const dir = await fixture(t)
    assert.throws(() => build(dir, value), error => {
      assert.notEqual(error.status, 0)
      const output = `${error.stdout}${error.stderr}`
      assert.match(output, /Refusing to build/)
      if (value) assert.ok(!output.includes(value))
      assert.ok(!output.includes('transforming'))
      return true
    })
    assert.equal(existsSync(join(dir, 'dist')), false)
  })
}

for (const [name, value] of [['legacy anon', anon], ['publishable', publishable]]) {
  test(`actual vite build accepts ${name}`, async t => {
    const dir = await fixture(t)
    build(dir, value)
    const assets = await readdir(join(dir, 'dist/assets'))
    const bundles = await Promise.all(assets.filter(name => name.endsWith('.js')).map(name => readFile(join(dir, 'dist/assets', name), 'utf8')))
    assert.ok(bundles.some(source => source.includes(value)))
  })
}

test('guard checks mode-specific dotenv values, not only process.env', async t => {
  const dir = await fixture(t)
  await writeFile(join(dir, '.env'), `VITE_SUPABASE_ANON_KEY=${publishable}\n`)
  await writeFile(join(dir, '.env.preview'), `VITE_SUPABASE_ANON_KEY=${serviceRole}\n`)
  assert.throws(() => build(dir, undefined, 'preview'), error => {
    assert.match(`${error.stderr}`, /Refusing to build/)
    assert.ok(!`${error.stdout}${error.stderr}`.includes(serviceRole))
    return true
  })
  assert.equal(existsSync(join(dir, 'dist')), false)
})

test('process env wins over dotenv in both directions, matching Vite', async t => {
  const dir = await fixture(t)
  await writeFile(join(dir, '.env.production'), `VITE_SUPABASE_ANON_KEY=${publishable}\n`)
  assert.throws(() => build(dir, secret))
  assert.equal(existsSync(join(dir, 'dist')), false)
  await writeFile(join(dir, '.env.production'), `VITE_SUPABASE_ANON_KEY=${serviceRole}\n`)
  assert.doesNotThrow(() => build(dir, anon))
})
