import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { collect, dailyCounts, findGelRun, gelFromRecord, median, percentile, reposPath, resolveOrg, sdlcFlags, summarizeRuns, totals, workflowStats } from "./collect.mjs";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const run = (workflow_id, name, conclusion, status = "completed", day = "2026-11-12") => ({
	workflow_id,
	name,
	conclusion,
	status,
	html_url: `https://x/${workflow_id}`,
	run_started_at: `${day}T10:00:00Z`,
	updated_at: `${day}T10:03:00Z`,
	head_sha: "abcdef123",
});

test("summarizeRuns keeps the newest completed run per workflow and counts only pass/fail runs", () => {
	const s = summarizeRuns([
		run(1, "CI", null, "in_progress"),
		run(1, "CI", "failure"),
		run(1, "CI", "success"),
		run(2, "Site", "success"),
		run(2, "Site", "cancelled"),
		run(3, "Lint", "skipped"),
	], NOW);
	assert.equal(s.red, 1);
	assert.deepEqual(
		s.workflows.map((w) => [w.name, w.conclusion]),
		[["CI", "failure"], ["Lint", "skipped"], ["Site", "success"]],
	);
	assert.equal(s.runs, 3);
	assert.equal(s.passRate, 66.7);
	assert.equal(s.medianMinutes, 3);
	assert.equal(s.ciMinutes, 15);
	assert.deepEqual(s.conclusions, { failure: 1, success: 2, cancelled: 1, skipped: 1 });
	assert.deepEqual(s.days.at(-1), { d: "2026-11-12", pass: 2, fail: 1 });
	const ci = s.workflows[0];
	assert.equal(ci.runs, 2);
	assert.equal(ci.passRate, 50);
	assert.equal(ci.recent, "sf");
	assert.equal(ci.flips, 1);
	assert.equal(ci.flaky, false);
});

test("summarizeRuns with no runs has no pass rate", () => {
	const s = summarizeRuns([], NOW);
	assert.equal(s.passRate, null);
	assert.equal(s.medianMinutes, null);
	assert.equal(s.days.length, 14);
	assert.ok(s.days.every((d) => d.pass === 0 && d.fail === 0));
});

test("totals weights pass rate by runs", () => {
	const t = totals([
		{ workflows: [{ flaky: true }], red: 1, runs: 10, passRate: 50, openPRs: 2, ciMinutes: 7 },
		{ workflows: [{}, {}], red: 0, runs: 30, passRate: 100, openPRs: 0, ciMinutes: 3 },
		{ workflows: [], red: 0, runs: 0, passRate: null, openPRs: 1 },
	]);
	assert.deepEqual(t, { repos: 3, workflows: 3, red: 1, redRepos: 1, passRate: 87.5, openPRs: 3, runs: 40, ciMinutes: 10, flaky: 1, sdlcReady: 0, gelRepos: 0, gelFindings: 0, gelBlocked: 0 });
});

test("median handles even, odd and empty", () => {
	assert.equal(median([3, 1, 2]), 2);
	assert.equal(median([1, 2, 3, 4]), 2.5);
	assert.equal(median([null]), null);
});

test("workflowStats flags a workflow that flips between pass and red as flaky", () => {
	// newest first: f s f s s -> in run order s s f s f: three flips
	const w = workflowStats(["failure", "success", "failure", "success", "success"].map((c) => run(1, "E2E", c)));
	assert.equal(w.flips, 3);
	assert.equal(w.flaky, true);
	assert.equal(w.passRate, 60);
	assert.equal(w.recent, "ssfsf");
	const steady = workflowStats(["failure", "failure", "success", "cancelled", "success"].map((c) => run(1, "E2E", c)));
	assert.equal(steady.flips, 1);
	assert.equal(steady.flaky, false);
	assert.equal(steady.recent, "scsff");
});

