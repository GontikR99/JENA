function Resolve-DeployTool {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,

    [Parameter(Mandatory = $true)]
    [string]$ExecutableName
  )

  $candidates = New-Object System.Collections.Generic.List[string]

  if ($Command.Trim().Length -gt 0) {
    $candidates.Add($Command)

    $resolvedCommand = Get-Command $Command -ErrorAction SilentlyContinue
    if ($resolvedCommand -and $resolvedCommand.Source) {
      $candidates.Add($resolvedCommand.Source)
    }
  }

  $windowsDirectory = $env:WINDIR
  if (!$windowsDirectory) {
    $windowsDirectory = "C:\Windows"
  }

  $candidates.Add((Join-Path $windowsDirectory "System32\OpenSSH\$ExecutableName"))
  $candidates.Add((Join-Path $windowsDirectory "Sysnative\OpenSSH\$ExecutableName"))

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $searched = ($candidates | Select-Object -Unique) -join ", "
  throw "Unable to find $ExecutableName. Set DEPLOY_SCP or DEPLOY_SSH in deploy.local.mk. Searched: $searched"
}
