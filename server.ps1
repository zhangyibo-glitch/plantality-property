param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$appRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$port = 8765
$address = [System.Net.IPAddress]::Loopback
$listener = [System.Net.Sockets.TcpListener]::new($address, $port)

function Get-ContentType([string]$path) {
    switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
        '.html' { return 'text/html; charset=utf-8' }
        '.css'  { return 'text/css; charset=utf-8' }
        '.js'   { return 'text/javascript; charset=utf-8' }
        '.png'  { return 'image/png' }
        '.jpg'  { return 'image/jpeg' }
        '.jpeg' { return 'image/jpeg' }
        '.webp' { return 'image/webp' }
        '.svg'  { return 'image/svg+xml' }
        '.json' { return 'application/json; charset=utf-8' }
        default { return 'application/octet-stream' }
    }
}

function Send-Response($stream, [int]$statusCode, [string]$statusText, [byte[]]$body, [string]$contentType) {
    $header = "HTTP/1.1 $statusCode $statusText`r`n" +
              "Content-Type: $contentType`r`n" +
              "Content-Length: $($body.Length)`r`n" +
              "Cache-Control: no-cache`r`n" +
              "Cross-Origin-Opener-Policy: same-origin`r`n" +
              "Cross-Origin-Embedder-Policy: require-corp`r`n" +
              "Connection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($body, 0, $body.Length)
    $stream.Flush()
}

try {
    $listener.Start()
} catch {
    if (-not $NoOpen) { Start-Process "http://127.0.0.1:$port/" }
    exit 0
}

if (-not $NoOpen) { Start-Process "http://127.0.0.1:$port/" }
$lastRequest = [DateTime]::UtcNow

try {
    while (([DateTime]::UtcNow - $lastRequest).TotalHours -lt 2) {
        if (-not $listener.Pending()) {
            Start-Sleep -Milliseconds 120
            continue
        }

        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            while ($reader.ReadLine()) { }
            $lastRequest = [DateTime]::UtcNow

            if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }
            $parts = $requestLine.Split(' ')
            if ($parts.Length -lt 2 -or $parts[0] -ne 'GET') {
                $body = [System.Text.Encoding]::UTF8.GetBytes('Method not allowed')
                Send-Response $stream 405 'Method Not Allowed' $body 'text/plain; charset=utf-8'
                continue
            }

            $requestPath = [System.Uri]::UnescapeDataString(($parts[1] -split '\?')[0])
            if ($requestPath -eq '/') { $requestPath = '/index.html' }
            $relativePath = $requestPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            $fullPath = [System.IO.Path]::GetFullPath((Join-Path $appRoot $relativePath))

            if (-not $fullPath.StartsWith($appRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes('Forbidden')
                Send-Response $stream 403 'Forbidden' $body 'text/plain; charset=utf-8'
            } elseif (Test-Path -LiteralPath $fullPath -PathType Leaf) {
                $body = [System.IO.File]::ReadAllBytes($fullPath)
                Send-Response $stream 200 'OK' $body (Get-ContentType $fullPath)
            } else {
                $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
                Send-Response $stream 404 'Not Found' $body 'text/plain; charset=utf-8'
            }
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}

