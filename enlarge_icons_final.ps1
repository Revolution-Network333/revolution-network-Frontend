# Script final pour agrandir les icônes Android - méthode robuste
Add-Type -AssemblyName System.Drawing

$dpiFolders = @(
    "android-node\app\src\main\res\mipmap-mdpi",
    "android-node\app\src\main\res\mipmap-hdpi", 
    "android-node\app\src\main\res\mipmap-xhdpi",
    "android-node\app\src\main\res\mipmap-xxhdpi",
    "android-node\app\src\main\res\mipmap-xxxhdpi"
)

foreach ($folder in $dpiFolders) {
    $backupPath = Join-Path $folder "ic_launcher_backup.png"
    $iconPath = Join-Path $folder "ic_launcher.png"
    
    if (Test-Path $backupPath) {
        Write-Host "Traitement de: $backupPath"
        
        try {
            # Charger l'image originale depuis le backup
            $originalImage = [System.Drawing.Image]::FromFile($backupPath)
            
            # Créer une nouvelle image 2x plus grande
            $newWidth = $originalImage.Width * 2
            $newHeight = $originalImage.Height * 2
            $newImage = New-Object System.Drawing.Bitmap($newWidth, $newHeight)
            
            # Dessiner l'image agrandie
            $graphics = [System.Drawing.Graphics]::FromImage($newImage)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($originalImage, 0, 0, $newWidth, $newHeight)
            
            # Sauvegarder dans un fichier temporaire
            $tempPath = Join-Path $folder "temp_icon.png"
            $newImage.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
            
            # Nettoyer
            $graphics.Dispose()
            $newImage.Dispose()
            $originalImage.Dispose()
            
            # Supprimer l'ancien fichier et copier le nouveau
            if (Test-Path $iconPath) {
                Remove-Item $iconPath -Force
            }
            Copy-Item $tempPath $iconPath
            Remove-Item $tempPath -Force
            
            Write-Host "Icône agrandie: $iconPath ($newWidth x $newHeight)"
        }
        catch {
            Write-Host "Erreur lors du traitement de $backupPath : $_"
        }
    }
}

Write-Host "Agrandissement des icônes terminé!"
