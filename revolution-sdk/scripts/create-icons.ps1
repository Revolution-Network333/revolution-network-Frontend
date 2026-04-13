# Script pour créer des icônes de base pour l'extension Chrome
# Ce script crée des images SVG qui peuvent être converties en PNG

$assetsDir = "chrome-extension\assets"
New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null

$svgContent = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#10b981"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
        font-family="Arial, sans-serif" font-size="80" font-weight="bold" fill="white">R</text>
</svg>
"@

# Créer un fichier SVG de base
$svgContent | Out-File -FilePath "$assetsDir\icon.svg" -Encoding UTF8

Write-Host "✅ Fichier SVG créé : chrome-extension\assets\icon.svg" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Instructions pour créer les icônes PNG :" -ForegroundColor Yellow
Write-Host ""
Write-Host "Option 1 (En ligne - Recommandé) :"
Write-Host "  1. Aller sur https://convertio.co/fr/svg-png/"
Write-Host "  2. Uploader icon.svg"
Write-Host "  3. Télécharger le PNG"
Write-Host "  4. Redimensionner aux tailles suivantes avec Paint ou un outil en ligne :"
Write-Host "     - icon-16.png  (16x16 pixels)"
Write-Host "     - icon-32.png  (32x32 pixels)"
Write-Host "     - icon-48.png  (48x48 pixels)"
Write-Host "     - icon-128.png (128x128 pixels)"
Write-Host ""
Write-Host "Option 2 (Paint.NET ou GIMP) :"
Write-Host "  1. Ouvrir icon.svg"
Write-Host "  2. Redimensionner et exporter 4 fois aux tailles ci-dessus"
Write-Host ""
Write-Host "Option 3 (Outil en ligne tout-en-un) :"
Write-Host "  1. Aller sur https://www.favicon-generator.org/"
Write-Host "  2. Uploader une image (ou créer-en une)"
Write-Host "  3. Télécharger toutes les tailles"
Write-Host "  4. Renommer les fichiers comme indiqué ci-dessus"
Write-Host ""
Write-Host "Placer tous les fichiers PNG dans : chrome-extension\assets" -ForegroundColor Cyan
