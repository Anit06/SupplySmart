$ErrorActionPreference = "Stop"

$serviceToken = $env:JAVA_SERVICE_TOKEN
if ([string]::IsNullOrWhiteSpace($serviceToken)) {
    throw "Set JAVA_SERVICE_TOKEN to the same generated secret configured for Node. The value was not displayed."
}

if ($serviceToken -notmatch '^[A-Za-z0-9_-]{1,128}$') {
    throw "JAVA_SERVICE_TOKEN must be an unpadded Base64URL secret containing at least 32 decoded bytes. The value was not displayed."
}

$base64Token = $serviceToken.Replace('-', '+').Replace('_', '/')
switch ($base64Token.Length % 4) {
    1 { throw "JAVA_SERVICE_TOKEN is malformed Base64URL. The value was not displayed." }
    2 { $base64Token += '==' }
    3 { $base64Token += '=' }
}

try {
    $tokenBytes = [Convert]::FromBase64String($base64Token)
} catch {
    throw "JAVA_SERVICE_TOKEN is malformed Base64URL. The value was not displayed."
}

$canonicalToken = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
if ($tokenBytes.Length -lt 32 -or $canonicalToken -cne $serviceToken) {
    throw "JAVA_SERVICE_TOKEN must be a canonical Base64URL secret containing at least 32 decoded bytes. The value was not displayed."
}

$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$backendEnvPath = Join-Path $repositoryRoot "backend-node\.env"
$mongoUri = $env:MONGO_URI
if ([string]::IsNullOrWhiteSpace($mongoUri) -and -not (Test-Path -LiteralPath $backendEnvPath)) {
    throw "backend-node\.env is required. Copy backend-node\.env.example to that ignored path and configure MONGO_URI."
}

if ([string]::IsNullOrWhiteSpace($mongoUri)) {
    foreach ($line in [System.IO.File]::ReadLines($backendEnvPath)) {
        if ($line -match '^\s*MONGO_URI\s*=\s*(.*)$') {
            $mongoUri = $Matches[1].Trim()
            $isDoubleQuoted = $mongoUri.StartsWith('"') -and $mongoUri.EndsWith('"')
            $isSingleQuoted = $mongoUri.StartsWith("'") -and $mongoUri.EndsWith("'")
            if ($isDoubleQuoted -or $isSingleQuoted) {
                $mongoUri = $mongoUri.Substring(1, $mongoUri.Length - 2)
            } else {
                $mongoUri = ($mongoUri -split '\s+#', 2)[0].Trim()
            }
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($mongoUri) -or $mongoUri -notmatch '^mongodb(\+srv)?://' -or $mongoUri -notmatch '^mongodb(\+srv)?://[^/]+/[^?]+') {
    throw "MONGO_URI is missing or invalid in backend-node\.env. The URI value was not displayed."
}

$env:MONGODB_URI = $mongoUri
$previousInventoryToken = $env:INVENTORY_SERVICE_TOKEN
$env:INVENTORY_SERVICE_TOKEN = $serviceToken
Set-Location (Split-Path -Parent $PSScriptRoot)
try {
    & mvn spring-boot:run
    $mavenExitCode = $LASTEXITCODE
} finally {
    $env:INVENTORY_SERVICE_TOKEN = $previousInventoryToken
}
exit $mavenExitCode
