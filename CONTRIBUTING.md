# Contributing

Thanks for looking. This is a small, deliberately boring tool, and the bar
for changes is mostly about not making it less boring.

## What is most useful

**A reference document it reads wrong.** This is the highest-value
contribution by a distance. DocFacts infers a document's interface from its
formatting, and formatting varies more than anyone expects. A run against six
real projects once produced seven defects, all of them in the reader.

If you have documentation it mishandles, open an issue with the smallest
excerpt that reproduces it and what you expected. A real document beats a
synthetic one every time.

**A false finding** — a report of something your reference *does* support —
is a bug of the worst kind, because a tool that flags correct work is quickly
and correctly ignored. These get priority over missed findings.

## Working on it

```sh
npm install
npm test
npm run typecheck
npm run build
```

Node 20 or newer. There are no other dependencies and none will be added
lightly: zero dependencies is a feature, not an accident.

## House style

- **Tests come with the change.** Reductions from the document that caused
  the problem, with the project named, so the reason survives.
- **Both directions.** A test that something is caught should sit beside a
  test that correct input is not. A checker that rejects everything passes
  every negative test and is worthless.
- **Say why in the code.** Comments explain the reasoning, especially the
  non-obvious trade-offs — several heuristics here are deliberately narrow
  because a wider version produced false findings on real documentation, and
  that is exactly what a future reader needs to know before widening them.

## What will not be merged

- Network calls, telemetry, or analytics of any kind.
- Anything that executes document contents.
- Dependencies, barring a very good reason.
- A claim that output is guaranteed accurate. It is not, and the README says
  so at length.
