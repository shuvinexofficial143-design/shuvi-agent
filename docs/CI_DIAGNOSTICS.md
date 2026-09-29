# GitHub Actions zero-step diagnostic

## Confirmed evidence

The repository workflow is parsed and GitHub creates both jobs, but the hosted runner is never allocated.

Most recent confirmed run before this document:
- run: `36439647113`
- head: `d46be1980186f60728589c673d7c63c68b6c7cae`
- `frontend`: `ubuntu-latest`, `runner_id=0`, `runner_name=""`, `steps=[]`
- `rust`: `windows-latest`, `runner_id=0`, `runner_name=""`, `steps=[]`
- no workflow artifacts were created

This means no checkout, Node command, Cargo command, repository script, or source test started in that run. Do not classify this as a source/test failure.

## What is and is not established

Established:
- the YAML is accepted far enough for GitHub to create both jobs;
- both Linux and Windows hosted jobs fail before step execution;
- changing repository test commands cannot by itself prove or repair runner allocation;
- source test status for these commits remains unknown until a runner or another real machine executes the commands.

Not established:
- the exact account/repository cause. The available GitHub connector cannot read sensitive billing/account Actions settings, so do not label the cause as billing, spending limit, payment failure, or Actions policy without direct UI/API evidence.

## Manual account/repository checks

In GitHub, inspect the repository/account settings for:
1. Actions availability/permissions for the private repository.
2. Hosted-runner availability for the account.
3. Any account notice about Actions usage, billing, spending limits, payment state, or disabled workflows.
4. Any organization/enterprise policy if the repository is later moved under an organization.

After changing an account/repository setting, re-run one failed workflow job and inspect the raw jobs response. The blocker is cleared only when the job has a nonzero runner identity and populated steps.

## Verification commands once compute is available

Frontend:
`npm ci`
`npm run verify:frontend`

Rust:
`npm run verify:rust`

Full local/server verification:
`npm ci`
`npm run verify:full`

Each attested command writes a schema-v3 commit-bound JSON receipt under `.shuvi-attest/`. The receipt records Git HEAD before and after the command set, requires those SHAs to remain identical for `passed=true`, records clean tracked+untracked worktree state before and after, plus platform, command exit codes and output tails. It is an execution record, not a cryptographic signature and not Premiere runtime evidence.

## Truthfulness rule

A commit is not reported as test-passed merely because:
- tests exist in source,
- a prior commit passed locally,
- a workflow run is marked completed,
- a job object exists,
- or static source inspection looks correct.

Only an actually executed, successful command set bound to the same commit may be reported as passing.
