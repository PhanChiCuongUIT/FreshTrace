$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$context = Join-Path $repoRoot "docker\edge-runtime-jsr-workaround"
$sourceImage = "public.ecr.aws/supabase/edge-runtime:v1.74.0"
$patchedImage = "freshtrace/edge-runtime:v1.74.0-npm-jose"

Write-Host "Building the FreshTrace Edge Runtime workaround..."
docker build --pull=false --tag $patchedImage $context
if ($LASTEXITCODE -ne 0) {
  throw "Could not build the patched Edge Runtime image."
}

docker tag $patchedImage $sourceImage
if ($LASTEXITCODE -ne 0) {
  throw "Could not tag the patched Edge Runtime image."
}

Write-Host "Patched $sourceImage to use npm:jose instead of jsr:@panva/jose."
Write-Host "Run: npm run backend:functions"
