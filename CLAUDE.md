# Working on Fincas

## Shipping

**Finished work goes live without being asked.** Develop on a branch, then merge
to `main` and push — that is the whole deploy: `.github/workflows/deploy.yml`
builds on every push to `main` and force-pushes `dist/` to `gh-pages`. Do not
stop at "pushed the branch" and wait for permission to merge; a change that
builds and does what was asked is a change that ships. Say what went live, and
check the run went green rather than assuming it did.

Verify before merging, because nothing sits between `main` and the live site:

```
npm ci        # once per container
npm run build # tsc -b && vite build — both must pass
```

There is no test runner. For logic changes under `src/lib`, bundle the touched
modules and run the cases through node rather than reasoning about them on
paper:

```
npx esbuild scratch/check.ts --bundle --format=esm --platform=node \
  --outfile=scratch/check.mjs && node scratch/check.mjs
```

## The shape of the thing

Everything is derived; nothing is stored twice. Pot balances come from
transaction allocations, event spend from tagged transactions, month totals from
both — so when two screens disagree the fix is almost never a new stored field.
`src/lib/types.ts` carries the reasoning for each field; read it first.

Comments here explain *why*, and often name the wrong behaviour they replaced.
Match that: a comment that only restates the code is worse than none.
