// Provider-aware pull request lookups. T3 owns the PR associations; this only
// refreshes the exact records T3 already links, so nothing is guessed from
// titles or branch names.
const sessionData = require('./session-data.cjs')

const GITHUB_HOSTS = ['github.com', 'www.github.com']

function bareHost(host) {
  return String(host || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.git$/, '')
}

// githubHosts covers GitHub Enterprise; github.com and its www alias are
// always treated as GitHub because their API path differs from Gitea's.
function providerFor(host, githubHosts = []) {
  const name = bareHost(host)
  const extra = (Array.isArray(githubHosts) ? githubHosts : []).map(bareHost)
  return GITHUB_HOSTS.includes(name) || extra.includes(name) ? 'github' : 'gitea'
}

// The pull request URL carries the scheme, so an intranet forge on plain HTTP
// keeps working. GitHub itself is always https.
function apiBase(repo, provider) {
  const target = typeof repo === 'string' ? { host: repo } : repo || {}
  const name = bareHost(target.host)
  const scheme = String(target.base || '').startsWith('http://') ? 'http' : 'https'
  if (provider !== 'github') return `${scheme}://${name}`
  return GITHUB_HOSTS.includes(name) ? 'https://api.github.com' : `${scheme}://${name}/api/v3`
}

function pathsFor(provider, repo) {
  const owner = encodeURIComponent(repo.owner), name = encodeURIComponent(repo.name)
  if (provider === 'github') return {
    list: `/repos/${owner}/${name}/pulls?state=all&per_page=50&sort=updated&direction=desc`,
    pull: number => `/repos/${owner}/${name}/pulls/${number}`,
    reviews: number => `/repos/${owner}/${name}/pulls/${number}/reviews?per_page=100`,
    status: sha => `/repos/${owner}/${name}/commits/${encodeURIComponent(sha)}/status`,
    checkRuns: sha => `/repos/${owner}/${name}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
  }
  return {
    list: `/api/v1/repos/${owner}/${name}/pulls?state=all&limit=50&sort=recentupdate`,
    pull: number => `/api/v1/repos/${owner}/${name}/pulls/${number}`,
    reviews: number => `/api/v1/repos/${owner}/${name}/pulls/${number}/reviews?limit=100`,
    status: sha => `/api/v1/repos/${owner}/${name}/commits/${encodeURIComponent(sha)}/status?limit=100`,
    checkRuns: null,
  }
}

// Tokens from the environment apply to any GitHub host, matching the gh CLI.
function environmentToken(env = process.env) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || ''
  return typeof token === 'string' && token.trim() ? token.trim() : null
}

function configuredToken(config = {}, host) {
  const tokens = config.tokens && typeof config.tokens === 'object' ? config.tokens : {}
  const wanted = bareHost(host)
  for (const [key, value] of Object.entries(tokens)) {
    if (bareHost(key) !== wanted) continue
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

// GitHub wants a bearer token; Gitea accepts either. A git credential helper
// entry still works for GitHub, where the password is the personal token.
function authHeaders(provider, auth) {
  if (!auth) return null
  const accept = provider === 'github' ? 'application/vnd.github+json' : 'application/json'
  if (auth.token) return provider === 'github'
    ? { authorization: `Bearer ${auth.token}`, accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'clankiosk' }
    : { authorization: `token ${auth.token}`, accept }
  if (auth.user && auth.pass) return { authorization: 'Basic ' + Buffer.from(`${auth.user}:${auth.pass}`).toString('base64'), accept }
  return null
}

// A credential helper entry for a GitHub host is only useful when the helper
// stores a token; an empty username (or "git") is normal for PAT storage.
function credentialIsToken(provider, credential) {
  if (!credential) return false
  if (provider !== 'github') return true
  return typeof credential.pass === 'string' && credential.pass.length > 0
}

// CI and review state for one pull request. GitHub splits app checks from
// legacy commit statuses; other forges report a single combined status.
async function enrich(repo, pr, paths, get, provider = 'gitea') {
  const [status, runs, reviews] = await Promise.allSettled([
    pr.headSha ? get(paths.status(pr.headSha)) : Promise.reject(new Error('No head SHA')),
    pr.headSha && paths.checkRuns ? get(paths.checkRuns(pr.headSha)) : Promise.resolve(null),
    get(paths.reviews(pr.number)),
  ])
  const statusBody = status.status === 'fulfilled' ? status.value : null
  const runsBody = runs.status === 'fulfilled' ? runs.value : null
  if (provider === 'github' && (statusBody || runsBody)) pr.ci = sessionData.normalizeCheckRuns(runsBody, statusBody)
  else if (statusBody) pr.ci = sessionData.normalizeChecks(statusBody)
  else if (!pr.ci) pr.ci = sessionData.normalizeChecks(null)
  if (reviews.status === 'fulfilled') pr.review = sessionData.normalizeReviews(reviews.value)
  else if (!pr.review) pr.review = 'unknown'
  return pr
}

// Refresh one repository. `wanted` holds the PR numbers T3 actually links, so
// enrichment never invents associations; `get(path)` performs the request.
async function collect(repo, options = {}) {
  const provider = repo.provider || 'gitea', paths = pathsFor(provider, repo)
  const get = options.get, now = options.now || Date.now()
  const listing = await get(paths.list)
  const raws = Array.isArray(listing) ? [...listing] : []
  const wanted = new Set([...(options.wanted || [])].map(Number))
  for (const number of [...wanted].filter(n => !raws.some(raw => Number(raw && raw.number) === n)).slice(0, 12)) {
    try { const raw = await get(paths.pull(number)); if (raw && raw.number) raws.push(raw) } catch {}
  }
  const byNumber = new Map(), byHead = new Map(), enrichments = []
  const prefix = `${bareHost(repo.host)}/${repo.owner}/${repo.name}`.toLowerCase()
  for (const raw of raws) {
    const pr = sessionData.normalizeForgePr(raw, repo, now), key = sessionData.prIdentity(pr)
    const previous = options.previous && options.previous.get(key)
    if (previous && previous.headSha === pr.headSha) { pr.ci = previous.ci; pr.review = previous.review }
    byNumber.set(key, pr)
    const branch = raw.head && raw.head.ref
    if (branch && !branch.startsWith('refs/pull/')) {
      const branchKey = `${prefix}:${branch}`, list = byHead.get(branchKey) || []
      list.push(pr); byHead.set(branchKey, list)
    }
    if (wanted.has(Number(pr.number))) enrichments.push(() => enrich(repo, pr, paths, get, provider))
  }
  return { byNumber, byHead, enrichments, paths, provider }
}

module.exports = { bareHost, providerFor, apiBase, pathsFor, environmentToken, configuredToken, authHeaders, credentialIsToken, enrich, collect }
