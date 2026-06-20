param(
  [Parameter(Mandatory = $true)]
  [string]$User,

  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [string]$SshCommand = "ssh"
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot/deploy-tools.ps1"

$ssh = Resolve-DeployTool -Command $SshCommand -ExecutableName "ssh.exe"
$remote = "${User}@${HostName}"

& $ssh $remote "promote-jena"
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
