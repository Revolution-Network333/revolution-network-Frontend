const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

async function generateMacAssets() {
  console.log('Génération des assets Mac...');

  const assetsDir = path.join(__dirname, 'assets');
  const iconPngPath = path.join(assetsDir, 'icon.png');
  const dmgBgPath = path.join(assetsDir, 'dmg-background.png');

  try {
    // Créer l'icône PNG (1024x1024, cercle avec gradient)
    console.log('Création icon.png (1024x1024)...');
    const iconSize = 1024;
    const iconSvg = `
      <svg width="${iconSize}" height="${iconSize}">
        <defs>
          <linearGradient id="iconGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#10b981;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#059669;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#iconGrad)" rx="200" />
        <text x="50%" y="50%" font-size="400" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">R</text>
      </svg>
    `;

    await sharp(Buffer.from(iconSvg))
      .resize(iconSize, iconSize)
      .png()
      .toFile(iconPngPath);
    console.log('✓ icon.png créé (1024x1024)');

    // Créer le fond DMG (1920x600, dégradé sombre)
    console.log('Création dmg-background.png (1920x600)...');
    const width = 1920;
    const height = 600;

    const svgGradient = `
      <svg width="${width}" height="${height}">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#0f172a;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1e293b;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)" />
        <circle cx="${width/2}" cy="${height/2}" r="100" fill="#10b981" opacity="0.3" />
      </svg>
    `;

    await sharp(Buffer.from(svgGradient))
      .resize(width, height)
      .png()
      .toFile(dmgBgPath);
    console.log('✓ dmg-background.png créé (1920x600)');

    console.log('\nAssets Mac générés avec succès !');
    console.log('Fichiers créés :');
    console.log(`  - ${iconPngPath}`);
    console.log(`  - ${dmgBgPath}`);
  } catch (error) {
    console.error('Erreur lors de la génération:', error);
    process.exit(1);
  }
}

generateMacAssets();