test("dailyCounts buckets runs into the last 14 UTC days and drops older ones", () => {
	const days = dailyCounts([run(1, "CI", "success", "completed", "2026-11-10"), run(1, "CI", "timed_out", "completed", "2026-11-10"), run(1, "CI", "success", "completed", "2026-10-01")], NOW);
	assert.equal(days.length, 14);
	assert.equal(days[0].d, "2026-10-30");
	assert.deepEqual(days.find((d) => d.d === "2026-11-10"), { d: "2026-11-10", pass: 1, fail: 1 });
	assert.equal(days.reduce((n, d) => n + d.pass + d.fail, 0), 2);
});

test("percentile picks the nearest-rank value", () => {
	assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
	assert.equal(percentile([4], 90), 4);
	assert.equal(percentile([], 90), null);
});

test("sdlcFlags reads the harness files from the root folder and CI from the workflow count", () => {
	assert.deepEqual(sdlcFlags(["README.md", "AGENTS.md", ".claude"], 2), { agents: true, claude: false, settings: true, ci: true, gel: false, score: 3 });
	assert.equal(sdlcFlags([], 0).score, 0);
	assert.deepEqual(sdlcFlags(["AGENTS.md", "CLAUDE.md", ".claude"], 1, true), { agents: true, claude: true, settings: true, ci: true, gel: true, score: 5 });
});

const REC = { ts: "t", repo: "x", sha: "s", event: "pull_request", lane: "B", laneReason: "r", needsPerson: true, files: 3, results: [{ guard: "a", level: "block", pass: false, findings: 2 }, { guard: "b", level: "report", pass: true, findings: 4 }], blocked: ["a"], ms: 900 };
const GRUN = { html_url: "https://x/gel", updated_at: "2026-11-12T10:03:00Z" };

test("gelFromRecord takes the last JSON line and keeps the lane, blocked guards and per-guard findings", () => {
	const g = gelFromRecord(`${JSON.stringify({ ...REC, lane: "A" })}\n${JSON.stringify(REC)}\n`, GRUN);
	assert.deepEqual(g, {
		installed: true, runUrl: "https://x/gel", at: GRUN.updated_at, lane: "B", needsPerson: true, blocked: ["a"], ms: 900,
		guards: [{ guard: "a", level: "block", pass: false, findings: 2 }, { guard: "b", level: "report", pass: true, findings: 4 }],
	});
});

test("gelFromRecord never throws: garbage, empty and missing records become installed with record null", () => {
	for (const bad of ["not json", "", null, undefined, "[1]", "{"]) {
		assert.deepEqual(gelFromRecord(bad, GRUN), { installed: true, runUrl: GRUN.html_url, at: GRUN.updated_at, record: null });
	}
	assert.deepEqual(gelFromRecord('{"lane":"C"}', GRUN).blocked, []);
});

test("findGelRun picks the newest completed run named GEL or ending in /gel.yml", () => {
	const runs = [
		{ id: 1, name: "GEL", status: "in_progress" },
		{ id: 2, name: "CI", status: "completed" },
		{ id: 3, name: "Guards", path: ".github/workflows/gel.yml", status: "completed" },
		{ id: 4, name: "GEL", status: "completed" },
	];
	assert.equal(findGelRun(runs).id, 3);
	assert.equal(findGelRun(runs.slice(0, 2)), undefined);
	assert.equal(findGelRun([{ id: 9, name: "GEL dogfood", status: "completed" }]).id, 9);
	assert.equal(findGelRun([{ id: 8, name: "GELATO", status: "completed" }]), undefined);
});

test("totals counts GEL repos, failing-guard findings and repos blocked, and tolerates repos without gel", () => {
	const base = { workflows: [], red: 0, runs: 0, passRate: null, openPRs: 0 };
	const t = totals([
		{ ...base, sdlc: { score: 5 }, gel: gelFromRecord(JSON.stringify(REC), GRUN) },
		{ ...base, sdlc: { score: 4 }, gel: { installed: true, record: null } },
		{ ...base, gel: { installed: false } },
		{ ...base },
	]);
	assert.equal(t.gelRepos, 2);
	assert.equal(t.gelFindings, 2);
	assert.equal(t.gelBlocked, 1);
	assert.equal(t.sdlcReady, 1);
});

