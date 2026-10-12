$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$testAccounts=@{}
foreach($testRole in @('organizer','author','reviewer','participant')) {
 $testEmail=Read-Host "Email tai khoan thu $testRole"
 $testSecret=Read-Host "Mat khau $testRole" -AsSecureString
 $testPassword=[System.Net.NetworkCredential]::new('', $testSecret).Password
 $testAccounts[$testRole]=@{email=$testEmail;password=$testPassword}
}
New-Item -ItemType Directory -Path '.local' -Force | Out-Null
$testAccounts | ConvertTo-Json | Set-Content -LiteralPath '.local/live-test-accounts.json' -Encoding utf8
Remove-Variable testAccounts,testPassword,testSecret
Write-Host 'Da luu tai khoan thu trong .local (git ignored). Khong gui file nay vao chat.'
