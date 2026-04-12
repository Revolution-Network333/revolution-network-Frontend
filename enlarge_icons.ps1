# Script pour agrandir les icônes Android de 2x
Add-Type -AssemblyName System.Drawing

$dpiFolders = @(
    "android-node\app\src\main\res\mipmap-mdpi",
    "android-node\app\src\main\res\mipmap-hdpi", 
    "android-node\app\src\main\res\mipmap-xhdpi",
    "android-node\app\src\main\res\mipmap-xxhdpi",
    "android-node\app\src\main\res\mipmap-xxxhdpi"
)

foreach ($folder in $dpiFolders) {
    $iconPath = Join-Path $folder "ic_launcher.png"
    if (Test-Path $iconPath) {
        Write-Host "Traitement de: $iconPath"
        
        try {
            # Charger l'image originale
            $originalImage = [System.Drawing.Image]::FromFile($iconPath)
            
            # Créer une nouvelle image 2x plus grande
            $newWidth = $originalImage.Width * 2
            $newHeight = $originalImage.Height * 2
            $newImage = New-Object System.Drawing.Bitmap($newWidth, $newHeight)
            
            # Dessiner l'image agrandie avec haute qualité
            $graphics = [System.Drawing.Graphics]::FromImage($newImage)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($originalImage, 0, 0, $newWidth, $newHeight)
            
            # Sauvegarder la nouvelle image
            $newImage.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
            
            # Nettoyer
            $graphics.Dispose()
            $newImage.Dispose()
            $originalImage.Dispose()
            
            Write-Host "Icône agrandie: $iconPath"
        }
        catch {
            Write-Host "Erreur lors du traitement de $iconPath : $_"
        }
    }
}

Write-Host "Agrandissement des icônes terminé!"
