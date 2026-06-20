param(
  [Parameter(Mandatory = $true)]
  [string]$Binary,

  [Parameter(Mandatory = $true)]
  [string]$User,

  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [Parameter(Mandatory = $true)]
  [string]$RemoteBinary,

  [Parameter(Mandatory = $true)]
  [string]$TargetEnvironment,

  [Parameter(Mandatory = $true)]
  [string]$DeploymentId,

  [string]$ScpCommand = "scp",
  [string]$SshCommand = "ssh"
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot/deploy-tools.ps1"

$scp = Resolve-DeployTool -Command $ScpCommand -ExecutableName "scp.exe"
$ssh = Resolve-DeployTool -Command $SshCommand -ExecutableName "ssh.exe"
$binaryPath = (Resolve-Path -LiteralPath $Binary).Path
$target = "${User}@${HostName}:$RemoteBinary"
$remote = "${User}@${HostName}"
$deployCommand = "deploy-jena $TargetEnvironment $RemoteBinary $DeploymentId"

& $scp $binaryPath $target
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& $ssh $remote $deployCommand
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
