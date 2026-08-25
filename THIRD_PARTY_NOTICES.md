# Third-party notices

Code in this repository derived from third-party work, with the attribution
that work's licence requires.

## MadsLorentzen/ai-job-search — MIT

`lib/job-seeker/board-search/` is adapted from the job-board search skills in
[MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search),
at commit `e2c311a5b40512daf79a04b22c96d7e049afc745`.

**What was taken.** The per-board request construction, retry policy shape, and
response parsing from `.agents/skills/<board>-search/cli/src` — specifically
`jobnet-search` and `jobindex-search`. The most substantial single piece is
Jobindex's `var Stash = {...}` extraction, including the finding that Jobindex
serves its results client-side and its `/jobsoegning.json` endpoint returns
204, which is recorded in `lib/job-seeker/board-search/jobindex.ts` where the
code that depends on it lives.

**What was not taken.** The `@bunli/core` CLI layer, the Python tooling, the
LaTeX CV and cover-letter templates, and the `linkedin-search` skill. The last
is deliberate and is explained in `lib/job-seeker/board-search/registry.ts`:
LinkedIn's terms prohibit automated collection, and the MIT licence on this
source governs whether the code may be copied, not whether that service may be
read this way.

**What changed.** The retry budget became a wall-clock deadline rather than a
fixed retry count, because the original's six retries at a 15s attempt timeout can
exceed a minute — correct for a CLI, wrong inside a request a person is
watching. Bare `Error` throws became typed `BoardSearchError`s carrying the
board that failed. The six duplicated fetch helpers became one.

The licence below applies to the original work and travels with these
derivatives.

```
MIT License

Copyright (c) 2026 Mads Lorentzen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
