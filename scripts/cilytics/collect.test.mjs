import assert from "node:assert/strict";
import { test } from "node:test";
import { median, summarizeRuns, totals } from "./collect.mjs";

const run = (workflow_id, name, conclusion, status = "completed") => ({
	workflow_id,
	name,
	conclusion,
	status,
	html_url: `https://x/${workflow_id}`,
	run_started_at: "2026-11-12T10:00:00Z",
	updated_at: "2026-11-12T10:03:00Z",
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
	]);
	assert.equal(s.red, 1);
	assert.deepEqual(
		s.workflows.map((w) => [w.name, w.conclusion]),
		[["CI", "failure"], ["Lint", "skipped"], ["Site", "success"]],
	);
	assert.equal(s.runs, 3);
	assert.equal(s.passRate, 66.7);
	assert.equal(s.medianMinutes, 3);
});

test("summarizeRuns with no runs has no pass rate", () => {
	assert.deepEqual(summarizeRuns([]), { workflows: [], red: 0, runs: 0, passRate: null, medianMinutes: null });
});

test("totals weights pass rate by runs", () => {
	const t = totals([
		{ workflows: [{}], red: 1, runs: 10, passRate: 50, openPRs: 2 },
		{ workflows: [{}, {}], red: 0, runs: 30, passRate: 100, openPRs: 0 },
		{ workflows: [], red: 0, runs: 0, passRate: null, openPRs: 1 },
	]);
	assert.deepEqual(t, { repos: 3, workflows: 3, red: 1, redRepos: 1, passRate: 87.5, openPRs: 3 });
});

test("median handles even, odd and empty", () => {
	assert.equal(median([3, 1, 2]), 2);
	assert.equal(median([1, 2, 3, 4]), 2.5);
	assert.equal(median([null]), null);
});
