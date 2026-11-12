// Cilytics collector: a deterministic snapshot of CI across the flisk-sh org, for checks/index.html.
//
//   GITHUB_TOKEN=... node scripts/cilytics/collect.mjs --out data.json [--scores scores.json] [--history history.json]
//
// For every public, non-archived, non-fork repo pushed in the last 90 days it reads the last 100 workflow runs on the
// default branch (pull-request runs excluded) and keeps, per workflow, the newest completed run. A workflow is red when
// that run failed or timed out. Pass rate counts success against failure and timed_out only; cancelled, skipped and
// neutral runs are left out. No model, no guessing: the same API answers give the same file.
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const ORG = process.env.CILYTICS_ORG || "flisk-sh";
const ACTIVE_DAYS = 90;
const RED = new Set(["failure", "timed_out", "startup_failure"]);
const COUNTED = new Set(["success", "failure", "timed_out", "startup_failure"]);
const HISTORY_MAX = 24 * 45; // hourly points for 45 days

async function gh(path) {
	const res = await fetch(`https://api.github.com${path}`, {
		headers: {
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
			...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
		},
	});
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
	return res.json();
}

async function ghAll(path) {
	const out = [];
	for (let page = 1; page <= 10; page++) {
		const sep = path.includes("?") ? "&" : "?";
		const batch = await gh(`${path}${sep}per_page=100&page=${page}`);
		out.push(...batch);
		if (batch.length < 100) break;
	}
	return out;
}

const minutes = (run) => {
	const start = Date.parse(run.run_started_at || run.created_at);
	const end = Date.parse(run.updated_at);
	return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 600) / 100 : null;
};

export function median(values) {
	const v = values.filter((x) => x !== null).sort((a, b) => a - b);
	if (!v.length) return null;
	const m = Math.floor(v.length / 2);
	return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 100) / 100;
}

const DAYS = 14; // per-repo daily pass/fail bars
const RECENT = 20; // per-workflow outcome strip

// One letter per run for the outcome strip: s success, f red, c cancelled, - anything else.
const letter = (c) => (c === "success" ? "s" : RED.has(c) ? "f" : c === "cancelled" ? "c" : "-");

export function percentile(values, p) {
	const v = values.filter((x) => x !== null).sort((a, b) => a - b);
	if (!v.length) return null;
	return v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
}

// Pure: one workflow's completed runs (newest first) -> pass rate, durations, outcome strip and flakiness.
// A flip is a pass followed by a red run or the other way round, in run order; cancelled and skipped runs are ignored.
// A workflow is flaky when it flipped at least three times in its window.
export function workflowStats(runs) {
	const counted = runs.filter((r) => COUNTED.has(r.conclusion));
	const pass = counted.filter((r) => r.conclusion === "success").length;
	const order = counted.map((r) => r.conclusion === "success").reverse();
	let flips = 0;
	for (let i = 1; i < order.length; i++) if (order[i] !== order[i - 1]) flips++;
	const mins = runs.map(minutes);
	return {
		runs: counted.length,
		passRate: counted.length ? Math.round((pass / counted.length) * 1000) / 10 : null,
		medianMinutes: median(mins),
		p90Minutes: percentile(mins, 90),
		flips,
		flaky: flips >= 3,
		recent: runs
			.slice(0, RECENT)
			.reverse()
			.map((r) => letter(r.conclusion))
			.join(""),
	};
}

// Pure: completed runs -> the last DAYS UTC days, oldest first, with pass and red counts per day.
export function dailyCounts(runs, now) {
	const day = (t) => new Date(t).toISOString().slice(0, 10);
	const days = Array.from({ length: DAYS }, (_, i) => ({ d: day(now - (DAYS - 1 - i) * 86400e3), pass: 0, fail: 0 }));
	const at = new Map(days.map((x) => [x.d, x]));
	for (const r of runs) {
		const slot = at.get(day(Date.parse(r.run_started_at || r.created_at)));
		if (!slot) continue;
		if (r.conclusion === "success") slot.pass++;
		else if (RED.has(r.conclusion)) slot.fail++;
	}
	return days;
}

