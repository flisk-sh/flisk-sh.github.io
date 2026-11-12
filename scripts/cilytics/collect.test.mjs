import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyCounts, median, percentile, summarizeRuns, totals, workflowStats } from "./collect.mjs";

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
	assert.deepEqual(t, { repos: 3, workflows: 3, red: 1, redRepos: 1, passRate: 87.5, openPRs: 3, runs: 40, ciMinutes: 10, flaky: 1 });
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
