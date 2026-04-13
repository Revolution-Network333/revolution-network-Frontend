# Script pour redimensionner un logo en plusieurs tailles pour l'extension Chrome
# Utilise System.Drawing de .NET (intégré à Windows)

param(
    [string]$InputImage = "nexon.png"
)

Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 128)
$assetsDir = "chrome-extension\assets"

# Créer le dossier si nécessaire
if (!(Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
}

# Vérifier si l'image source existe
if (!(Test-Path $InputImage)) {
    Write-Host "❌ Erreur: Le fichier '$InputImage' n'existe pas" -ForegroundColor Red
    Write-Host ""
    Write-Host "📝 Instructions:" -ForegroundColor Yellow
    Write-Host "1. Placer votre logo (nexon.png) dans le dossier principal"
    Write-Host "2. Ou spécifier le chemin: .\scripts\resize-icons.ps1 -InputImage 'chemin\vers\votre\logo.png'"
    Write-Host ""
    Write-Host "📁 Fichiers PNG disponibles dans ce dossier:" -ForegroundColor Cyan
    Get-ChildItem -Filter "*.png" | ForEach-Object { Write-Host "   - $($_.Name)" }
    exit 1
}

Write-Host "🎨 Création des icônes à partir de: $InputImage" -ForegroundColor Green
Write-Host ""

try {
    # Charger l'image source
    $sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path $InputImage))
    
    foreach ($size in $sizes) {
        $outputFile = Join-Path $assetsDir "icon-$size.png"
        
        # Créer une nouvelle image redimensionnée
        $newImage = New-Object System.Drawing.Bitmap($size, $size)
        $graphics = [System.Drawing.Graphics]::FromImage($newImage)
        
        # Améliorer la qualité du redimensionnement
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        
        # Dessiner l'image redimensionnée
        $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
        
        # Sauvegarder
        $newImage.Save($outputFile, [System.Drawing.Imaging.ImageFormat]::Png)
        
        # Nettoyer
        $graphics.Dispose()
        $newImage.Dispose()
        
        Write-Host "✅ Créé: icon-$size.png ($size x $size pixels)" -ForegroundColor Green
    }
    
    $sourceImage.Dispose()
    
    Write-Host ""
    Write-Host "🎉 Toutes les icônes ont été créées avec succès!" -ForegroundColor Green
    Write-Host "📂 Emplacement: $assetsDir" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "📦 Prochaine étape:" -ForegroundColor Yellow
    Write-Host "   1. Ouvrir Chrome -> chrome://extensions/"
    Write-Host "   2. Activer 'Mode développeur'"
    Write-Host "   3. Cliquer 'Charger l'extension non empaquetée'"
    Write-Host "   4. Sélectionner le dossier: chrome-extension"
    
} catch {
    Write-Host "❌ Erreur lors de la création des icônes: $_" -ForegroundColor Red
}
