const { test } = require('node:test')
const assert = require('node:assert/strict')
const forge = require('../electron/forge.cjs')
const { normalizeCheckRuns } = require('../electron/session-data.cjs')

test('GitHub hosts and enterprise overrides use the GitHub API shape', () => {
  assert.equal(forge.providerFor('github.com'), 'github')
  assert.equal(forge.providerFor('https://www.github.com/'), 'github')
  assert.equal(forge.providerFor('git.example.com'), 'gitea')
  assert.equal(forge.providerFor('github.example.com', ['github.example.com']), 'github')
  assert.equal(forge.apiBase('github.com', 'github'), 'https://api.github.com')
  assert.equal(forge.apiBase('github.example.com', 'github'), 'https://github.example.com/api/v3')
  assert.equal(forge.apiBase('git.example.com', 'gitea'), 'https://git.example.com')
  assert.equal(forge.apiBase({ host: 'git.intranet:3000', base: 'http://git.intranet:3000' }, 'gitea'), 'http://git.intranet:3000')
  assert.equal(forge.apiBase({ host: 'github.com', base: 'http://github.com' }, 'github'), 'https://api.github.com')
})

test('pull request paths differ per provider and escape the repository', () => {
  const repo = { host: 'github.com', owner: 'team', name: 'repo' }
  const github = forge.pathsFor('github', repo), gitea = forge.pathsFor('gitea', repo)
  assert.match(github.list, /^\/repos\/team\/repo\/pulls\?state=all&per_page=50/)
  assert.equal(github.pull(12), '/repos/team/repo/pulls/12')
  assert.equal(github.reviews(12), '/repos/team/repo/pulls/12/reviews?per_page=100')
  assert.equal(github.checkRuns('a b'), '/repos/team/repo/commits/a%20b/check-runs?per_page=100')
  assert.match(gitea.list, /^\/api\/v1\/repos\/team\/repo\/pulls\?/)
  assert.equal(gitea.checkRuns, null)
  assert.equal(forge.pathsFor('gitea', { owner: 'a/b', name: 'c' }).pull(1), '/api/v1/repos/a%2Fb/c/pulls/1')
})

test('tokens come from the environment or config without leaking blanks', () => {
  assert.equal(forge.environmentToken({}), null)
  assert.equal(forge.environmentToken({ GH_TOKEN: '  ' }), null)
  assert.equal(forge.environmentToken({ GH_TOKEN: 'a', GITHUB_TOKEN: 'b' }), 'a')
  assert.equal(forge.environmentToken({ GITHUB_TOKEN: 'b' }), 'b')
  assert.equal(forge.configuredToken({ tokens: { 'GitHub.com': 'x' } }, 'github.com'), 'x')
  assert.equal(forge.configuredToken({ tokens: { 'github.com': '   ' } }, 'github.com'), null)
  assert.equal(forge.configuredToken({ tokens: {} }, 'github.com'), null)
  assert.equal(forge.authHeaders('github', null), null)
})

test('GitHub authenticates with a bearer token, Gitea keeps token and basic auth', () => {
  const github = forge.authHeaders('github', { token: 'secret' })
  assert.equal(github.authorization, 'Bearer secret')
  assert.equal(github.accept, 'application/vnd.github+json')
  assert.equal(github['x-github-api-version'], '2022-11-28')
  assert.equal(forge.authHeaders('gitea', { token: 'secret' }).authorization, 'token secret')
  assert.equal(forge.authHeaders('gitea', { user: 'u', pass: 'p' }).authorization, 'Basic ' + Buffer.from('u:p').toString('base64'))
  assert.equal(forge.credentialIsToken('github', { user: '', pass: 'ghp_example' }), true)
  assert.equal(forge.credentialIsToken('github', null), false)
  assert.equal(forge.credentialIsToken('gitea', { user: 'u', pass: 'p' }), true)
})