test("summarizeRuns reports p95 next to the median", () => {
	const s = summarizeRuns([run(1, "CI", "success"), run(1, "CI", "success")], NOW);
	assert.equal(s.p95Minutes, 3);
	assert.equal(summarizeRuns([], NOW).p95Minutes, null);
});

test("resolveOrg prefers CILYTICS_ORG, then the Actions repo owner, then flisk-sh", () => {
	assert.equal(resolveOrg({ CILYTICS_ORG: "tldraw", GITHUB_REPOSITORY_OWNER: "me" }), "tldraw");
	assert.equal(resolveOrg({ CILYTICS_ORG: "", GITHUB_REPOSITORY_OWNER: "me" }), "me");
	assert.equal(resolveOrg({}), "flisk-sh");
});

test("reposPath lists an organization's public repos and a user's own repos", () => {
	assert.equal(reposPath("Organization", "tldraw"), "/orgs/tldraw/repos?type=public&sort=pushed");
	assert.equal(reposPath("User", "alice"), "/users/alice/repos?type=owner&sort=pushed");
});

// Runs collect() against a stubbed GitHub API and returns the data plus every path it asked for.
async function collectStubbed(account, type) {
	const paths = [];
	const real = globalThis.fetch;
	globalThis.fetch = async (url) => {
		const path = String(url).replace("https://api.github.com", "");
		paths.push(path);
		const json = (b) => new Response(JSON.stringify(b), { status: 200 });
		if (path === `/users/${account}`) return json({ type });
		if (path.includes("/repos?") && path.includes("page=1")) return json([{ name: "app", html_url: `https://github.com/${account}/app`, default_branch: "main", pushed_at: new Date().toISOString(), stargazers_count: 1, archived: false, fork: false }]);
		if (path.includes("/actions/runs?")) return json({ workflow_runs: [] });
		if (path.includes("/contents/")) return json([{ name: "AGENTS.md" }]);
		return json([]);
	};
	try {
		return { data: await collect(Date.now(), account, Infinity), paths };
	} finally {
		globalThis.fetch = real;
	}
}

test("collect reads the account it is given, whether an organization or a user", async () => {
	const o = await collectStubbed("tldraw", "Organization");
	assert.equal(o.data.org, "tldraw");
	assert.equal(o.data.ownerType, "Organization");
	assert.ok(o.paths.some((p) => p.startsWith("/orgs/tldraw/repos")));
	assert.ok(o.paths.some((p) => p.startsWith("/repos/tldraw/app/actions/runs")));
	assert.ok(o.paths.every((p) => !p.includes("flisk-sh")));
	const u = await collectStubbed("alice", "User");
	assert.equal(u.data.org, "alice");
	assert.equal(u.data.ownerType, "User");
	assert.ok(u.paths.some((p) => p.startsWith("/users/alice/repos")));
	assert.ok(u.paths.every((p) => !p.includes("/orgs/") && !p.includes("flisk-sh")));
	assert.equal(u.data.repos[0].sdlc.agents, true);
});

test("the page takes its title and header from the org in the data, not from fixed text", () => {
	const html = readFileSync(new URL("../../checks/index.html", import.meta.url), "utf8");
	const orgText = new Function(`${html.split("/*org-text*/")[1].split("/*end-org-text*/")[0]}; return orgText;`)();
	const t = orgText("tldraw");
	assert.equal(t.title, "Cilytics · tldraw CI");
	assert.match(t.sub, /tldraw/);
	assert.match(t.intro, /Every active public repository of tldraw/);
	assert.equal(orgText(undefined), null); // old snapshots without an org keep the static text
	assert.ok(!html.slice(0, html.indexOf("<script>\n(() =>")).includes("flisk-sh CI"), "no fixed org name in the static title or header");
});