// Pure: runs (newest first, as the API returns them) -> per-workflow latest state and repo totals.
export function summarizeRuns(runs, now = Date.now()) {
	const done = runs.filter((r) => r.status === "completed");
	const byWorkflow = new Map();
	for (const run of done) {
		if (!byWorkflow.has(run.workflow_id)) byWorkflow.set(run.workflow_id, []);
		byWorkflow.get(run.workflow_id).push(run);
	}
	const workflows = [...byWorkflow.values()]
		.map((list) => {
			const run = list[0];
			return {
				name: run.name,
				conclusion: run.conclusion,
				red: RED.has(run.conclusion),
				url: run.html_url,
				at: run.updated_at,
				minutes: minutes(run),
				sha: run.head_sha?.slice(0, 7),
				...workflowStats(list),
			};
		})
		.sort((a, b) => Number(b.red) - Number(a.red) || a.name.localeCompare(b.name));
	const counted = done.filter((r) => COUNTED.has(r.conclusion));
	const pass = counted.filter((r) => r.conclusion === "success").length;
	const conclusions = {};
	for (const r of done) conclusions[r.conclusion] = (conclusions[r.conclusion] || 0) + 1;
	return {
		workflows,
		red: workflows.filter((w) => w.red).length,
		runs: counted.length,
		passRate: counted.length ? Math.round((pass / counted.length) * 1000) / 10 : null,
		medianMinutes: median(done.map(minutes)),
		ciMinutes: Math.round(done.reduce((n, r) => n + (minutes(r) ?? 0), 0)),
		conclusions,
		days: dailyCounts(done, now),
	};
}

export function totals(repos) {
	const runs = repos.reduce((n, r) => n + r.runs, 0);
	const passed = repos.reduce((n, r) => n + (r.passRate === null ? 0 : (r.passRate / 100) * r.runs), 0);
	return {
		repos: repos.length,
		workflows: repos.reduce((n, r) => n + r.workflows.length, 0),
		red: repos.reduce((n, r) => n + r.red, 0),
		redRepos: repos.filter((r) => r.red > 0).length,
		passRate: runs ? Math.round((passed / runs) * 1000) / 10 : null,
		openPRs: repos.reduce((n, r) => n + r.openPRs, 0),
		runs,
		ciMinutes: repos.reduce((n, r) => n + (r.ciMinutes ?? 0), 0),
		flaky: repos.reduce((n, r) => n + r.workflows.filter((w) => w.flaky).length, 0),
	};
}

async function collect(now) {
	const cutoff = now - ACTIVE_DAYS * 86400e3;
	const all = await ghAll(`/orgs/${ORG}/repos?type=public&sort=pushed`);
	const active = all.filter((r) => !r.archived && !r.fork && Date.parse(r.pushed_at) >= cutoff);
	const repos = [];
	for (const r of active) {
		const runs = (
			await gh(`/repos/${ORG}/${r.name}/actions/runs?branch=${encodeURIComponent(r.default_branch)}&per_page=100&exclude_pull_requests=true`)
		).workflow_runs;
		const prs = await ghAll(`/repos/${ORG}/${r.name}/pulls?state=open`);
		repos.push({
			name: r.name,
			url: r.html_url,
			defaultBranch: r.default_branch,
			pushedAt: r.pushed_at,
			stars: r.stargazers_count,
			openPRs: prs.length,
			...summarizeRuns(runs, now),
		});
	}
	repos.sort((a, b) => b.red - a.red || (a.passRate ?? 101) - (b.passRate ?? 101) || a.name.localeCompare(b.name));
	const skipped = all.length - active.length;
	return { org: ORG, generatedAt: new Date(now).toISOString(), activeDays: ACTIVE_DAYS, skipped, totals: totals(repos), repos };
}

const readJson = (file, fallback) => {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return fallback;
	}
};

if (import.meta.url === `file://${process.argv[1]}`) {
	const { values } = parseArgs({ options: { out: { type: "string" }, scores: { type: "string" }, history: { type: "string" } } });
	const data = await collect(Date.now());
	if (values.scores) {
		const rows = readJson(values.scores, []);
		data.scores = {
			repo: "flisk-sh/flisk",
			rows: rows.map(({ id, title, mode, unit, value, baseline, target, status, summary, better }) => ({
				id, title, mode, unit, value, baseline, target, status, summary, better,
			})),
		};
	}
	if (values.history) {
		const history = readJson(values.history, []);
		const t = data.totals;
		history.push({
			at: data.generatedAt,
			red: t.red,
			redRepos: t.redRepos,
			passRate: t.passRate,
			openPRs: t.openPRs,
			runs: t.runs,
			flaky: t.flaky,
			scoresFailing: data.scores ? data.scores.rows.filter((r) => ["fail", "error"].includes(r.status)).length : null,
		});
		writeFileSync(values.history, `${JSON.stringify(history.slice(-HISTORY_MAX))}\n`);
	}
	const json = `${JSON.stringify(data, null, 1)}\n`;
	if (values.out) writeFileSync(values.out, json);
	else process.stdout.write(json);
}
