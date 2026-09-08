param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\public'))

Add-Type -AssemblyName System.Drawing

function New-DraftTimerIcon {
  param([int]$Size, [string]$Path, [bool]$Maskable = $false)
  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  try {
    $navy = [System.Drawing.ColorTranslator]::FromHtml('#173a52')
    $orange = [System.Drawing.ColorTranslator]::FromHtml('#ea5a35')
    $paper = [System.Drawing.ColorTranslator]::FromHtml('#f6f5f0')
    $graphics.Clear($(if ($Maskable) { $navy } else { $paper }))
    $margin = $(if ($Maskable) { [int]($Size * .18) } else { [int]($Size * .08) })
    $card = [System.Drawing.RectangleF]::new($margin, $margin, $Size - 2 * $margin, $Size - 2 * $margin)
    $graphics.FillRectangle([System.Drawing.SolidBrush]::new($navy), $card)
    $graphics.FillEllipse([System.Drawing.SolidBrush]::new($orange), $Size * .68, $Size * .1, $Size * .16, $Size * .16)
    $font = [System.Drawing.Font]::new('Arial', $Size * .22, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString('DT', $font, [System.Drawing.Brushes]::White, $card, $format)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $font.Dispose()
    $format.Dispose()
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

New-DraftTimerIcon -Size 192 -Path (Join-Path $OutputDirectory 'icon-192.png')
New-DraftTimerIcon -Size 512 -Path (Join-Path $OutputDirectory 'icon-512.png')
New-DraftTimerIcon -Size 512 -Path (Join-Path $OutputDirectory 'icon-512-maskable.png') -Maskable $true
New-DraftTimerIcon -Size 180 -Path (Join-Path $OutputDirectory 'apple-touch-icon.png')
