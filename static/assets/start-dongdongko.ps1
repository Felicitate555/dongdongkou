$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$ddkFolder=Join-Path $env:LOCALAPPDATA 'DongDongKo'
$ddkApp=Join-Path $ddkFolder 'app'
$ddkPython=Join-Path $ddkFolder 'venv\Scripts\python.exe'
$ddkAddress='http://127.0.0.1:8787/console.html'
function Open-RunningHelper {
    try {$ddkHealth=Invoke-RestMethod 'http://127.0.0.1:8787/api/health' -TimeoutSec 2;if($ddkHealth.deployment_mode -eq 'local' -and $ddkHealth.app -eq '动动口'){Start-Process $ddkAddress;return $true}}catch{}
    return $false
}
if(Open-RunningHelper){exit 0}
New-Item -ItemType Directory -Path $ddkFolder -Force | Out-Null
Write-Host 'Preparing DongDongKo. First launch downloads the app and Python dependencies.'
if(-not(Test-Path -LiteralPath (Join-Path $ddkApp 'run.py'))){
    $ddkArchive=Join-Path $ddkFolder 'helper.zip'
    Invoke-WebRequest -UseBasicParsing 'https://dongdongko.fun/assets/dongdongko-windows-helper.zip' -OutFile $ddkArchive -TimeoutSec 180
    Expand-Archive -LiteralPath $ddkArchive -DestinationPath $ddkApp -Force
}
if(-not(Test-Path -LiteralPath $ddkPython)){
    $ddkSystemPython=Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\python.exe'
    if(Test-Path -LiteralPath $ddkSystemPython){& $ddkSystemPython -m venv (Join-Path $ddkFolder 'venv')}
    elseif(Get-Command py -ErrorAction SilentlyContinue){& py -3.11 -m venv (Join-Path $ddkFolder 'venv')}
    if(-not(Test-Path -LiteralPath $ddkPython)){Write-Host 'Install Python 3.11, then double-click the launcher again.';Start-Process 'https://www.python.org/downloads/windows/';exit 1}
}
$ddkReady=Join-Path $ddkFolder 'dependencies.ready'
if(-not(Test-Path -LiteralPath $ddkReady)){
    & $ddkPython -m pip install -r (Join-Path $ddkApp 'requirements.txt') --disable-pip-version-check
    if($LASTEXITCODE -ne 0){throw 'Dependency installation failed. Run the launcher again to retry.'}
    Set-Content -LiteralPath $ddkReady -Value 'ready'
}
$env:DDK_DEPLOYMENT_MODE='local';$env:DDK_SYSTEM_CONTROL='0'
Start-Process -FilePath $ddkPython -ArgumentList ('"'+(Join-Path $ddkApp 'run.py')+'"') -WorkingDirectory $ddkApp -WindowStyle Hidden -RedirectStandardOutput (Join-Path $ddkFolder 'server.log') -RedirectStandardError (Join-Path $ddkFolder 'server-error.log')
for($ddkAttempt=0;$ddkAttempt -lt 90;$ddkAttempt++){if(Open-RunningHelper){exit 0};Start-Sleep -Seconds 1}
throw 'The local service did not start. See server-error.log in LocalAppData\DongDongKo.'
