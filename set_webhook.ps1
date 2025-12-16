param(
  [Parameter(Mandatory = $true)]
  [string]$PublicBaseUrl
)

$token = $env:TELEGRAM_BOT_TOKEN
$secret = $env:TELEGRAM_WEBHOOK_SECRET

if (-not $token) {
  throw "Missing env TELEGRAM_BOT_TOKEN"
}
if (-not $secret) {
  throw "Missing env TELEGRAM_WEBHOOK_SECRET"
}

$public = $PublicBaseUrl.TrimEnd('/')
$webhookUrl = "$public/telegram/webhook"

Write-Host "Setting webhook to: $webhookUrl"
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/setWebhook" `
  -Method Post -ContentType "application/json" `
  -Body (@{
    url = $webhookUrl
    secret_token = $secret
  } | ConvertTo-Json)

Write-Host "`nCurrent webhook info:"
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo"
