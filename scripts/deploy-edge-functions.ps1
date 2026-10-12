param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$frontendSettings = @{}
foreach ($line in Get-Content -LiteralPath '.env') {
    if ($line -match '^([A-Z_]+)=(.*)$') {
        $frontendSettings[$Matches[1]] = $Matches[2].Trim().Trim('"', "'")
    }
}
$projectHost = ([Uri]$frontendSettings['VITE_SUPABASE_URL']).Host
if ($projectHost -notmatch '^([a-z0-9]+)\.supabase\.co$') {
    throw 'Khong xac dinh duoc project Supabase tu .env.'
}
$projectRef = $Matches[1]
foreach ($asset in @('supabase/functions/post-seminar/index.ts', 'supabase/functions/post-seminar/assets/NotoSans-Regular.ttf', 'supabase/functions/post-seminar/assets/con-dau.png', 'supabase/functions/upload-cleanup/index.ts')) {
    if (!(Test-Path -LiteralPath $asset)) { throw "Thieu asset: $asset" }
}
Write-Host 'Source va assets cua hai Edge Functions da san sang.'
if ($CheckOnly) { return }
if (!$env:SUPABASE_ACCESS_TOKEN) {
    throw 'Thieu SUPABASE_ACCESS_TOKEN. Cau hinh token quan tri trong moi truong may; khong gui token vao chat.'
}
foreach ($functionName in @('post-seminar', 'upload-cleanup')) {
    & npx.cmd --yes supabase functions deploy $functionName --project-ref $projectRef --use-api
    if ($LASTEXITCODE -ne 0) { throw "Deploy $functionName that bai. Chua bat cron." }
}
Write-Host 'Da deploy hai functions. Can cau hinh secrets va kiem tra truoc khi bat cron.'
