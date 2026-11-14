import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Every page on flisk-sh.github.io carries the Flisk Analytics script. The projects that share
// this domain (comparer, create-flisk, flisk-demo-animation) register the same data-domain.
const SNIPPET = '<script defer data-domain="flisk-sh.github.io" src="https://flisk.sh/a.js"></script>';

for (const page of ["index.html", "checks/index.html"]) {
	test(`${page} loads Flisk Analytics inside <head>`, () => {
		const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
		const head = html.slice(html.indexOf("<head"), html.indexOf("</head>"));
		assert.equal(head.split(SNIPPET).length - 1, 1);
	});
}