test('GitHub check runs combine with legacy commit statuses', () => {
  const runs = { check_runs: [
    { name: 'build', status: 'completed', conclusion: 'success', started_at: '2026-09-30T10:00:00Z' },
    { name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-09-30T10:00:00Z' },
    { name: 'deploy', status: 'in_progress', conclusion: null, started_at: '2026-09-30T10:00:00Z' },
  ] }
  const failed = normalizeCheckRuns(runs, { total_count: 0, statuses: [] })
  assert.deepEqual([failed.state, failed.total, failed.failed], ['failure', 3, 1])
  const passing = normalizeCheckRuns({ check_runs: runs.check_runs.slice(0, 1) }, { total_count: 0, statuses: [] })
  assert.equal(passing.state, 'success')
  const pending = normalizeCheckRuns({ check_runs: runs.check_runs.slice(2) }, { total_count: 0, statuses: [] })
  assert.equal(pending.state, 'pending')
  const legacyFailure = normalizeCheckRuns({ check_runs: runs.check_runs.slice(0, 1) }, { total_count: 1, statuses: [{ context: 'ci', status: 'failure' }] })
  assert.deepEqual([legacyFailure.state, legacyFailure.failed], ['failure', 1])
  const duplicate = normalizeCheckRuns({ check_runs: [
    { name: 'build', status: 'completed', conclusion: 'success', started_at: '2026-09-30T11:00:00Z' },
    { name: 'build', status: 'completed', conclusion: 'failure', started_at: '2026-09-30T09:00:00Z' },
  ] }, null)
  assert.deepEqual([duplicate.state, duplicate.total], ['success', 1])
  assert.equal(normalizeCheckRuns({ check_runs: [] }, { total_count: 0, statuses: null }).state, 'none')
  assert.equal(normalizeCheckRuns(null, null).state, 'unknown')
})

test('only linked pull requests are enriched, and GitHub mixes both check sources', async () => {
  const repo = { host: 'github.com', owner: 'team', name: 'repo', provider: 'github', base: 'https://github.com' }
  const paths = forge.pathsFor('github', repo), seen = []
  const get = async (path) => {
    seen.push(path)
    if (path === paths.list) return [
      { number: 1, state: 'open', title: 'One', html_url: 'https://github.com/team/repo/pull/1', head: { ref: 'feature/one', sha: 'sha-one' } },
      { number: 2, draft: true, state: 'open', html_url: 'https://github.com/team/repo/pull/2', head: { ref: 'refs/pull/2/head', sha: 'sha-two' } },
      { number: 3, merged_at: '2026-09-30T09:00:00Z', html_url: 'https://github.com/team/repo/pull/3', head: { ref: 'feature/three', sha: 'sha-three' } },
    ]
    if (path === paths.status('sha-one')) return { total_count: 1, statuses: [{ context: 'legacy', status: 'success' }] }
    if (path === paths.checkRuns('sha-one')) return { check_runs: [{ name: 'build', status: 'completed', conclusion: 'failure' }] }
    if (path === paths.reviews(1)) return [{ user: { login: 'reviewer' }, state: 'APPROVED', submitted_at: '2026-09-30T10:00:00Z' }]
    throw new Error(`unexpected request ${path}`)
  }
  const result = await forge.collect(repo, { wanted: [1], get })
  assert.equal(result.byNumber.size, 3)
  assert.equal(result.enrichments.length, 1)
  assert.equal(result.byNumber.get('github.com/team/repo#3').state, 'merged')
  assert.deepEqual([...result.byHead.keys()], ['github.com/team/repo:feature/one', 'github.com/team/repo:feature/three'])
  await Promise.all(result.enrichments.map(run => run()))
  const pr = result.byNumber.get('github.com/team/repo#1')
  assert.deepEqual([pr.ci.state, pr.ci.failed, pr.ci.total], ['failure', 1, 2])
  assert.equal(pr.review, 'approved')
  assert.equal(seen.some(path => path.includes('sha-two') || path.includes('sha-three')), false)
})

test('linked pull requests missing from the listing are fetched, and fresh CI is reused', async () => {
  const repo = { host: 'git.example', owner: 'team', name: 'repo', provider: 'gitea', base: 'https://git.example' }
  const paths = forge.pathsFor('gitea', repo)
  const get = async (path) => {
    if (path === paths.list) return [{ number: 5, state: 'open', html_url: 'https://git.example/team/repo/pulls/5', head: { ref: 'main', sha: 'sha-5' } }]
    if (path === paths.pull(9)) return { number: 9, state: 'open', html_url: 'https://git.example/team/repo/pulls/9', head: { ref: 'topic', sha: 'sha-9' } }
    if (path === paths.status('sha-5')) return { total_count: 1, statuses: [{ context: 'ci', status: 'success' }] }
    if (path === paths.status('sha-9')) return { total_count: 1, statuses: [{ context: 'ci', status: 'failure' }] }
    if (path === paths.reviews(5) || path === paths.reviews(9)) return []
    throw new Error(`unexpected request ${path}`)
  }
  const previous = new Map([['git.example/team/repo#5', { headSha: 'sha-5', ci: { state: 'success', passed: 1, total: 1, failed: 0 }, review: 'approved' }]])
  const result = await forge.collect(repo, { wanted: [5, 9], get, previous })
  assert.equal(result.enrichments.length, 2)
  const five = result.byNumber.get('git.example/team/repo#5')
  assert.equal(five.ci.state, 'success')
  assert.equal(five.review, 'approved')
  assert.equal(result.byHead.get('git.example/team/repo:main').length, 1)
  await Promise.all(result.enrichments.map(run => run()))
  assert.equal(result.byNumber.get('git.example/team/repo#9').ci.state, 'failure')
  assert.equal(result.byNumber.get('git.example/team/repo#9').review, 'pending')
})
