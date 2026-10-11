# Shuvi Windows Live Test Gate — staging only

This READ-ONLY readiness check is not a live acceptance test. It never runs
Windows apps, Premiere, Blender or any AI provider request, and does not
install or modify software, credentials, projects, files or deployment settings.

## On an authorized Windows device
1. Open PowerShell in a clean Shuvi Git checkout on the staging branch
   phase1/safety-reconciliation-oct9, never the protected branches.
2. Run this read-only check with the latest 13/13 CI-verified Git SHA:
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-live-readiness.ps1 -ExpectedSha <CI_VERIFIED_SHA>
3. Review git_head, clean_worktree, expected_sha_matched, toolchain and
   existing_processes. This is only prerequisite discovery, not certification.
4. Never start paid provider or Adobe mutation testing without explicit user
   permission and a disposable fixture. Keep exact-SHA evidence.

## Separately approved Windows host acceptance
Only when permitted: Shuvi native launch and idle UI health; non-metered local
Ollama chat on loopback; read-only window enumeration; approval-gated tools;
Premiere and Blender read-only discovery followed by disposable project tests
after permission. An interrupted external action remains outcome unknown unless
real completion/termination evidence proves otherwise.

An offline remote-controlled device prevents live acceptance. Passing GitHub CI
or this probe is not production-ready evidence. No production deployment, Vercel
preview, protected branch merge or paid AI call is authorized here.
