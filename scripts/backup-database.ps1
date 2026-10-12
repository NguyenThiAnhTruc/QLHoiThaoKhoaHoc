param([string]$PostgresBin='C:\Program Files\PostgreSQL\17\bin')
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$dumpTool=Join-Path $PostgresBin 'pg_dump.exe'
$restoreTool=Join-Path $PostgresBin 'pg_restore.exe'
if(!(Test-Path -LiteralPath $dumpTool) -or !(Test-Path -LiteralPath $restoreTool)){throw 'Can pg_dump va pg_restore tu PostgreSQL client tools. Khong tao backup gia.'}
if(!$env:DATABASE_URL){throw 'Can DATABASE_URL trong moi truong server.'}
$databaseUri=[Uri]$env:DATABASE_URL
$databaseCredentials=$databaseUri.UserInfo.Split(':',2)
$backupEnvironment=@{}
foreach($backupVariable in @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE')){$backupEnvironment[$backupVariable]=[Environment]::GetEnvironmentVariable($backupVariable,'Process')}
try {
 $env:PGHOST=$databaseUri.Host
 $env:PGPORT=if($databaseUri.Port -gt 0){$databaseUri.Port.ToString()}else{'5432'}
 $env:PGUSER=[Uri]::UnescapeDataString($databaseCredentials[0])
 $env:PGPASSWORD=if($databaseCredentials.Length -gt 1){[Uri]::UnescapeDataString($databaseCredentials[1])}else{''}
 $env:PGDATABASE=[Uri]::UnescapeDataString($databaseUri.AbsolutePath.TrimStart('/'))
 $env:PGSSLMODE='require'
 if($databaseUri.Query -match '(?:[?&])sslmode=([a-z-]+)'){$env:PGSSLMODE=$Matches[1]}
 $backupDirectory=Join-Path (Get-Location) '.local\backups'
 New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
 $backupFile=Join-Path $backupDirectory ('database-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.dump')
 & $dumpTool --format=custom --no-owner --no-privileges --file=$backupFile
 if($LASTEXITCODE -ne 0){throw 'Backup that bai; khong su dung file do dang.'}
 & $restoreTool --list $backupFile | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Backup khong doc duoc.'}
 $backupHash=(Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash
 @{file=(Split-Path -Leaf $backupFile);sha256=$backupHash;created_at=(Get-Date).ToUniversalTime().ToString('o');includes_storage_bytes=$false} | ConvertTo-Json | Set-Content -LiteralPath ($backupFile+'.json')
 Write-Host "Da tao va kiem tra archive: $backupFile. Can luu file Storage rieng va thu restore vao database tach biet."
} finally {
 foreach($backupVariable in $backupEnvironment.Keys){[Environment]::SetEnvironmentVariable($backupVariable,$backupEnvironment[$backupVariable],'Process')}
 Remove-Variable databaseCredentials
}
