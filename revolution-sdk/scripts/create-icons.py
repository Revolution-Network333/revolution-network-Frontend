"""
Script pour creer les icones de l'extension Chrome
Utilise PIL (Pillow) pour redimensionner l'image
"""

try:
    from PIL import Image
    import os
except ImportError:
    print("❌ Pillow n'est pas installe")
    print("Installation: pip install Pillow")
    print("Ou utiliser l'outil en ligne: https://www.favicon-generator.org/")
    exit(1)

# Parametres
input_image = "nexon.jpg"
output_dir = "chrome-extension/assets"
sizes = [16, 32, 48, 128]

# Verifier l'image source
if not os.path.exists(input_image):
    print(f"❌ Erreur: {input_image} n'existe pas")
    exit(1)

# Creer le dossier de sortie
os.makedirs(output_dir, exist_ok=True)

# Charger l'image
print(f"🎨 Creation des icones depuis: {input_image}")
img = Image.open(input_image)

# Convertir en RGB si necessaire
if img.mode != 'RGB':
    img = img.convert('RGB')

# Creer chaque taille
for size in sizes:
    # Redimensionner avec haute qualite
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    
    # Sauvegarder
    output_file = os.path.join(output_dir, f"icon-{size}.png")
    resized.save(output_file, "PNG")
    
    print(f"✅ Cree: icon-{size}.png ({size}x{size} pixels)")

print("\n🎉 Toutes les icones ont ete creees!")
print(f"📂 Emplacement: {output_dir}")
print("\n📦 Prochaine etape:")
print("   1. Ouvrir Chrome -> chrome://extensions/")
print("   2. Activer 'Mode developpeur'")
print("   3. Cliquer 'Charger l'extension non empaquetee'")
print("   4. Selectionner le dossier: chrome-extension")
