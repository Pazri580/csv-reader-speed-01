// The program the harness runs: node /bot/main.ts (node22). It reads every
// case from /input/cases.json, answers each one alone with run() from
// solve.js, and writes /output/answers.json: a JSON array of the answers,
// one per case and in the cases' order. Outside a container,
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Turn V8's incremental marking off before solve.js is loaded, so all of
// its work runs under that setting (the house baseline is timed the same
// way, and an entry may tune V8's flags too).
setFlagsFromString('--no-incremental-marking');

// solve.js is a plain .js module, so it is loaded by URL and typed here
// by the contract it keeps: run takes one case's input and returns its
// answer.
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const answers: unknown[] = [];
for (const c of cases) {
  answers.push(run(c.input));
}

writeFileSync(join(outDir, 'answers.json'), JSON.stringify(answers));
