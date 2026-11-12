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

// Pure: runs (newest first, as the API returns them) -> per-workflow latest state and repo totals.
export function summarizeRuns(runs) {
	const latest = new Map();
	let pass = 0;
	let counted = 0;
	for (const run of runs) {
		if (run.status === "completed" && COUNTED.has(run.conclusion)) {
			counted++;
			if (run.conclusion === "success") pass++;
		}
		if (run.status !== "completed") continue;
		if (!latest.has(run.workflow_id))
			latest.set(run.workflow_id, {
				name: run.name,
				conclusion: run.conclusion,
				red: RED.has(run.conclusion),
				url: run.html_url,
				at: run.updated_at,
				minutes: minutes(run),
				sha: run.head_sha?.slice(0, 7),
			});
	}
	const workflows = [...latest.values()].sort((a, b) => Number(b.red) - Number(a.red) || a.name.localeCompare(b.name));
	return {
		workflows,
		red: workflows.filter((w) => w.red).length,
		runs: counted,
		passRate: counted ? Math.round((pass / counted) * 1000) / 10 : null,
		medianMinutes: median(runs.filter((r) => r.status === "completed").map(minutes)),
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
			...summarizeRuns(runs),
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
			scoresFailing: data.scores ? data.scores.rows.filter((r) => ["fail", "error"].includes(r.status)).length : null,
		});
		writeFileSync(values.history, `${JSON.stringify(history.slice(-HISTORY_MAX))}\n`);
	}
	const json = `${JSON.stringify(data, null, 1)}\n`;
	if (values.out) writeFileSync(values.out, json);
	else process.stdout.write(json);
}
