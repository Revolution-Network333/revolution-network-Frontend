# Script simple pour agrandir les icônes Android - méthode alternative
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
    $backupPath = Join-Path $folder "ic_launcher_backup.png"
    
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
            $tempPath = Join-Path $folder "ic_launcher_temp.png"
            $newImage.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
            
            # Nettoyer
            $graphics.Dispose()
            $newImage.Dispose()
            $originalImage.Dispose()
            
            # Remplacer l'original
            Remove-Item $iconPath -Force
            Rename-Item $tempPath $iconPath
            
            Write-Host "Icône agrandie: $iconPath"
        }
        catch {
            Write-Host "Erreur lors du traitement de $backupPath : $_"
        }
    }
}

Write-Host "Agrandissement des icônes terminé!"
