# One command per round trip.
#
# Claude can read and write every file in this repository but cannot run
# anything here. This script closes that gap: you run one command, it writes
# _last-run.txt, and Claude reads that file directly. Nothing needs pasting.
#
#   .\lnkz.ps1 status              what branch, what is dirty, what is ahead
#   .\lnkz.ps1 check               typecheck and test
#   .\lnkz.ps1 apply <patch> <br> [base]   new branch off base (default
#                                          origin/main), apply the patch, check
#   .\lnkz.ps1 commit "<message>"  stage everything and commit
#   .\lnkz.ps1 push                push the current branch and print the PR url
#
# Everything is appended to _last-run.txt, which is gitignored.

param(
  [Parameter(Position = 0)][string]$Command = "status",
  [Parameter(Position = 1)][string]$Arg1,
  [Parameter(Position = 2)][string]$Arg2,
  [Parameter(Position = 3)][string]$Arg3
)

$ErrorActionPreference = "Continue"
$log = Join-Path $PSScriptRoot "_last-run.txt"
$pnpm = "npx --yes pnpm@10.26.1"

"=== $Command $Arg1 $Arg2 $Arg3 ===" | Out-File $log -Encoding utf8
"$(Get-Date -Format o)" | Out-File $log -Append -Encoding utf8

# Write-Host rather than Tee-Object on purpose. Tee passes its input back into
# the pipeline, and anything a PowerShell function writes to the output stream
# becomes part of what that function returns. With Tee here, Run returned its
# own log lines alongside the exit code, so callers compared an array to 0.
# "(array) -ne 0" filters rather than compares, and a non-empty result is
# truthy, which made every failure check fire on success.
function Log($text) {
  $text | Out-File -FilePath $log -Append -Encoding utf8
  Write-Host $text
}

function Run($label, $script) {
  Log ""
  Log "--- $label ---"
  # 2>&1 so a compiler or test failure lands in the log rather than only on
  # screen, which is the whole point of writing this file.
  $output = & ([scriptblock]::Create($script)) 2>&1 | Out-String
  # Read it before anything else runs, and treat a cmdlet that sets nothing as
  # success, since $LASTEXITCODE only tracks native executables.
  $code = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  Log $output.TrimEnd()
  Log "exit: $code"
  return $code
}

Set-Location $PSScriptRoot

switch ($Command) {

  "status" {
    Run "branch" "git branch --show-current"
    Run "working tree" "git status --short"
    Run "ahead of origin/main" "git log --oneline origin/main..HEAD"
    Run "recent" "git log --oneline -5"
  }

  "check" {
    if ((Run "typecheck" "$pnpm typecheck") -ne 0) {
      Log ""
      Log "TYPECHECK FAILED. Stopping before tests, because the test build uses the same compiler."
      break
    }
    Run "test" "$pnpm test"
  }

  "apply" {
    if (-not $Arg1 -or -not $Arg2) {
      Log "usage: .\lnkz.ps1 apply <patch-file> <branch-name>"
      break
    }
    if (-not (Test-Path $Arg1)) {
      Log "No patch at $Arg1"
      break
    }
    # A patch is written against one tree. Branching off that same tree is what
    # keeps it applying, and keeps unrelated work in flight out of the commit,
    # which has bitten this repo before. Uncommitted files carry across the
    # branch switch and stay uncommitted: git am commits only the patch.
    $base = if ($Arg3) { $Arg3 } else { "origin/main" }
    Run "fetch" "git fetch origin"

    # A branch left over from an earlier run is not an error when it already
    # sits on the base the patch was written against: that is exactly the tree
    # the patch needs. Reuse it. Refuse only when it has moved somewhere else,
    # because applying there is how a patch lands on the wrong history.
    $existing = (git rev-parse --verify --quiet "refs/heads/$Arg2")
    if ($existing) {
      $baseSha = (git rev-parse --verify --quiet $base)
      if ($existing.Trim() -eq $baseSha.Trim()) {
        Log ""
        Log "$Arg2 already exists at $base. Reusing it."
        Run "switch to $Arg2" "git checkout $Arg2"
      } else {
        Log ""
        Log "$Arg2 exists but is not at $base. Delete it, or pass a different branch name."
        Run "where it is" "git log --oneline -1 $Arg2"
        break
      }
    } elseif ((Run "branch off $base" "git checkout -b $Arg2 $base") -ne 0) {
      Log ""
      Log "Could not create $Arg2 from $base. The working tree may have changes that would be overwritten."
      break
    }
    if ((Run "apply $Arg1" "git am `"$Arg1`"") -ne 0) {
      Log ""
      Log "The patch did not apply. Nothing was committed. 'git am --abort' returns you to a clean branch."
      break
    }
    if ((Run "typecheck" "$pnpm typecheck") -ne 0) { break }
    Run "test" "$pnpm test"
  }

  "commit" {
    if (-not $Arg1) {
      Log "usage: .\lnkz.ps1 commit `"<message>`""
      break
    }
    Run "stage" "git add -A"
    Run "staged" "git status --short"
    Run "commit" "git commit -m `"$Arg1`""
  }

  "push" {
    $branch = (git branch --show-current).Trim()
    Run "push $branch" "git push -u origin $branch"
    Log ""
    Log "https://github.com/nsirivolu27/LNKZ/pull/new/$branch"
  }

  default {
    Log "Unknown command: $Command"
    Log "Try: status, check, apply, commit, push"
  }
}

Log ""
Log "=== done, written to _last-run.txt ==="
