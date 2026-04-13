Param(
  [string]$Backend = "http://localhost:3000",
  [string]$Email = "admin@local",
  [string]$Password = "741852963",
  [string]$Username = "korn666",
  [int]$Topup = 250000
)

$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$loginRes = Invoke-RestMethod -Uri "$Backend/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
if (-not $loginRes.token) {
  Write-Output "Login failed"
  exit 1
}
$token = $loginRes.token
$payload = @{ username = $Username; topup = $Topup } | ConvertTo-Json
$keyRes = Invoke-RestMethod -Uri "$Backend/api/admin/enterprise/api-key" -Method Post -Headers @{ Authorization = "Bearer $token" } -Body $payload -ContentType "application/json"
Write-Output ("API Key: {0}" -f $keyRes.fullKey)
